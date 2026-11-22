import { createClient } from "@supabase/supabase-js";
import { getAdminClient, verifyAndCreditTopup } from "../_lib/paychangu.js";

function reply(res, status, body) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  return res.status(status).json(body);
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return reply(res, 405, { error: "Method not allowed." }); }
  const token = String(req.headers.authorization || "").startsWith("Bearer ") ? req.headers.authorization.slice(7) : "";
  if (!token) return reply(res, 401, { error: "Sign in to verify your wallet payment." });
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey || !process.env.SUPABASE_SERVICE_ROLE_KEY) return reply(res, 503, { error: "Wallet payments are not configured." });
  const txRef = String(req.body?.tx_ref || "");
  if (!/^YAZA-[0-9a-f-]{36}$/i.test(txRef)) return reply(res, 400, { error: "Invalid payment reference." });
  try {
    const auth = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await auth.auth.getUser(token);
    if (error || !data?.user) return reply(res, 401, { error: "Your session has expired. Sign in again." });
    const result = await verifyAndCreditTopup(getAdminClient(), txRef, data.user.id);
    if (result.status === "not_found") return reply(res, 404, { error: "Payment reference not found." });
    return reply(res, 200, result);
  } catch (error) {
    console.error("Yaza payment verification error:", error?.message || error);
    return reply(res, error.status || 502, { error: error.message || "Could not verify this payment." });
  }
}
