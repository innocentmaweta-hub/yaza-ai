import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";

function reply(res, status, body) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  return res.status(status).json(body);
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return reply(res, 405, { error: "Method not allowed." });
  }
  const authorization = req.headers.authorization || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return reply(res, 401, { error: "Sign in to view your usage." });

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) return reply(res, 503, { error: "Usage reporting is not configured." });

  try {
    const auth = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await auth.auth.getUser(token);
    if (authError || !authData?.user) return reply(res, 401, { error: "Your session has expired. Sign in again." });
    const userId = authData.user.id;
    const subjectKey = createHash("sha256").update(serviceKey + ":user:" + userId).digest("hex");
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString().slice(0, 10);
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
    const [dailyResult, monthlyResult, eventsResult] = await Promise.all([
      admin.from("usage_counters").select("request_count").eq("subject_key", subjectKey).eq("period_type", "day").eq("period_start", today).maybeSingle(),
      admin.from("usage_counters").select("request_count").eq("subject_key", subjectKey).eq("period_type", "month").eq("period_start", month).maybeSingle(),
      admin.from("usage_events").select("provider,model,public_model_key,billed_amount_minor,billing_status,status,input_tokens_estimate,output_tokens_estimate,prompt_tokens,completion_tokens,reported_cost_usd,created_at").eq("user_id", userId).gte("created_at", new Date(month).toISOString()).order("created_at", { ascending: false }).limit(1000)
    ]);
    if (dailyResult.error) throw dailyResult.error;
    if (monthlyResult.error) throw monthlyResult.error;
    if (eventsResult.error) throw eventsResult.error;
    const events = eventsResult.data || [];
    const byModel = new Map();
    let estimatedInputTokens = 0, estimatedOutputTokens = 0, reportedCostUsd = 0, pricedRequests = 0, billedAmountMinor = 0;
    for (const event of events) {
      estimatedInputTokens += Number(event.input_tokens_estimate || 0);
      estimatedOutputTokens += Number(event.output_tokens_estimate || 0);
      if (event.reported_cost_usd !== null && event.reported_cost_usd !== undefined) {
        reportedCostUsd += Number(event.reported_cost_usd) || 0;
        pricedRequests++;
      }
      const key = event.public_model_key || event.provider + "::" + event.model;
      if (event.billed_amount_minor !== null && event.billed_amount_minor !== undefined) billedAmountMinor += Number(event.billed_amount_minor) || 0;
      const item = byModel.get(key) || { provider: event.provider, model: event.model, publicModelKey: event.public_model_key || null, requests: 0, estimatedTokens: 0, reportedCostUsd: 0, billedAmountMinor: 0 };
      item.requests++;
      item.estimatedTokens += Number(event.input_tokens_estimate || 0) + Number(event.output_tokens_estimate || 0);
      item.reportedCostUsd += Number(event.reported_cost_usd || 0);
      item.billedAmountMinor += Number(event.billed_amount_minor || 0);
      byModel.set(key, item);
    }
    const dailyLimit = Math.max(1, Number.parseInt(process.env.YAZA_DAILY_REQUEST_LIMIT || "50", 10) || 50);
    const monthlyLimit = Math.max(1, Number.parseInt(process.env.YAZA_MONTHLY_REQUEST_LIMIT || "1000", 10) || 1000);
    return reply(res, 200, {
      daily: { used: dailyResult.data?.request_count || 0, limit: dailyLimit },
      monthly: { used: monthlyResult.data?.request_count || 0, limit: monthlyLimit },
      estimatedInputTokens,
      estimatedOutputTokens,
      reportedCostUsd: Number(reportedCostUsd.toFixed(8)),
      billedAmountMinor,
      pricedRequests,
      unpricedRequests: events.length - pricedRequests,
      eventsSampled: events.length,
      byModel: [...byModel.values()].sort((a,b) => b.requests - a.requests)
    });
  } catch (error) {
    console.error("Yaza usage report error:", error?.message || error);
    return reply(res, 500, { error: "Could not load your usage report." });
  }
}
