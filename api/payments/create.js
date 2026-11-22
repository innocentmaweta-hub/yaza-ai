import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { getAdminClient } from "../../lib/paychangu.js";

function reply(res, status, body) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  return res.status(status).json(body);
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return reply(res, 405, { error: "Method not allowed." }); }
  const token = String(req.headers.authorization || "").startsWith("Bearer ") ? req.headers.authorization.slice(7) : "";
  if (!token) return reply(res, 401, { error: "Sign in before adding money to your wallet." });
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const secret = process.env.PAYCHANGU_SECRET_KEY;
  if (!url || !anonKey || !process.env.SUPABASE_SERVICE_ROLE_KEY) return reply(res, 503, { error: "Wallet payments are not configured." });
  if (!secret) return reply(res, 503, { error: "PayChangu is not configured. Add PAYCHANGU_SECRET_KEY in Vercel." });
  const amount = Number(req.body?.amount);
  if (!Number.isSafeInteger(amount) || amount < 500 || amount > 500000) {
    return reply(res, 400, { error: "Choose a whole MWK top-up amount between MK 500 and MK 500,000." });
  }
  try {
    const auth = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await auth.auth.getUser(token);
    if (authError || !authData?.user) return reply(res, 401, { error: "Your session has expired. Sign in again." });
    const admin = getAdminClient();
    const txRef = "YAZA-" + randomUUID();
    const { error: insertError } = await admin.from("payment_topups").insert({
      user_id: authData.user.id, tx_ref: txRef, amount_mwk: amount, currency: "MWK", status: "pending"
    });
    if (insertError) throw insertError;
    const baseUrl = String(process.env.APP_URL || "https://yaza-ai.vercel.app").replace(/\/$/, "");
    const response = await fetch("https://api.paychangu.com/payment", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: "Bearer " + secret },
      body: JSON.stringify({
        amount: String(amount), currency: "MWK", tx_ref: txRef,
        email: authData.user.email || undefined,
        callback_url: baseUrl + "/api/paychangu/callback",
        return_url: baseUrl + "/?payment=return",
        customization: { title: "Yaza AI wallet", description: "Add funds to your Yaza AI wallet" },
        meta: { product: "yaza-ai-wallet", tx_ref: txRef }
      })
    });
    const result = await response.json().catch(() => ({}));
    const checkoutUrl = result?.data?.checkout_url;
    if (!response.ok || result.status !== "success" || !checkoutUrl) {
      await admin.from("payment_topups").update({ status: "failed", verification_data: result }).eq("tx_ref", txRef);
      return reply(res, 502, { error: result.message || "PayChangu could not create a checkout session." });
    }
    const { error: updateError } = await admin.from("payment_topups").update({ checkout_url: checkoutUrl }).eq("tx_ref", txRef);
    if (updateError) throw updateError;
    return reply(res, 200, { checkoutUrl, txRef, amount, currency: "MWK" });
  } catch (error) {
    console.error("Yaza payment creation error:", error?.message || error);
    return reply(res, 500, { error: error.message || "Could not start the PayChangu checkout." });
  }
}
