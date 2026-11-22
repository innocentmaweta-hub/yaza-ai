import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "node:crypto";

const PROVIDERS = {
  openai: { key: "OPENAI_API_KEY", model: process.env.OPENAI_MODEL || "gpt-4.1-mini" },
  gemini: { key: "GEMINI_API_KEY", model: process.env.GEMINI_MODEL || "gemini-2.5-flash" },
  openrouter: { key: "OPENROUTER_API_KEY", model: process.env.OPENROUTER_MODEL || "openrouter/free" },
  kimi: { key: "KIMI_API_KEY", model: process.env.KIMI_MODEL || "moonshot-v1-8k" },
  claude: { key: "ANTHROPIC_API_KEY", model: process.env.CLAUDE_MODEL || "claude-sonnet-5-5" },
  deepseek: { key: "DEEPSEEK_API_KEY", model: process.env.DEEPSEEK_MODEL || "deepseek-flash" }
};

const ALLOWED_MODELS = {
  openai: ["gpt-4.1-mini", "gpt-4.1", "o4-mini"],
  gemini: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
  openrouter: ["openrouter/free"],
  kimi: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
  claude: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"],
  deepseek: ["deepseek-flash", "deepseek-v4-pro"],
  yaza: ["wachabe"]
};

function cleanMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.slice(-30).filter(m =>
    m && ["user", "assistant"].includes(m.role) &&
    typeof m.content === "string" && m.content.trim()
  ).map(m => ({ role: m.role, content: m.content.slice(0, 20000) }));
}

function providerError(error, provider = "AI") {
  console.error("Yaza AI provider error:", { provider, status: error?.status, message: error?.message || error });
  const status = Number(error?.status || error?.code);
  const label = ({ openrouter: "OpenRouter", openai: "OpenAI", gemini: "Gemini", kimi: "Kimi", claude: "Claude", deepseek: "DeepSeek" })[provider] || "AI provider";
  if (status === 401) return `${label} rejected the API key. Check the ${provider === "claude" ? "ANTHROPIC_API_KEY" : provider === "deepseek" ? "DEEPSEEK_API_KEY" : provider.toUpperCase() + "_API_KEY"} setting.`;
  if (status === 402) return `${label} reports insufficient account credits. Check the provider account balance.`;
  if (status === 403) return `${label} denied this request. Check your account restrictions or model permissions.`;
  if (status === 404) return `${label} could not find this model. Check the selected model and API access.`;
  if (status === 408 || status === 504) return "The model took too long to respond. Please try again.";
  if (status === 429) return `${label} is rate-limiting requests. Please wait and try again.`;
  if (status === 502 || status === 503) return `${label} is temporarily unavailable. Try again shortly.`;
  return `Yaza AI could not reach ${label}. Check the provider key, model name, and API access, then try again.`;
}


async function* streamClaudeResponse({ apiKey, model, messages, systemInstruction }) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: 4096, system: systemInstruction, messages, stream: true })
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const error = new Error(detail.slice(0, 1000) || "Claude API request failed.");
    error.status = response.status;
    throw error;
  }
  if (!response.body) throw new Error("Claude returned an empty response stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const parseEvent = function* (block) {
    const data = block.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trim()).join("\n");
    if (!data || data === "[DONE]") return;
    let payload;
    try { payload = JSON.parse(data); } catch { return; }
    if (payload.type === "error") {
      const error = new Error(payload.error?.message || "Claude returned a streaming error.");
      error.status = payload.error?.type === "overloaded_error" ? 503 : 502;
      throw error;
    }
    if (payload.type === "message_start" && Number.isFinite(payload.message?.usage?.input_tokens)) {
      yield { usage: { prompt_tokens: payload.message.usage.input_tokens } };
    } else if (payload.type === "content_block_delta" && payload.delta?.type === "text_delta" && payload.delta.text) {
      yield { choices: [{ delta: { content: payload.delta.text } }] };
    } else if (payload.type === "message_delta" && Number.isFinite(payload.usage?.output_tokens)) {
      yield { usage: { completion_tokens: payload.usage.output_tokens } };
    }
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() || "";
      for (const block of blocks) yield* parseEvent(block);
    }
    buffer += decoder.decode();
    if (buffer.trim()) yield* parseEvent(buffer);
  } finally { reader.releaseLock(); }
}

function sendEvent(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}


function quotaSettings() {
  const number = (value, fallback) => {
    const parsed = Number.parseInt(value || "", 10);
    return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 1000000) : fallback;
  };
  return {
    daily: number(process.env.YAZA_DAILY_REQUEST_LIMIT, 50),
    monthly: number(process.env.YAZA_MONTHLY_REQUEST_LIMIT, 1000),
    guestDaily: number(process.env.YAZA_GUEST_DAILY_REQUEST_LIMIT, 10)
  };
}

function estimateTokens(characters) {
  return Math.max(0, Math.ceil(Math.max(0, characters) / 4));
}

async function recordUsage(admin, details) {
  if (!admin || !details?.subjectKey) return;
  const { error } = await admin.from("usage_events").insert({
    user_id: details.userId || null,
    subject_key: details.subjectKey,
    provider: details.provider,
    model: details.model,
    public_model_key: details.publicModelKey || null,
    billed_amount_minor: Number.isFinite(details.billedAmountMinor) ? details.billedAmountMinor : null,
    billing_status: details.billingStatus || null,
    status: details.status,
    input_characters: details.inputCharacters || 0,
    output_characters: details.outputCharacters || 0,
    input_tokens_estimate: estimateTokens(details.inputCharacters || 0),
    output_tokens_estimate: estimateTokens(details.outputCharacters || 0),
    prompt_tokens: Number.isFinite(details.promptTokens) ? details.promptTokens : null,
    completion_tokens: Number.isFinite(details.completionTokens) ? details.completionTokens : null,
    reported_cost_usd: Number.isFinite(details.reportedCostUsd) ? details.reportedCostUsd : null
  });
  if (error) console.error("Yaza usage logging error:", error.message);
}

async function prepareQuota(req, provider, model) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) throw new Error("Usage controls are not configured. Please contact the Yaza administrator.");
  const authClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const authorization = req.headers.authorization || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) {
    const error = new Error("Sign in to use Yaza AI. Paid model access requires a wallet.");
    error.status = 401;
    throw error;
  }
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData?.user) {
    const error = new Error("Your session has expired. Sign in again to continue.");
    error.status = 401;
    throw error;
  }
  const userId = authData.user.id;
  const identity = "user:" + userId;
  const subjectKey = createHash("sha256").update(process.env.SUPABASE_SERVICE_ROLE_KEY + ":" + identity).digest("hex");
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const limits = quotaSettings();
  const dailyLimit = limits.daily;
  const { data: quotaData, error: quotaError } = await admin.rpc("consume_yaza_quota", {
    p_subject_key: subjectKey,
    p_daily_limit: dailyLimit,
    p_monthly_limit: limits.monthly
  });
  if (quotaError) {
    console.error("Yaza quota check error:", quotaError.message);
    throw new Error("Yaza usage controls are temporarily unavailable. Please try again shortly.");
  }
  const quota = Array.isArray(quotaData) ? quotaData[0] : quotaData;
  if (!quota?.allowed) {
    const error = new Error(`Your Yaza usage limit has been reached (${dailyLimit} requests per day or ${limits.monthly} per month). Please try again after the limit resets.`);
    error.status = 429;
    error.quota = { dailyUsed: quota?.daily_used || dailyLimit, dailyLimit, monthlyUsed: quota?.monthly_used || 0, monthlyLimit: limits.monthly };
    throw error;
  }
  return { admin, userId, subjectKey, limits, dailyUsed: quota.daily_used, monthlyUsed: quota.monthly_used };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-cache, no-transform");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const requestedProvider = String(req.body?.provider || "openai").toLowerCase();
  let provider = requestedProvider;
  let model = typeof req.body?.model === "string" && req.body.model.length < 120
    ? req.body.model : "";
  if (requestedProvider === "openrouter") model = "openrouter/free";
  const publicModelKey = requestedProvider + "/" + model;
  if (!ALLOWED_MODELS[requestedProvider]?.includes(model)) {
    return res.status(400).json({ error: "That model is not enabled for this provider." });
  }

  if (requestedProvider === "yaza") {
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) return res.status(503).json({ error: "Yaza AI routing is not configured. Please contact the administrator." });
    try {
      const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data, error } = await admin.from("platform_settings").select("setting_value").eq("setting_key", "wachabe_model").maybeSingle();
      if (error) throw error;
      const route = data?.setting_value || { provider: "openrouter", model: "openrouter/free" };
      if (!ALLOWED_MODELS[route.provider]?.includes(route.model)) throw new Error("The configured Wachabe model is invalid.");
      provider = route.provider;
      model = route.model;
    } catch (error) {
      console.error("Yaza Wachabe routing error:", error?.message || error);
      return res.status(503).json({ error: "Wachabe is temporarily unavailable because its model configuration could not be loaded." });
    }
  }

  const config = PROVIDERS[provider];
  if (!config) return res.status(400).json({ error: "Unsupported AI provider." });
  const apiKey = process.env[config.key];
  if (!apiKey) return res.status(503).json({ error: `${provider} is not configured yet. Add ${config.key} in your deployment environment.` });

  const messages = cleanMessages(req.body?.messages);
  if (Array.isArray(req.body?.attachments) && req.body.attachments.length > 10) {
    return res.status(400).json({ error: "Attach no more than 10 files or scanned pages at once." });
  }
  const attachments = Array.isArray(req.body?.attachments) ? req.body.attachments : [];
  if (!messages.length && attachments.length) messages.push({ role: "user", content: "Please review the attached files." });
  if (attachments.filter(file => file?.kind === "image").length > 10) {
    return res.status(400).json({ error: "Too many image pages. Attach fewer scanned pages and try again." });
  }
  const imagePayloadBytes = attachments.filter(file => file?.kind === "image" && typeof file.data === "string")
    .reduce((total, file) => total + Math.ceil(file.data.length * 0.75), 0);
  if (imagePayloadBytes > 2.8 * 1024 * 1024) {
    return res.status(413).json({ error: "The scanned pages are too large to send together. Attach fewer pages or use a smaller PDF." });
  }
  for (const file of attachments) {
    if (!file || typeof file.name !== "string" || file.name.length > 180) {
      return res.status(400).json({ error: "One of the attached files is invalid." });
    }
    if (file.kind === "image" && (typeof file.data !== "string" || !/^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(file.data))) {
      return res.status(400).json({ error: `The image ${file.name} has an unsupported format. Use PNG, JPG, WEBP or GIF.` });
    }
    if (file.kind === "text" && (typeof file.text !== "string" || file.text.length > 1_000_000)) {
      return res.status(400).json({ error: `The text file ${file.name} is too large or unreadable.` });
    }
  }
  if ((!messages.length && !attachments.length) || (messages.length && messages[messages.length - 1].role !== "user")) {
    return res.status(400).json({ error: "Please send a message first." });
  }

  if (!model) model = config.model;
  if (!ALLOWED_MODELS[provider]?.includes(model)) {
    return res.status(400).json({ error: "That model is not enabled for this provider." });
  }
  let quotaContext;
  try {
    quotaContext = await prepareQuota(req, provider, model);
  } catch (error) {
    return res.status(error.status || 503).json({ error: error.message, quota: error.quota || undefined });
  }
  const inputCharacters = messages.reduce((sum, item) => sum + item.content.length, 0)
    + attachments.reduce((sum, file) => sum + (typeof file.text === "string" ? file.text.length : 0), 0);
  const imageCount = attachments.filter(file => file.kind === "image").length;
  const inputTokenEstimate = estimateTokens(inputCharacters) + imageCount * 1024;
  const freeOpenRouter = provider === "openrouter";
  let pricingMode = "free";
  let inputRate = 0;
  let outputRate = 0;
  let messageRate = 0;
  let outputTokenReserve = 0;
  let reserveMinor = 0;
  let usageId = null;

  if (!freeOpenRouter) {
    const { data: pricing, error: pricingError } = await quotaContext.admin.from("model_pricing")
      .select("enabled,pricing_mode,input_rate_per_1k_mwk,output_rate_per_1k_mwk,message_rate_mwk")
      .eq("model_key", publicModelKey).maybeSingle();
    if (pricingError) {
      console.error("Yaza model pricing lookup error:", pricingError.message);
      return res.status(503).json({ error: "Model billing is temporarily unavailable. Please try again shortly." });
    }
    if (!pricing?.enabled) {
      return res.status(403).json({ error: "This model is not currently available for paid use. Please choose another model or contact the Yaza administrator." });
    }
    inputRate = Number(pricing.input_rate_per_1k_mwk || 0);
    outputRate = Number(pricing.output_rate_per_1k_mwk || 0);
    messageRate = Number(pricing.message_rate_mwk || 0);
    pricingMode = pricing.pricing_mode;
    if (!["tokens", "message"].includes(pricingMode)
      || ![inputRate, outputRate, messageRate].every(value => Number.isFinite(value) && value >= 0 && value <= 1000000)
      || (pricingMode === "tokens" && inputRate + outputRate <= 0)
      || (pricingMode === "message" && messageRate <= 0)) {
      return res.status(503).json({ error: "This model's billing configuration is invalid. Please contact the Yaza administrator." });
    }
    outputTokenReserve = pricingMode === "tokens" ? 4096 : 0;
    const reserveMwk = pricingMode === "message"
      ? messageRate
      : ((inputTokenEstimate * 1.25 * inputRate) + (outputTokenReserve * outputRate)) / 1000;
    reserveMinor = Math.ceil(reserveMwk * 100);
    usageId = randomUUID();
    const { data: reserveRows, error: reserveError } = await quotaContext.admin.rpc("reserve_yaza_usage", {
      p_usage_id: usageId, p_user_id: quotaContext.userId, p_model_key: publicModelKey,
      p_provider: provider, p_model: model, p_pricing_mode: pricingMode,
      p_reserved_minor: reserveMinor, p_input_tokens: Math.ceil(inputTokenEstimate * 1.25),
      p_output_token_reserve: outputTokenReserve, p_input_rate: inputRate,
      p_output_rate: outputRate, p_message_rate: messageRate
    });
    if (reserveError) {
      console.error("Yaza wallet reservation error:", reserveError.message);
      return res.status(503).json({ error: "Wallet billing is temporarily unavailable. Please try again." });
    }
    const reservation = Array.isArray(reserveRows) ? reserveRows[0] : reserveRows;
    if (!reservation?.allowed) {
      return res.status(402).json({
        error: "Your wallet balance is too low for this request. Add funds to continue.",
        walletBalanceMinor: Number(reservation?.balance_minor || 0),
        requiredMinor: reserveMinor
      });
    }
  }

  let outputCharacters = 0;
  let promptTokens = null;
  let completionTokens = null;
  let reportedCostUsd = null;
  let billedAmountMinor = freeOpenRouter ? 0 : null;
  let billingStatus = freeOpenRouter ? "free" : "reserved";
  let usageRecorded = false;
  const saveUsage = async status => {
    if (usageRecorded) return;
    usageRecorded = true;
    if (freeOpenRouter) {
      billedAmountMinor = 0;
      billingStatus = status === "completed" ? "free" : "free_no_charge";
    } else if (status === "completed") {
      const billedInputTokens = Number.isFinite(promptTokens) ? promptTokens : inputTokenEstimate;
      const billedOutputTokens = Number.isFinite(completionTokens) ? completionTokens : estimateTokens(outputCharacters);
      const calculatedMinor = pricingMode === "message"
        ? Math.ceil(messageRate * 100)
        : Math.ceil(((billedInputTokens * inputRate + billedOutputTokens * outputRate) / 1000) * 100);
      billedAmountMinor = Math.min(reserveMinor, Math.max(0, calculatedMinor));
      if (calculatedMinor > reserveMinor) billingStatus = "settled_at_reserve_cap";
      const { error } = await quotaContext.admin.rpc("settle_yaza_usage", {
        p_usage_id: usageId, p_actual_minor: billedAmountMinor
      });
      if (error) {
        billingStatus = "settlement_pending";
        console.error("Yaza wallet settlement error:", error.message);
      } else if (billingStatus !== "settled_at_reserve_cap") billingStatus = "settled";
    } else {
      const { error } = await quotaContext.admin.rpc("release_yaza_usage", {
        p_usage_id: usageId, p_reason: "AI response failed"
      });
      billingStatus = error ? "release_pending" : "released";
      if (error) console.error("Yaza wallet release error:", error.message);
    }
    await recordUsage(quotaContext.admin, {
      userId: quotaContext.userId, subjectKey: quotaContext.subjectKey, provider, model,
      publicModelKey, status, inputCharacters, outputCharacters, promptTokens, completionTokens,
      reportedCostUsd, billedAmountMinor, billingStatus
    });
  };
  const requestedMode = String(req.body?.mode || "general").toLowerCase();
  const mode = ["general", "school", "innovator", "entrepreneur", "joking", "developer"].includes(requestedMode) ? requestedMode : "general";
  const modeInstructions = {
    general: "MODE: GENERAL. Be a versatile everyday assistant. Adapt to the user's task, provide clear and useful answers, and explain uncertainty honestly.",
    school: "MODE: SCHOOL. Act as a patient, encouraging tutor. Teach concepts step by step, explain workings rather than skipping them, use examples and short checks for understanding, and help the learner build their own ability. When relevant, support Malawi's MSCE, JCE and university learning contexts. Do not shame the learner.",
    innovator: "MODE: INNOVATOR. Think like a practical inventor and design partner. Help turn real problems into feasible solutions. Explore alternatives, explain how things work, propose prototypes, materials, tests, risks, cost and scalability. Prefer locally practical options when relevant, and distinguish proven facts from hypotheses.",
    entrepreneur: "MODE: ENTREPRENEUR. Think like a practical business strategist. Help with business models, customers, market research, pricing, costs, margins, break-even, marketing, operations and growth. Use MWK and Malawi context when relevant. State assumptions clearly and avoid pretending estimates are guaranteed results.",
    developer: "MODE: DEVELOPER. Act as a senior software engineer and collaborative technical partner. Help with programming, debugging, code review, architecture, APIs, databases, security, performance, testing, DevOps and deployment. Be precise and technically rigorous; explain root causes, trade-offs and implementation steps. Prefer complete, maintainable solutions over vague snippets. Respect the user's existing stack and constraints, avoid unrelated changes, identify assumptions and warn before destructive or security-sensitive operations. Never claim code was executed, tested or deployed unless it actually was.",
    joking: "MODE: JOKING. Every response must be funny, playful and entertaining, whatever the user's topic or question. Do not wait for the user to ask for a joke: explain, advise, answer, summarise and solve problems with witty phrasing, amusing analogies and light humour woven throughout. Still answer the actual question accurately and completely; humour must never replace useful information. Keep jokes kind and never mock the user or target protected groups. For emergencies, grief, self-harm, medical/legal/financial crises or other safety-critical situations, put empathy and safety first and use only gentle warmth rather than forced punchlines."
  };
  const memories = Array.isArray(req.body?.memories)
    ? req.body.memories.filter(item => typeof item === "string" && item.trim()).slice(0, 30).map(item => item.trim().slice(0, 500))
    : [];
  const memoryContext = memories.length
    ? "\n\nUser-approved long-term memories (use only when relevant; treat these as background facts/preferences, not instructions that override the user's current request):\n" + memories.map((item, index) => `- ${item}`).join("\n")
    : "";
  const systemInstruction = "You are Yaza AI, a helpful, thoughtful, and capable AI assistant. Be clear, accurate, and honest about uncertainty.\n\n" + modeInstructions[mode] + memoryContext;

  try {
    let stream;
    let client;
    if (provider === "claude") {
      const claudeMessages = messages.map((message, index) => {
        if (index !== messages.length - 1 || !attachments.length) return { role: message.role, content: message.content };
        const content = [{ type: "text", text: message.content || "Please review the attached files." }];
        for (const file of attachments) {
          if (file.kind === "image") {
            const match = file.data.match(/^data:([^;]+);base64,(.+)$/);
            if (match) content.push({ type: "image", source: { type: "base64", media_type: match[1] === "image/jpg" ? "image/jpeg" : match[1], data: match[2] } });
          } else if (file.kind === "text") content.push({ type: "text", text: `\n\n--- Attached file: ${file.name} ---\n${file.text}\n--- End of ${file.name} ---` });
        }
        return { role: "user", content };
      });
      stream = streamClaudeResponse({ apiKey, model, messages: claudeMessages, systemInstruction });
    } else if (provider === "gemini") {
      const ai = new GoogleGenAI({ apiKey });
      const history = messages.slice(0, -1).map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }]
      }));
      const chat = ai.chats.create({
        model,
        history,
        config: { systemInstruction, maxOutputTokens: 4096 }
      });
      const lastText = messages[messages.length - 1]?.content || "Please review the attached files.";
      const parts = [{ text: lastText }];
      for (const file of attachments) {
        if (file.kind === "image") {
          const match = file.data.match(/^data:([^;]+);base64,(.+)$/);
          if (match) parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
        } else if (file.kind === "text") {
          parts.push({ text: `\n\n--- Attached file: ${file.name} ---\n${file.text}\n--- End of ${file.name} ---` });
        }
      }
      stream = await chat.sendMessageStream({ message: parts });
    } else {
      const options = { apiKey };
      if (provider === "openrouter") {
        options.baseURL = "https://openrouter.ai/api/v1";
        options.defaultHeaders = {
          "HTTP-Referer": process.env.APP_URL || "https://yaza.ai",
          "X-Title": "Yaza AI"
        };
      }
      if (provider === "kimi") options.baseURL = "https://api.moonshot.ai/v1";
      if (provider === "deepseek") options.baseURL = "https://api.deepseek.com";
      client = new OpenAI(options);
      const providerMessages = messages.map((message, index) => {
        if (index !== messages.length - 1 || !attachments.length) return message;
        const content = [{ type: "text", text: message.content }];
        for (const file of attachments) {
          if (file.kind === "image") content.push({ type: "image_url", image_url: { url: file.data } });
          else if (file.kind === "text") content.push({ type: "text", text: `\n\n--- Attached file: ${file.name} ---\n${file.text}\n--- End of ${file.name} ---` });
        }
        return { role: message.role, content };
      });
      stream = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: systemInstruction },
          ...providerMessages
        ],
        temperature: 0.7,
        stream: true,
        ...(provider === "openai" ? { max_completion_tokens: 4096 } : { max_tokens: 4096 }),
        ...(provider === "kimi" ? {} : { stream_options: { include_usage: true } })
      });
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    let hasContent = false;
    for await (const chunk of stream) {
      if (provider !== "gemini" && chunk.error) {
        const streamError = new Error(chunk.error.message || "The model provider returned an error.");
        streamError.status = chunk.error.code || chunk.error.status;
        throw streamError;
      }
      if (provider === "gemini" && chunk.usageMetadata) {
        promptTokens = Number.isFinite(chunk.usageMetadata.promptTokenCount) ? chunk.usageMetadata.promptTokenCount : promptTokens;
        completionTokens = Number.isFinite(chunk.usageMetadata.candidatesTokenCount) ? chunk.usageMetadata.candidatesTokenCount : completionTokens;
      } else if (chunk.usage) {
        promptTokens = Number.isFinite(chunk.usage.prompt_tokens) ? chunk.usage.prompt_tokens : promptTokens;
        completionTokens = Number.isFinite(chunk.usage.completion_tokens) ? chunk.usage.completion_tokens : completionTokens;
        if (Number.isFinite(chunk.usage.cost)) reportedCostUsd = chunk.usage.cost;
      }
      const delta = provider === "gemini"
        ? (chunk.text || "")
        : (chunk.choices?.[0]?.delta?.content || "");
      if (typeof delta === "string" && delta) {
        hasContent = true;
        outputCharacters += delta.length;
        sendEvent(res, { delta });
      }
    }

    if (!hasContent) sendEvent(res, { error: "The model returned an empty response. Please try again." });
    else sendEvent(res, { done: true, provider, model });
    await saveUsage(hasContent ? "completed" : "failed");
    return res.end();
  } catch (error) {
    if (quotaContext) await saveUsage("failed");
    const message = providerError(error, provider);
    if (res.headersSent) {
      sendEvent(res, { error: message });
      return res.end();
    }
    return res.status(502).json({ error: message });
  }
}
