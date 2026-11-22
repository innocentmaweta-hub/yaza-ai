import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";

function configuredLimit(value, fallback) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, 1000000) : fallback;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: "Web search is not configured yet. Add TAVILY_API_KEY in your Vercel project environment variables, then redeploy."
    });
  }

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) {
    return res.status(503).json({ error: "Web search access controls are not configured. Please contact the Yaza administrator." });
  }

  const authorization = req.headers.authorization || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Sign in to use web search." });

  const query = typeof req.body?.query === "string" ? req.body.query.trim().slice(0, 500) : "";
  if (query.length < 2) return res.status(400).json({ error: "Enter a question or topic to search for." });

  try {
    const authClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !authData?.user) {
      return res.status(401).json({ error: "Your session has expired. Sign in again to use web search." });
    }

    const subjectKey = createHash("sha256")
      .update(serviceKey + ":search:user:" + authData.user.id)
      .digest("hex");
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const dailyLimit = configuredLimit(process.env.YAZA_SEARCH_DAILY_LIMIT, 20);
    const monthlyLimit = configuredLimit(process.env.YAZA_SEARCH_MONTHLY_LIMIT, 300);
    const { data: quotaData, error: quotaError } = await admin.rpc("consume_yaza_search_quota", {
      p_subject_key: subjectKey,
      p_daily_limit: dailyLimit,
      p_monthly_limit: monthlyLimit
    });
    if (quotaError) {
      console.error("Yaza search quota check error:", quotaError.message);
      return res.status(503).json({ error: "Web search usage controls are temporarily unavailable. Please try again shortly." });
    }
    const quota = Array.isArray(quotaData) ? quotaData[0] : quotaData;
    if (!quota?.allowed) {
      return res.status(429).json({
        error: `Your web search limit has been reached (${dailyLimit} searches per day or ${monthlyLimit} per month). Please try again after the limit resets.`,
        quota: { dailyUsed: quota?.daily_used ?? dailyLimit, dailyLimit, monthlyUsed: quota?.monthly_used ?? monthlyLimit, monthlyLimit }
      });
    }

    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: "basic",
        topic: "general",
        max_results: 5,
        include_answer: false,
        include_raw_content: false
      }),
      signal: AbortSignal.timeout(20000)
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error("Yaza web search provider error:", response.status, data?.message || data?.error || "");
      if (response.status === 401 || response.status === 403) {
        return res.status(502).json({ error: "The web search provider rejected its API key. Check TAVILY_API_KEY in Vercel." });
      }
      if (response.status === 429) {
        return res.status(502).json({ error: "Web search is temporarily rate-limited. Please wait and try again." });
      }
      return res.status(502).json({ error: "The web search provider could not complete this search. Please try again." });
    }

    const results = (Array.isArray(data.results) ? data.results : []).slice(0, 5).map(item => ({
      title: String(item.title || "Web result").slice(0, 300),
      url: String(item.url || ""),
      content: String(item.content || "").slice(0, 3500),
      score: Number.isFinite(item.score) ? item.score : null
    })).filter(item => /^https?:\/\//i.test(item.url) && item.content);

    return res.status(200).json({ query, results, quota: { dailyUsed: quota.daily_used, dailyLimit, monthlyUsed: quota.monthly_used, monthlyLimit } });
  } catch (error) {
    console.error("Yaza web search error:", error?.message || error);
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      return res.status(504).json({ error: "Web search took too long. Please try again." });
    }
    return res.status(502).json({ error: "Yaza AI could not reach web search. Please try again." });
  }
}
