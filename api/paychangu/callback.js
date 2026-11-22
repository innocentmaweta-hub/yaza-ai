import { getAdminClient, verifyAndCreditTopup } from "../_lib/paychangu.js";

function baseUrl() {
  return String(process.env.APP_URL || "https://yaza-ai.vercel.app").replace(/\/$/, "");
}

function getTxRef(req) {
  if (req.method === "GET") return String(req.query?.tx_ref || "");
  const body = req.body;
  if (body && typeof body === "object") return String(body.tx_ref || body.data?.tx_ref || "");
  if (typeof body === "string") {
    try { const parsed = JSON.parse(body); return String(parsed.tx_ref || parsed.data?.tx_ref || ""); } catch {}
    const params = new URLSearchParams(body);
    return String(params.get("tx_ref") || "");
  }
  return "";
}

export default async function handler(req, res) {
  if (!["GET","POST"].includes(req.method)) { res.setHeader("Allow","GET, POST"); return res.status(405).end(); }
  const txRef = getTxRef(req);
  if (!/^YAZA-[0-9a-f-]{36}$/i.test(txRef)) return res.status(400).json({ error:"Invalid payment reference." });
  try {
    const result = await verifyAndCreditTopup(getAdminClient(),txRef);
    const destination = new URL("/",baseUrl());
    destination.searchParams.set("payment","return");
    destination.searchParams.set("tx_ref",txRef);
    destination.searchParams.set("status",result.status);
    if (req.method === "GET") return res.redirect(302,destination.toString());
    return res.status(200).json({ received:true,status:result.status });
  } catch (error) {
    console.error("Yaza PayChangu callback error:",error?.message || error);
    if (req.method === "GET") {
      const destination = new URL("/",baseUrl());
      destination.searchParams.set("payment","return");
      destination.searchParams.set("tx_ref",txRef);
      destination.searchParams.set("status","pending");
      return res.redirect(302,destination.toString());
    }
    return res.status(500).json({ error:"Payment callback could not be verified." });
  }
}
