"use server";

import { createClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getCurrentStaff } from "@/lib/auth/staff";
import { supabasePublicEnv } from "@/lib/env";
import { logServerError } from "@/lib/log";
import { passwordProblems, type PasswordProblem } from "@/lib/password-rules";
import { errorCodeFrom } from "@/lib/rpc-errors";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/*
 * Set a new password (forced after a temporary one) or change it (voluntary, with the current
 * password). The rules are checked here, on the server; Supabase Auth stores the password and
 * complete_password_change() clears the flag and writes the audit row. No password is ever logged,
 * stored by the app or put in a URL.
 */
export type PasswordFormError =
  | "invalidInput"
  | "mismatch"
  | "currentRequired"
  | "currentWrong"
  | "samePassword"
  | "rateLimited"
  | "reauthenticate"
  | "unavailable";

export interface PasswordFormState {
  error?: PasswordFormError;
  problems?: PasswordProblem[];
}

const schema = z.object({
  currentPassword: z.string().max(1000).optional(),
  newPassword: z.string().max(1000),
  confirmPassword: z.string().max(1000),
});

/** Sign-in lockout bookkeeping (login_guard, SPEC 11): wrong current passwords count as failures. */
async function loginGuard(email: string, event: "check" | "failed" | "succeeded"): Promise<"locked" | "ok"> {
  try {
    const { data, error } = await createSupabaseAdminClient().rpc("login_guard", {
      p_email: email,
      p_event: event,
    });
    if (error !== null) {
      logServerError({ code: `LOGIN_GUARD_${error.code}`, where: "account.changePassword" });
      return "ok";
    }
    return data === "locked" ? "locked" : "ok";
  } catch {
    logServerError({ code: "LOGIN_GUARD_UNAVAILABLE", where: "account.changePassword" });
    return "ok";
  }
}

/** Checks the current password on a separate client, so the user's own session is not touched. */
async function currentPasswordIsRight(email: string, password: string): Promise<boolean> {
  const { url, anonKey } = supabasePublicEnv();
  const check = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error } = await check.auth.signInWithPassword({ email, password });
  if (error !== null) return false;
  await check.auth.signOut({ scope: "local" });
  return true;
}

export async function changePassword(
  _previous: PasswordFormState,
  formData: FormData,
): Promise<PasswordFormState> {
  const result = await getCurrentStaff();
  if (result.status === "signed-out") redirect("/login");
  if (result.status === "inactive") redirect("/auth/sign-out?notice=inactive");

  const forced = result.status === "must-change";
  const userId = forced ? result.account.id : result.staff.id;
  const email = forced ? result.account.email : result.email;
  const fullName = forced ? result.account.fullName : result.staff.fullName;
  if (forced && result.account.expired) redirect("/auth/sign-out?notice=temp-expired");
  // A session from before the admin's reset must not choose the new password (the database refuses too).
  if (forced && result.account.signInAgain) redirect("/auth/sign-out?notice=sign-in-again");

  const parsed = schema.safeParse({
    currentPassword: formData.get("currentPassword") ?? undefined,
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) return { error: "invalidInput" };
  const { currentPassword, newPassword, confirmPassword } = parsed.data;

  const problems = passwordProblems(newPassword, { email, fullName });
  if (problems.length > 0) return { problems };
  if (newPassword !== confirmPassword) return { error: "mismatch" };

  if (!forced) {
    if (currentPassword === undefined || currentPassword === "") return { error: "currentRequired" };
    if ((await loginGuard(email, "check")) === "locked") return { error: "rateLimited" };
    if (!(await currentPasswordIsRight(email, currentPassword))) {
      const after = await loginGuard(email, "failed");
      return { error: after === "locked" ? "rateLimited" : "currentWrong" };
    }
    await loginGuard(email, "succeeded");
  }

  const supabase = await createSupabaseServerClient();
  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
  if (updateError !== null) {
    // Same as the stored password. After a forced change whose last step failed, the stored password
    // is already the new one: complete_password_change() below decides (it refuses the temporary one).
    const retryAfterPartialChange = updateError.code === "same_password" && forced;
    if (!retryAfterPartialChange) {
      if (updateError.code === "same_password") return { error: "samePassword" };
      if (updateError.code === "weak_password") return { problems: ["tooShort"] };
      if (updateError.code === "reauthentication_needed") return { error: "reauthenticate" };
      logServerError({
        code: `AUTH_${updateError.code ?? "UPDATE_FAILED"}`,
        userId,
        where: "account.changePassword",
      });
      return { error: "unavailable" };
    }
  }

  const { error: completeError } = await supabase.rpc("complete_password_change");
  if (completeError !== null) {
    if (completeError.message.startsWith("TEMP_PASSWORD_EXPIRED"))
      redirect("/auth/sign-out?notice=temp-expired");
    if (completeError.message.startsWith("SIGN_IN_AGAIN")) redirect("/auth/sign-out?notice=sign-in-again");
    if (errorCodeFrom(completeError) === "INVALID_STATE") return { error: "samePassword" };
    logServerError({ code: `RPC_${completeError.code}`, userId, where: "account.changePassword" });
    return { error: "unavailable" };
  }

  // End every other session of this user; this one stays signed in.
  const { error: signOutError } = await supabase.auth.signOut({ scope: "others" });
  if (signOutError !== null) {
    logServerError({
      code: `AUTH_SIGN_OUT_OTHERS_${signOutError.code ?? "FAILED"}`,
      userId,
      where: "account.changePassword",
    });
  }

  redirect("/dashboard?notice=password-changed");
}
