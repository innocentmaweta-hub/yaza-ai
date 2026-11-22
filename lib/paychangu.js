import { createClient } from "@supabase/supabase-js";

export function getAdminClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Yaza payment storage is not configured.");
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function verifyAndCreditTopup(admin, txRef, expectedUserId = null) {
  const { data: topup, error: lookupError } = await admin.from("payment_topups")
    .select("*").eq("tx_ref", txRef).maybeSingle();
  if (lookupError) throw lookupError;
  if (!topup) return { status: "not_found" };
  if (expectedUserId && topup.user_id !== expectedUserId) {
    const error = new Error("This payment does not belong to your account.");
    error.status = 403;
    throw error;
  }
  if (topup.status === "success") {
    const { data: wallet } = await admin.from("wallet_accounts").select("balance_minor").eq("user_id", topup.user_id).maybeSingle();
    return { status: "success", balanceMinor: Number(wallet?.balance_minor || 0), alreadyCredited: true };
  }
  const secret = process.env.PAYCHANGU_SECRET_KEY;
  if (!secret) throw new Error("PayChangu is not configured. Add PAYCHANGU_SECRET_KEY in Vercel.");
  const response = await fetch("https://api.paychangu.com/verify-payment/" + encodeURIComponent(txRef), {
    method: "GET",
    headers: { Accept: "application/json", Authorization: "Bearer " + secret }
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.status === "error") {
    throw new Error(result.message || "PayChangu could not verify this transaction yet.");
  }
  const payment = result.data || result;
  if (String(payment.tx_ref || "") !== txRef) throw new Error("PayChangu returned a different transaction reference.");
  const status = String(payment.status || "").toLowerCase();
  if (status !== "success") {
    if (["failed", "cancelled", "canceled"].includes(status)) {
      await admin.from("payment_topups").update({ status: "failed", verification_data: result }).eq("tx_ref", txRef);
      return { status: "failed" };
    }
    return { status: "pending" };
  }
  if (String(payment.currency || "").toUpperCase() !== "MWK") throw new Error("The verified payment currency does not match MWK.");
  const paidAmount = Number(payment.amount);
  if (!Number.isSafeInteger(paidAmount) || paidAmount !== Number(topup.amount_mwk)) {
    throw new Error("The verified payment amount does not exactly match the requested wallet top-up.");
  }
  const { data: creditRows, error: creditError } = await admin.rpc("credit_yaza_topup", {
    p_user_id: topup.user_id,
    p_tx_ref: txRef,
    p_amount_mwk: paidAmount,
    p_metadata: { provider: "paychangu", provider_reference: payment.reference || null, expected_amount_mwk: Number(topup.amount_mwk), paid_amount_mwk: paidAmount }
  });
  if (creditError) throw creditError;
  const credit = Array.isArray(creditRows) ? creditRows[0] : creditRows;
  const { error: updateError } = await admin.from("payment_topups").update({
    status: "success",
    provider_reference: payment.reference || null,
    verification_data: result,
    verified_at: new Date().toISOString()
  }).eq("tx_ref", txRef);
  if (updateError) throw updateError;
  return { status: "success", balanceMinor: Number(credit?.balance_minor || 0), alreadyCredited: !credit?.credited };
}
