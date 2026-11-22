import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";

const PROVIDERS = {
  openai: { key: "OPENAI_API_KEY", model: process.env.OPENAI_MODEL || "gpt-4.1-mini" },
  gemini: { key: "GEMINI_API_KEY", model: process.env.GEMINI_MODEL || "gemini-2.5-flash" },
  openrouter: { key: "OPENROUTER_API_KEY", model: process.env.OPENROUTER_MODEL || "google/gemini-2.5-flash" },
  kimi: { key: "KIMI_API_KEY", model: process.env.KIMI_MODEL || "moonshot-v1-8k" }
};

function cleanMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.slice(-30).filter(m =>
    m && ["user", "assistant"].includes(m.role) &&
    typeof m.content === "string" && m.content.trim()
  ).map(m => ({ role: m.role, content: m.content.slice(0, 20000) }));
}

function providerError(error) {
  console.error("Yaza AI provider error:", error?.message || error);
  if (error?.status === 401) return "The provider rejected its API key. Check the key in your deployment settings.";
  if (error?.status === 429) return "This provider is currently rate-limiting requests. Please wait and try again.";
  return "Yaza AI could not reach that model. Check the provider, model name, and API access, then try again.";
}

function sendEvent(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-cache, no-transform");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const provider = String(req.body?.provider || "openai").toLowerCase();
  const config = PROVIDERS[provider];
  if (!config) return res.status(400).json({ error: "Unsupported AI provider." });

  const apiKey = process.env[config.key];
  if (!apiKey) return res.status(503).json({ error: `${provider} is not configured yet. Add ${config.key} in your deployment environment.` });

  const messages = cleanMessages(req.body?.messages);
  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return res.status(400).json({ error: "Please send a message first." });
  }

  const model = typeof req.body?.model === "string" && req.body.model.length < 120
    ? req.body.model : config.model;

  try {
    let stream;
    let client;
    if (provider === "gemini") {
      const ai = new GoogleGenAI({ apiKey });
      const history = messages.slice(0, -1).map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }]
      }));
      const chat = ai.chats.create({
        model,
        history,
        config: { systemInstruction: "You are Yaza AI, a helpful, thoughtful, and capable AI assistant. Be clear, accurate, and honest about uncertainty." }
      });
      stream = await chat.sendMessageStream({ message: messages[messages.length - 1].content });
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
      client = new OpenAI(options);
      stream = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: "You are Yaza AI, a helpful, thoughtful, and capable AI assistant. Be clear, accurate, and honest about uncertainty." },
          ...messages
        ],
        temperature: 0.7,
        stream: true
      });
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    let hasContent = false;
    for await (const chunk of stream) {
      const delta = provider === "gemini"
        ? (chunk.text || "")
        : (chunk.choices?.[0]?.delta?.content || "");
      if (typeof delta === "string" && delta) {
        hasContent = true;
        sendEvent(res, { delta });
      }
    }

    if (!hasContent) sendEvent(res, { error: "The model returned an empty response. Please try again." });
    else sendEvent(res, { done: true, provider, model });
    return res.end();
  } catch (error) {
    const message = providerError(error);
    if (res.headersSent) {
      sendEvent(res, { error: message });
      return res.end();
    }
    return res.status(502).json({ error: message });
  }
}
