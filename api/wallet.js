import { createClient } from "@supabase/supabase-js";
import { getAdminClient } from "../lib/paychangu.js";

function reply(res, status, body) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  return res.status(status).json(body);
}

export default async function handler(req, res) {
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return reply(res, 405, { error: "Method not allowed." }); }
  const token = String(req.headers.authorization || "").startsWith("Bearer ") ? req.headers.authorization.slice(7) : "";
  if (!token) return reply(res, 401, { error: "Sign in to view your wallet." });
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey || !process.env.SUPABASE_SERVICE_ROLE_KEY) return reply(res, 503, { error: "Wallet is not configured." });
  try {
    const auth = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await auth.auth.getUser(token);
    if (error || !data?.user) return reply(res, 401, { error: "Your session has expired. Sign in again." });
    const admin = getAdminClient();
    const userId = data.user.id;
    const [walletResult, transactionsResult] = await Promise.all([
      admin.from("wallet_accounts").select("balance_minor,currency,updated_at").eq("user_id", userId).maybeSingle(),
      admin.from("wallet_transactions").select("id,kind,amount_minor,currency,description,created_at,metadata").eq("user_id", userId).order("created_at", { ascending: false }).limit(50)
    ]);
    if (walletResult.error) throw walletResult.error;
    if (transactionsResult.error) throw transactionsResult.error;
    return reply(res, 200, {
      balanceMinor: Number(walletResult.data?.balance_minor || 0),
      currency: "MWK",
      transactions: (transactionsResult.data || []).map(item => ({ ...item, amountMinor: Number(item.amount_minor) }))
    });
  } catch (error) {
    console.error("Yaza wallet read error:", error?.message || error);
    return reply(res, 500, { error: "Could not load your wallet." });
  }
}
