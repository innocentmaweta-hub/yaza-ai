import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

function reply(res, status, body) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  return res.status(status).json(body);
}

function config() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) throw new Error("Conversation sharing is not configured on the server.");
  return { url, anonKey, serviceKey };
}

async function authenticate(req, settings) {
  const authorization = req.headers.authorization || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return null;
  const authClient = createClient(settings.url, settings.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  const { data, error } = await authClient.auth.getUser(token);
  return error || !data?.user ? null : data.user;
}

export default async function handler(req, res) {
  let settings;
  try { settings = config(); }
  catch (error) { return reply(res, 503, { error: error.message }); }

  const admin = createClient(settings.url, settings.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });

  try {
    if (req.method === "GET") {
      const token = String(req.query?.token || "");
      if (!/^[a-f0-9]{64}$/i.test(token)) return reply(res, 404, { error: "This shared conversation is unavailable or its link has been revoked." });
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const { data: share, error: shareError } = await admin.from("conversation_shares")
        .select("title,messages,revoked_at").eq("token_hash", tokenHash).maybeSingle();
      if (shareError) throw shareError;
      if (!share || share.revoked_at) return reply(res, 404, { error: "This shared conversation is unavailable or its link has been revoked." });
      return reply(res, 200, { title: share.title, messages: Array.isArray(share.messages) ? share.messages : [] });
    }

    if (req.method === "POST" || req.method === "DELETE") {
      const user = await authenticate(req, settings);
      if (!user) return reply(res, 401, { error: "Sign in to manage conversation share links." });
      const conversationId = String(req.body?.conversationId || "");
      if (!/^[0-9a-f-]{36}$/i.test(conversationId)) return reply(res, 400, { error: "A valid conversation is required." });
      const { data: conversation, error: conversationError } = await admin.from("conversations")
        .select("id,title").eq("id", conversationId).eq("user_id", user.id).maybeSingle();
      if (conversationError) throw conversationError;
      if (!conversation) return reply(res, 404, { error: "Conversation not found in your account." });

      if (req.method === "POST") {
        const { data: messages, error: messagesError } = await admin.from("messages")
          .select("id,role,content,created_at").eq("conversation_id", conversationId)
          .order("created_at", { ascending: true }).limit(500);
        if (messagesError) throw messagesError;
        if (!messages?.length) return reply(res, 400, { error: "Add at least one message before sharing this conversation." });
        const snapshot = messages.map(message => ({
          id: message.id, role: message.role, content: String(message.content || "").slice(0, 20000),
          createdAt: message.created_at
        }));
        const token = randomBytes(32).toString("hex");
        const tokenHash = createHash("sha256").update(token).digest("hex");
        const { error: insertError } = await admin.from("conversation_shares").insert({
          user_id: user.id, conversation_id: conversationId, token_hash: tokenHash,
          title: String(conversation.title || "Shared conversation").slice(0, 120), messages: snapshot
        });
        if (insertError) throw insertError;
        return reply(res, 201, { token });
      }

      const { error: revokeError } = await admin.from("conversation_shares")
        .update({ revoked_at: new Date().toISOString() })
        .eq("user_id", user.id).eq("conversation_id", conversationId).is("revoked_at", null);
      if (revokeError) throw revokeError;
      return reply(res, 200, { success: true });
    }

    res.setHeader("Allow", "GET, POST, DELETE");
    return reply(res, 405, { error: "Method not allowed." });
  } catch (error) {
    console.error("Yaza conversation sharing error:", error?.message || error);
    return reply(res, 500, { error: "Could not complete the sharing request. Please try again." });
  }
}
