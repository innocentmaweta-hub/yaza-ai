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

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
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
    let answer = "";
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
      const result = await chat.sendMessage({ message: messages[messages.length - 1].content });
      answer = result.text || "";
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
      const client = new OpenAI(options);
      const completion = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: "You are Yaza AI, a helpful, thoughtful, and capable AI assistant. Be clear, accurate, and honest about uncertainty." },
          ...messages
        ],
        temperature: 0.7
      });
      answer = completion.choices?.[0]?.message?.content || "";
    }

    if (!answer) return res.status(502).json({ error: "The model returned an empty response. Please try again." });
    return res.status(200).json({ answer, provider, model });
  } catch (error) {
    console.error("Yaza AI provider error:", provider, error?.message || error);
    const message = error?.status === 401
      ? "The provider rejected its API key. Check the key in your deployment settings."
      : error?.status === 429
        ? "This provider is currently rate-limiting requests. Please wait and try again."
        : "Yaza AI could not reach that model. Check the provider, model name, and API access, then try again.";
    return res.status(502).json({ error: message });
  }
}