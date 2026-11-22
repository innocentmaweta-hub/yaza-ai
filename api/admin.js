import { createClient } from "@supabase/supabase-js";

const AVAILABLE_MODELS = {
  openai: ["gpt-6.2-astra", "gpt-6.2-sol", "gpt-4.1-mini", "gpt-4.1", "o4-mini"],
  gemini: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
  openrouter: ["openrouter/free", "~google/gemini-flash-latest", "google/gemini-3.7-flash", "openai/gpt-4.1", "deepseek/deepseek-r1", "anthropic/claude-sonnet-4"],
  kimi: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
  claude: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"],
  deepseek: ["deepseek-flash", "deepseek-v4-pro"]
};
const MODEL_LABELS = {
  "openai/gpt-6.2-astra":"OpenAI · GPT-6.2 Astra","openai/gpt-6.2-sol":"OpenAI · GPT-6.2 Sol",
  "openai/gpt-4.1-mini":"OpenAI · GPT-4.1 mini","openai/gpt-4.1":"OpenAI · GPT-4.1","openai/o4-mini":"OpenAI · o4-mini",
  "gemini/gemini-2.5-flash":"Gemini · 2.5 Flash","gemini/gemini-2.5-pro":"Gemini · 2.5 Pro","gemini/gemini-2.0-flash":"Gemini · 2.0 Flash",
  "openrouter/openrouter/free":"OpenRouter · Automatic","openrouter/~google/gemini-flash-latest":"OpenRouter · Gemini Flash latest",
  "openrouter/google/gemini-3.7-flash":"OpenRouter · Gemini 3.7 Flash","openrouter/openai/gpt-4.1":"OpenRouter · GPT-4.1",
  "openrouter/deepseek/deepseek-r1":"OpenRouter · DeepSeek R1","openrouter/anthropic/claude-sonnet-4":"OpenRouter · Claude Sonnet 4",
  "kimi/moonshot-v1-8k":"Kimi · 8K","kimi/moonshot-v1-32k":"Kimi · 32K","kimi/moonshot-v1-128k":"Kimi · 128K",
  "claude/claude-sonnet-5-5":"Claude · Sonnet 5.5","claude/claude-opus-5-5":"Claude · Opus 5.5","claude/claude-haiku-5-5":"Claude · Haiku 5.5",
  "deepseek/deepseek-flash":"DeepSeek · Flash","deepseek/deepseek-v4-pro":"DeepSeek · V4 Pro",
  "image/generation":"Image generation · Seedream 4.5"
};
const ALLOWED_PRICING_KEYS = new Set([...Object.entries(AVAILABLE_MODELS).flatMap(([provider,models]) => models.map(model => provider + "/" + model)), "image/generation"]);

function reply(res, status, body) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  return res.status(status).json(body);
}

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST");
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

    if (req.method === "POST") {
      if (req.body?.action === "set-wachabe-model") {
        const provider = String(req.body?.provider || "").toLowerCase();
        const model = String(req.body?.model || "");
        if (!AVAILABLE_MODELS[provider]?.includes(model)) {
          return reply(res, 400, { error: "Choose a provider and model from the available Yaza model list." });
        }
        const wachabe = { provider, model };
        const { error } = await admin.from("platform_settings").upsert({
          setting_key: "wachabe_model", setting_value: wachabe, updated_at: new Date().toISOString()
        }, { onConflict: "setting_key" });
        if (error) throw error;
        return reply(res, 200, { success: true, wachabe });
      }
      if (req.body?.action === "save-model-pricing") {
        const modelKey = String(req.body?.model_key || "");
        const pricingMode = String(req.body?.pricing_mode || "");
        const enabled = req.body?.enabled === true;
        const inputRate = Number(req.body?.input_rate_per_1k_mwk);
        const outputRate = Number(req.body?.output_rate_per_1k_mwk);
        const messageRate = Number(req.body?.message_rate_mwk);
        if (!ALLOWED_PRICING_KEYS.has(modelKey) || !["tokens","message"].includes(pricingMode)
          || ![inputRate,outputRate,messageRate].every(value => Number.isFinite(value) && value >= 0 && value <= 1000000)) {
          return reply(res, 400, { error: "Check the model and pricing values. Rates must be between 0 and 1,000,000 MWK." });
        }
        if (pricingMode === "tokens" && inputRate + outputRate <= 0 && enabled) {
          return reply(res, 400, { error: "Set an input or output token rate before enabling this model." });
        }
        if (pricingMode === "message" && messageRate <= 0 && enabled) {
          return reply(res, 400, { error: "Set a message price greater than zero before enabling this model." });
        }
        const row = { model_key:modelKey, enabled, pricing_mode:pricingMode, input_rate_per_1k_mwk:inputRate,
          output_rate_per_1k_mwk:outputRate, message_rate_mwk:messageRate, updated_at:new Date().toISOString() };
        const { data, error } = await admin.from("model_pricing").upsert(row,{onConflict:"model_key"}).select("*").single();
        if (error) throw error;
        return reply(res,200,{success:true,pricing:data});
      }
      return reply(res, 400, { error: "Unsupported admin action." });
    }

    const { data: routingRow, error: routingError } = await admin.from("platform_settings")
      .select("setting_value").eq("setting_key", "wachabe_model").maybeSingle();
    if (routingError) throw routingError;
    const configuredRoute = routingRow?.setting_value || { provider: "openrouter", model: "openrouter/free" };
    const wachabe = AVAILABLE_MODELS[configuredRoute.provider]?.includes(configuredRoute.model)
      ? configuredRoute : { provider: "openrouter", model: "openrouter/free" };

    const [usersResult, conversationsResult, messagesCountResult, messagesResult, usageResult, pricingResult, walletCountResult, walletTransactionsResult] = await Promise.all([
      admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
      admin.from("conversations").select("id", { count: "exact", head: true }),
      admin.from("messages").select("id", { count: "exact", head: true }),
      admin.from("messages").select("provider,model,created_at").order("created_at", { ascending: false }).limit(5000),
      admin.from("usage_events").select("user_id,provider,model,public_model_key,billed_amount_minor,billing_status,status,input_tokens_estimate,output_tokens_estimate,prompt_tokens,completion_tokens,reported_cost_usd,created_at").order("created_at", { ascending: false }).limit(10000),
      admin.from("model_pricing").select("*").order("model_key"),
      admin.from("wallet_accounts").select("user_id", { count:"exact", head:true }),
      admin.from("wallet_transactions").select("user_id,kind,amount_minor,reference,metadata,created_at").order("created_at",{ascending:false}).limit(10000)
    ]);
    if (usersResult.error) throw usersResult.error;
    if (conversationsResult.error) throw conversationsResult.error;
    if (messagesCountResult.error) throw messagesCountResult.error;
    if (messagesResult.error) throw messagesResult.error;
    if (usageResult.error) throw usageResult.error;
    if (pricingResult.error) throw pricingResult.error;
    if (walletCountResult.error) throw walletCountResult.error;
    if (walletTransactionsResult.error) throw walletTransactionsResult.error;

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
    let reportedCostUsd = 0, monthReportedCostUsd = 0, pricedRequests = 0;
    for (const event of usageRows) {
      const created = new Date(event.created_at);
      if (created >= todayStart) todayRequests++;
      if (created >= monthStart) monthRequests++;
      estimatedInputTokens += Number(event.input_tokens_estimate || 0);
      estimatedOutputTokens += Number(event.output_tokens_estimate || 0);
      if (event.reported_cost_usd !== null && event.reported_cost_usd !== undefined) {
        reportedCostUsd += Number(event.reported_cost_usd) || 0;
        if (created >= monthStart) monthReportedCostUsd += Number(event.reported_cost_usd) || 0;
        pricedRequests++;
      }
      const key = event.public_model_key || event.provider + "::" + event.model;
      const item = usageByModel.get(key) || { provider: event.provider, model: event.model, publicModelKey:event.public_model_key || null, requests: 0, estimatedInputTokens: 0, estimatedOutputTokens: 0, reportedCostUsd: 0, billedAmountMinor:0, pricedRequests: 0 };
      item.requests++;
      item.estimatedInputTokens += Number(event.input_tokens_estimate || 0);
      item.estimatedOutputTokens += Number(event.output_tokens_estimate || 0);
      item.billedAmountMinor += Number(event.billed_amount_minor || 0);
      if (event.reported_cost_usd !== null && event.reported_cost_usd !== undefined) {
        item.reportedCostUsd += Number(event.reported_cost_usd) || 0;
        item.pricedRequests++;
      }
      usageByModel.set(key, item);
      if (event.user_id) {
        const user = usageByUser.get(event.user_id) || { userId: event.user_id, requests: 0, estimatedInputTokens: 0, estimatedOutputTokens: 0, reportedCostUsd: 0, billedAmountMinor:0 };
        user.requests++;
        user.estimatedInputTokens += Number(event.input_tokens_estimate || 0);
        user.estimatedOutputTokens += Number(event.output_tokens_estimate || 0);
        user.reportedCostUsd += Number(event.reported_cost_usd || 0);
        usageByUser.set(event.user_id, user);
      }
    }
    const walletRows = walletTransactionsResult.data || [];
    const walletModelRevenue = new Map();
    let totalTopupsMinor = 0, totalChargesMinor = 0, monthTopupsMinor = 0, monthChargesMinor = 0;
    for (const item of walletRows) {
      const amount = Number(item.amount_minor || 0);
      const created = new Date(item.created_at);
      if (item.kind === "topup") { totalTopupsMinor += amount; if (created >= monthStart) monthTopupsMinor += amount; }
      if (item.kind === "usage_charge") {
        totalChargesMinor += Math.abs(amount); if (created >= monthStart) monthChargesMinor += Math.abs(amount);
        const modelKey = item.metadata?.model_key || "unknown";
        walletModelRevenue.set(modelKey,(walletModelRevenue.get(modelKey)||0)+Math.abs(amount));
        const user = usageByUser.get(item.user_id) || { userId:item.user_id, requests:0, estimatedInputTokens:0, estimatedOutputTokens:0, reportedCostUsd:0, billedAmountMinor:0 };
        user.billedAmountMinor += Math.abs(amount);
        usageByUser.set(item.user_id,user);
      }
    }
    const userEmails = new Map((usersResult.data?.users || []).map(user => [user.id, user.email || user.id.slice(0, 8)]));
    const users = (usersResult.data?.users || []).map(user => ({
      id: user.id,
      email: user.email || null,
      created_at: user.created_at || null,
      last_sign_in_at: user.last_sign_in_at || null
    })).sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || ""))).slice(0, 25);

    return reply(res, 200, {
      isAdmin: true,
      wachabe: { ...wachabe, availableModels: AVAILABLE_MODELS },
      modelPricing: (pricingResult.data || []).map(item => ({ ...item, label: MODEL_LABELS[item.model_key] || item.model_key,
        input_rate_per_1k_mwk:Number(item.input_rate_per_1k_mwk || 0), output_rate_per_1k_mwk:Number(item.output_rate_per_1k_mwk || 0), message_rate_mwk:Number(item.message_rate_mwk || 0) })),
      wallet: {
        accounts: walletCountResult.count || 0,
        totalTopupsMinor, totalChargesMinor, monthTopupsMinor, monthChargesMinor,
        transactionSample: walletRows.length, sampleMayBeTruncated: walletRows.length >= 10000,
        revenueByModel: [...walletModelRevenue.entries()].map(([modelKey,amountMinor])=>({modelKey,label:MODEL_LABELS[modelKey]||modelKey,amountMinor})).sort((a,b)=>b.amountMinor-a.amountMinor)
      },
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
        monthReportedCostUsd: Number(monthReportedCostUsd.toFixed(8)),
        pricedRequests,
        unpricedRequests: usageRows.length - pricedRequests,
        byModel: [...usageByModel.values()].sort((a,b) => b.requests - a.requests),
        byUser: [...usageByUser.values()].sort((a,b) => b.requests - a.requests).slice(0,50).map(item => ({ ...item, account: userEmails.get(item.userId) || item.userId.slice(0, 8) }))
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
