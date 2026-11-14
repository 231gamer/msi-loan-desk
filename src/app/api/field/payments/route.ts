import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getCurrentStaff } from "@/lib/auth/staff";
import { logServerError } from "@/lib/log";
import { syncResultFor } from "@/lib/offline/rules";
import { errorCodeFrom } from "@/lib/rpc-errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/*
 * POST /api/field/payments (SPEC addendum B): the service worker sends a payment a loan officer took
 * offline. Same rules as the online Collect form: record_field_payment checks the role, the branch,
 * the amount and the method, dates the payment today, and returns the same payment for a request
 * key it has seen before.
 *
 * Answers: 200 {result: "sent"}; 422 {result: "failed", code} for a refusal a retry cannot fix;
 * 401/403/409/503 {result: "retry"} for signed out, another user signed in on this phone, or an
 * outage. Requests must come from this site's own pages (Origin and a custom header).
 */
const bodySchema = z.object({
  key: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
  userId: z.string().uuid(),
  loanId: z.string().uuid(),
  amountCents: z.string().regex(/^[1-9]\d{0,11}$/),
  method: z.enum(["cash", "mobile_money", "bank"]),
  reference: z.string().max(100),
});

function answer(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (
    request.headers.get("x-loandesk-offline") !== "1" ||
    (origin !== null && origin !== request.nextUrl.origin) ||
    !(request.headers.get("content-type") ?? "").startsWith("application/json")
  ) {
    return answer(403, { result: "retry", code: "FORBIDDEN" });
  }

  const current = await getCurrentStaff();
  if (current.status !== "ok") return answer(401, { result: "retry", code: "SIGNED_OUT" });
  if (current.staff.role !== "loan_officer") return answer(403, { result: "retry", code: "FORBIDDEN" });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return answer(422, { result: "failed", code: "INVALID_INPUT" });
  const data = parsed.data;
  // Recorded under whoever is signed in, so it waits until the officer who took it signs in again.
  if (data.userId !== current.staff.id) return answer(409, { result: "retry", code: "OTHER_USER" });

  const supabase = await createSupabaseServerClient();
  const { data: today, error: todayError } = await supabase.rpc("business_today");
  if (todayError !== null) return answer(503, { result: "retry", code: "UNKNOWN" });
  const { data: receipt, error } = await supabase.rpc("record_field_payment", {
    p_loan_id: data.loanId,
    p_amount_cents: Number(data.amountCents),
    p_method: data.method,
    p_reference: data.reference,
    p_received_on: today,
    p_idempotency_key: data.key,
  });
  if (error !== null) {
    const code = errorCodeFrom(error);
    if (code === "UNKNOWN")
      logServerError({
        code: `RPC_${error.code ?? ""}`,
        userId: current.staff.id,
        where: "api.field.payments",
      });
    return syncResultFor(code) === "failed"
      ? answer(422, { result: "failed", code })
      : answer(503, { result: "retry", code });
  }

  const facts = receipt as { payment_id: string; receipt_no: string };
  revalidatePath("/field");
  revalidatePath(`/loans/${data.loanId}`);
  return answer(200, { result: "sent", paymentId: facts.payment_id, receiptNo: facts.receipt_no });
}
