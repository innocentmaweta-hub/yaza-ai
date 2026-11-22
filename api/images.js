import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "Method not allowed." }); }
  const authorization = req.headers.authorization || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!token || !supabaseUrl || !supabaseAnonKey) {
    return res.status(401).json({ error: "Sign in to create images. Your session could not be verified." });
  }
  let userId;
  try {
    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data, error } = await authClient.auth.getUser(token);
    if (error || !data?.user) {
      return res.status(401).json({ error: "Your session is invalid or expired. Sign in again." });
    }
    userId = data.user.id;
  } catch (error) {
    console.error("Yaza image authentication error:", error?.message || error);
    return res.status(503).json({ error: "Image generation authentication is temporarily unavailable." });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return res.status(503).json({ error: "Image generation is not configured. Add OPENROUTER_API_KEY in Vercel and redeploy." });
  const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim().slice(0, 4000) : "";
  if (prompt.length < 3) return res.status(400).json({ error: "Describe the image you want to create." });
  const chatId = String(req.body?.chat_id || "");
  const messageId = String(req.body?.message_id || "");
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(chatId) || !uuidPattern.test(messageId)) return res.status(400).json({ error: "The image conversation reference is invalid. Refresh and try again." });
  const model = process.env.OPENROUTER_IMAGE_MODEL || "bytedance-seed/seedream-4.5";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return res.status(503).json({ error: "Wallet billing is not configured." });
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: pricing, error: pricingError } = await admin.from("model_pricing")
    .select("enabled,pricing_mode,message_rate_mwk").eq("model_key","image/generation").maybeSingle();
  if (pricingError) return res.status(503).json({ error: "Image pricing is temporarily unavailable." });
  if (!pricing?.enabled) return res.status(403).json({ error: "Image generation is not currently enabled for paid use. Contact the Yaza administrator." });
  if (pricing.pricing_mode !== "message") return res.status(400).json({ error: "Image generation must use a fixed price per image." });
  const reserveMinor = Math.ceil(Number(pricing.message_rate_mwk || 0) * 100);
  const usageId = randomUUID();
  const { data: reserveRows, error: reserveError } = await admin.rpc("reserve_yaza_usage", {
    p_usage_id:usageId,p_user_id:userId,p_model_key:"image/generation",p_provider:"openrouter-image",p_model:model,
    p_pricing_mode:"message",p_reserved_minor:reserveMinor,p_input_tokens:0,p_output_token_reserve:0,
    p_input_rate:0,p_output_rate:0,p_message_rate:Number(pricing.message_rate_mwk || 0)
  });
  if (reserveError) return res.status(503).json({ error: "Wallet billing is temporarily unavailable." });
  const reservation = Array.isArray(reserveRows) ? reserveRows[0] : reserveRows;
  if (!reservation?.allowed) return res.status(402).json({ error: "Your wallet balance is too low for image generation. Add funds to continue.", walletBalanceMinor:Number(reservation?.balance_minor || 0), requiredMinor:reserveMinor });
  const release = async reason => {
    const { error } = await admin.rpc("release_yaza_usage",{p_usage_id:usageId,p_reason:reason || "Image generation failed"});
    if (error) console.error("Yaza image wallet release error:",error.message);
  };
  try {
    const response = await fetch("https://openrouter.ai/api/v1/images", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      await release("Image provider request failed");
      console.error("Yaza image provider error:", response.status, data?.error?.message || data?.message || "");
      if (response.status === 401) return res.status(502).json({ error: "OpenRouter rejected the API key. Check OPENROUTER_API_KEY in Vercel." });
      if (response.status === 402) return res.status(402).json({ error: "OpenRouter needs image-generation credits for this request. Add credits to your OpenRouter account and try again." });
      if (response.status === 403) return res.status(502).json({ error: "OpenRouter denied image generation. Check your account and model access." });
      if (response.status === 429) return res.status(429).json({ error: "Image generation is being rate-limited. Wait a moment and try again." });
      if (response.status === 404) return res.status(502).json({ error: "The configured image model was not found. Check OPENROUTER_IMAGE_MODEL in Vercel." });
      return res.status(502).json({ error: "The image provider could not complete this request. Please try again." });
    }
    const item = Array.isArray(data.data) ? data.data.find(image => typeof image.b64_json === "string" && image.b64_json.length) : null;
    if (!item) { await release("Image provider returned no image"); return res.status(502).json({ error: "The image provider returned no image. Please try again." }); }
    const mediaType = /^image\/(png|jpeg|webp)$/i.test(item.media_type || "") ? item.media_type : "image/png";
    const imageBuffer = Buffer.from(item.b64_json,"base64");
    if (imageBuffer.length > 10 * 1024 * 1024) { await release("Generated image exceeded the storage limit"); return res.status(413).json({ error:"The generated image is too large to save. Try a simpler image prompt." }); }
    const fileId = randomUUID();
    const extension = mediaType.includes("jpeg") ? "jpg" : mediaType.includes("webp") ? "webp" : "png";
    const fileName = "yaza-image-" + new Date().toISOString().replace(/[:.]/g,"-") + "." + extension;
    const path = userId + "/" + chatId + "/" + messageId + "/" + fileId + "-" + fileName;
    const { error: uploadError } = await admin.storage.from("chat-attachments").upload(path,imageBuffer,{contentType:mediaType,upsert:false});
    if (uploadError) {
      await release("Generated image could not be saved to private storage");
      console.error("Yaza generated image storage error:",uploadError.message);
      return res.status(503).json({ error:"The image was created but could not be saved to your account. No wallet charge was made; please try again." });
    }
    const { error: settleError } = await admin.rpc("settle_yaza_usage",{p_usage_id:usageId,p_actual_minor:reserveMinor});
    if (settleError) console.error("Yaza image wallet settlement error:",settleError.message);
    return res.status(200).json({ attachment:{ id:fileId,name:fileName,type:mediaType,kind:"image",path }, model, cost:Number.isFinite(data.usage?.cost)?data.usage.cost:null, billedAmountMinor:reserveMinor, billingStatus:settleError?"settlement_pending":"settled" });
  } catch (error) {
    await release("Image generation request failed");
    console.error("Yaza image generation error:", error?.message || error);
    return res.status(502).json({ error: "Yaza AI could not reach image generation. Please try again." });
  }
}
