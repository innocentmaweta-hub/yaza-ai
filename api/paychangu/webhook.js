import { createHmac, timingSafeEqual } from "node:crypto";
import { getAdminClient, verifyAndCreditTopup } from "../../lib/paychangu.js";

export const config = { api: { bodyParser: false } };

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "Method not allowed." }); }
  const webhookSecret = process.env.PAYCHANGU_WEBHOOK_SECRET;
  if (!webhookSecret) return res.status(503).json({ error: "Webhook verification is not configured." });
  try {
    const raw = await readRawBody(req);
    const signature = String(req.headers.signature || req.headers["x-paychangu-signature"] || "");
    const expected = createHmac("sha256", webhookSecret).update(raw).digest("hex");
    const suppliedBuffer = Buffer.from(signature, "utf8");
    const expectedBuffer = Buffer.from(expected, "utf8");
    if (suppliedBuffer.length !== expectedBuffer.length || !timingSafeEqual(suppliedBuffer, expectedBuffer)) {
      return res.status(401).json({ error: "Invalid webhook signature." });
    }
    const payload = JSON.parse(raw.toString("utf8") || "{}");
    const txRef = String(payload.tx_ref || payload.data?.tx_ref || payload.meta?.tx_ref || payload.data?.meta?.tx_ref || "");
    if (!txRef) return res.status(400).json({ error: "Missing transaction reference." });
    const result = await verifyAndCreditTopup(getAdminClient(), txRef);
    if (result.status === "not_found") return res.status(404).json({ error: "Unknown transaction reference." });
    return res.status(200).json({ received: true, status: result.status });
  } catch (error) {
    console.error("Yaza PayChangu webhook error:", error?.message || error);
    return res.status(500).json({ error: "Webhook processing failed." });
  }
}
