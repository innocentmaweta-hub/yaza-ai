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
    const [usersResult, conversationsResult, messagesCountResult, messagesResult] = await Promise.all([
      admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
      admin.from("conversations").select("id", { count: "exact", head: true }),
      admin.from("messages").select("id", { count: "exact", head: true }),
      admin.from("messages").select("provider,model,created_at").order("created_at", { ascending: false }).limit(5000)
    ]);
    if (usersResult.error) throw usersResult.error;
    if (conversationsResult.error) throw conversationsResult.error;
    if (messagesCountResult.error) throw messagesCountResult.error;
    if (messagesResult.error) throw messagesResult.error;

    const grouped = new Map();
    for (const message of messagesResult.data || []) {
      const provider = message.provider || "unknown";
      const model = message.model || "default";
      const key = provider + "::" + model;
      const item = grouped.get(key) || { provider, model, messages: 0 };
      item.messages += 1;
      grouped.set(key, item);
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
      users,
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error("Yaza admin dashboard error:", error?.message || error);
    return reply(res, 500, { error: "Could not load administration data. Check the server logs and database access." });
  }
}
