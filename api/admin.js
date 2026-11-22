import { createClient } from "@supabase/supabase-js";

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
  if (!token) return reply(res, 401, { error: "Sign in to continue." });

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const adminEmail = String(process.env.YAZA_ADMIN_EMAIL || "").trim().toLowerCase();
  if (!url || !anonKey || !serviceKey || !adminEmail) {
    return reply(res, 503, { error: "Admin dashboard is not configured. Set SUPABASE_SERVICE_ROLE_KEY and YAZA_ADMIN_EMAIL in the server environment." });
  }

  try {
    const authClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !authData?.user) return reply(res, 401, { error: "Your session is invalid or expired. Sign in again." });
    if (String(authData.user.email || "").toLowerCase() !== adminEmail) {
      return reply(res, 403, { error: "You are not authorized to access Yaza administration." });
    }

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const [usersResult, conversationsResult, messagesCountResult, messagesResult, usageResult] = await Promise.all([
      admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
      admin.from("conversations").select("id", { count: "exact", head: true }),
      admin.from("messages").select("id", { count: "exact", head: true }),
      admin.from("messages").select("provider,model,created_at").order("created_at", { ascending: false }).limit(5000),
      admin.from("usage_events").select("user_id,provider,model,status,input_tokens_estimate,output_tokens_estimate,prompt_tokens,completion_tokens,reported_cost_usd,created_at").order("created_at", { ascending: false }).limit(10000)
    ]);
    if (usersResult.error) throw usersResult.error;
    if (conversationsResult.error) throw conversationsResult.error;
    if (messagesCountResult.error) throw messagesCountResult.error;
    if (messagesResult.error) throw messagesResult.error;
    if (usageResult.error) throw usageResult.error;

    const grouped = new Map();
    for (const message of messagesResult.data || []) {
      const provider = message.provider || "unknown";
      const model = message.model || "default";
      const key = provider + "::" + model;
      const item = grouped.get(key) || { provider, model, messages: 0 };
      item.messages += 1;
      grouped.set(key, item);
    }

    const usageRows = usageResult.data || [];
    const today = new Date();
    const todayStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const usageByModel = new Map();
    const usageByUser = new Map();
    let todayRequests = 0, monthRequests = 0, estimatedInputTokens = 0, estimatedOutputTokens = 0;
    let reportedCostUsd = 0, pricedRequests = 0;
    for (const event of usageRows) {
      const created = new Date(event.created_at);
      if (created >= todayStart) todayRequests++;
      if (created >= monthStart) monthRequests++;
      estimatedInputTokens += Number(event.input_tokens_estimate || 0);
      estimatedOutputTokens += Number(event.output_tokens_estimate || 0);
      if (event.reported_cost_usd !== null && event.reported_cost_usd !== undefined) {
        reportedCostUsd += Number(event.reported_cost_usd) || 0;
        pricedRequests++;
      }
      const key = event.provider + "::" + event.model;
      const item = usageByModel.get(key) || { provider: event.provider, model: event.model, requests: 0, estimatedInputTokens: 0, estimatedOutputTokens: 0, reportedCostUsd: 0, pricedRequests: 0 };
      item.requests++;
      item.estimatedInputTokens += Number(event.input_tokens_estimate || 0);
      item.estimatedOutputTokens += Number(event.output_tokens_estimate || 0);
      if (event.reported_cost_usd !== null && event.reported_cost_usd !== undefined) {
        item.reportedCostUsd += Number(event.reported_cost_usd) || 0;
        item.pricedRequests++;
      }
      usageByModel.set(key, item);
      if (event.user_id) {
        const user = usageByUser.get(event.user_id) || { userId: event.user_id, requests: 0, estimatedInputTokens: 0, estimatedOutputTokens: 0, reportedCostUsd: 0 };
        user.requests++;
        user.estimatedInputTokens += Number(event.input_tokens_estimate || 0);
        user.estimatedOutputTokens += Number(event.output_tokens_estimate || 0);
        user.reportedCostUsd += Number(event.reported_cost_usd || 0);
        usageByUser.set(event.user_id, user);
      }
    }
    const users = (usersResult.data?.users || []).map(user => ({
      id: user.id,
      email: user.email || null,
      created_at: user.created_at || null,
      last_sign_in_at: user.last_sign_in_at || null
    })).sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || ""))).slice(0, 25);

    return reply(res, 200, {
      isAdmin: true,
      stats: {
        users: usersResult.data?.users?.length || 0,
        usersListCapped: (usersResult.data?.users?.length || 0) >= 1000,
        conversations: conversationsResult.count || 0,
        messages: messagesCountResult.count || 0
      },
      providers: [...grouped.values()].sort((a, b) => b.messages - a.messages),
      usage: {
        sampledEvents: usageRows.length,
        sampleMayBeTruncated: usageRows.length >= 10000,
        todayRequests,
        monthRequests,
        estimatedInputTokens,
        estimatedOutputTokens,
        reportedCostUsd: Number(reportedCostUsd.toFixed(8)),
        pricedRequests,
        unpricedRequests: usageRows.length - pricedRequests,
        byModel: [...usageByModel.values()].sort((a,b) => b.requests - a.requests),
        byUser: [...usageByUser.values()].sort((a,b) => b.requests - a.requests).slice(0,50)
      },
      quotas: {
        dailyRequests: Number.parseInt(process.env.YAZA_DAILY_REQUEST_LIMIT || "50", 10) || 50,
        monthlyRequests: Number.parseInt(process.env.YAZA_MONTHLY_REQUEST_LIMIT || "1000", 10) || 1000,
        guestDailyRequests: Number.parseInt(process.env.YAZA_GUEST_DAILY_REQUEST_LIMIT || "10", 10) || 10
      },
      users,
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error("Yaza admin dashboard error:", error?.message || error);
    return reply(res, 500, { error: "Could not load administration data. Check the server logs and database access." });
  }
}
