export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "Method not allowed." }); }
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return res.status(503).json({ error: "Image generation is not configured. Add OPENROUTER_API_KEY in Vercel and redeploy." });
  const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim().slice(0, 4000) : "";
  if (prompt.length < 3) return res.status(400).json({ error: "Describe the image you want to create." });
  const model = process.env.OPENROUTER_IMAGE_MODEL || "bytedance-seed/seedream-4.5";
  try {
    const response = await fetch("https://openrouter.ai/api/v1/images", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error("Yaza image provider error:", response.status, data?.error?.message || data?.message || "");
      if (response.status === 401) return res.status(502).json({ error: "OpenRouter rejected the API key. Check OPENROUTER_API_KEY in Vercel." });
      if (response.status === 402) return res.status(402).json({ error: "OpenRouter needs image-generation credits for this request. Add credits to your OpenRouter account and try again." });
      if (response.status === 403) return res.status(502).json({ error: "OpenRouter denied image generation. Check your account and model access." });
      if (response.status === 429) return res.status(429).json({ error: "Image generation is being rate-limited. Wait a moment and try again." });
      if (response.status === 404) return res.status(502).json({ error: "The configured image model was not found. Check OPENROUTER_IMAGE_MODEL in Vercel." });
      return res.status(502).json({ error: "The image provider could not complete this request. Please try again." });
    }
    const item = Array.isArray(data.data) ? data.data.find(image => typeof image.b64_json === "string" && image.b64_json.length) : null;
    if (!item) return res.status(502).json({ error: "The image provider returned no image. Please try again." });
    const mediaType = /^image\/(png|jpeg|webp)$/i.test(item.media_type || "") ? item.media_type : "image/png";
    return res.status(200).json({ image: `data:${mediaType};base64,${item.b64_json}`, model, cost: Number.isFinite(data.usage?.cost) ? data.usage.cost : null });
  } catch (error) {
    console.error("Yaza image generation error:", error?.message || error);
    return res.status(502).json({ error: "Yaza AI could not reach image generation. Please try again." });
  }
}
