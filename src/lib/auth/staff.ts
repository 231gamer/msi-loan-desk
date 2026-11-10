import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";

import { logServerError } from "@/lib/log";
import { canAccess, type Role, type RouteKey } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/*
 * Data access layer for the signed-in staff member (Next.js authentication guide: verify the
 * session close to the data, in every page and action). The account is read through my_account(),
 * which works while the user must still set a password (the profile table refuses them then).
 * Inactive or unknown users are treated as signed out.
 */
export interface Staff {
  id: string;
  fullName: string;
  role: Role;
  branch: { id: string; code: string; name: string } | null;
}

/** The signed-in account while it must set a new password: it may only do that, or sign out. */
export interface PendingAccount {
  id: string;
  fullName: string;
  email: string;
  expiresAt: string | null;
  expired: boolean;
  /** The session started before the admin required a new password: sign in again first. */
  signInAgain: boolean;
}

export type StaffResult =
  | { status: "signed-out" }
  | { status: "inactive"; userId: string }
  | { status: "must-change"; account: PendingAccount }
  | { status: "ok"; staff: Staff; email: string };

export const getCurrentStaff = cache(async (): Promise<StaffResult> => {
  const supabase = await createSupabaseServerClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims.sub;
  if (userId === undefined) return { status: "signed-out" };

  const { data: account, error } = await supabase.rpc("my_account").maybeSingle();

  // A failed query is an outage, not a fact about the user: surface it through the error page
  // instead of treating the user as inactive.
  if (error !== null) {
    logServerError({ code: `PROFILE_READ_${error.code}`, userId, where: "auth.getCurrentStaff" });
    throw new Error("Could not read the staff profile");
  }

  if (account === null || !account.active) return { status: "inactive", userId };

  if (account.must_change_password) {
    return {
      status: "must-change",
      account: {
        id: account.id,
        fullName: account.full_name,
        email: account.email,
        expiresAt: account.temp_password_expires_at,
        expired: account.temp_password_expired,
        signInAgain: account.sign_in_again,
      },
    };
  }

  return {
    status: "ok",
    email: account.email,
    staff: {
      id: account.id,
      fullName: account.full_name,
      role: account.role,
      branch:
        account.branch_id === null
          ? null
          : { id: account.branch_id, code: account.branch_code ?? "", name: account.branch_name ?? "" },
    },
  };
});

/**
 * Call at the top of every protected page with the page's route pattern. Redirects signed-out
 * users to /login, inactive users through sign-out, accounts that must set a new password to
 * /account/password, and roles without access to /dashboard.
 */
export async function requirePageAccess(route: RouteKey): Promise<Staff> {
  const result = await getCurrentStaff();
  if (result.status === "signed-out") redirect("/login");
  if (result.status === "inactive") redirect("/auth/sign-out?notice=inactive");
  if (result.status === "must-change") redirect("/account/password");
  if (!canAccess(result.staff.role, route)) redirect("/dashboard?notice=forbidden");
  return result.staff;
}
