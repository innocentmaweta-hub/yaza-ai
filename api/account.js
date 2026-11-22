import { createClient } from "@supabase/supabase-js";

export const config = { maxDuration: 60 };

function reply(res, status, body) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  return res.status(status).json(body);
}

async function listAllFiles(storage, prefix = "") {
  const files = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await storage.from("chat-attachments").list(prefix, {
      limit: 1000, offset, sortBy: { column: "name", order: "asc" }
    });
    if (error) throw new Error("Could not safely inspect your uploaded files: " + error.message);
    const entries = data || [];
    for (const entry of entries) {
      const path = prefix ? prefix + "/" + entry.name : entry.name;
      if (entry.id == null) files.push(...await listAllFiles(storage, path));
      else files.push(path);
    }
    if (entries.length < 1000) break;
  }
  return files;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return reply(res, 405, { error: "Method not allowed." });
  }
  const authorization = req.headers.authorization || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return reply(res, 401, { error: "Sign in to continue." });
  if (req.body?.confirmation !== "DELETE MY ACCOUNT") {
    return reply(res, 400, { error: "The account deletion confirmation phrase did not match." });
  }

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) {
    return reply(res, 503, { error: "Secure account deletion is not configured. Contact Yaza support." });
  }

  try {
    const authClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !authData?.user) return reply(res, 401, { error: "Your session is invalid or expired. Sign in again." });

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const files = await listAllFiles(admin.storage, authData.user.id);
    for (let index = 0; index < files.length; index += 100) {
      const { error } = await admin.storage.from("chat-attachments").remove(files.slice(index, index + 100));
      if (error) throw new Error("Could not remove all uploaded files. Your account was not deleted. " + error.message);
    }

    const { error: deleteError } = await admin.auth.admin.deleteUser(authData.user.id);
    if (deleteError) throw new Error("Uploaded files were cleared, but account deletion did not finish. Please retry or contact support. " + deleteError.message);
    return reply(res, 200, { success: true, deletedFiles: files.length });
  } catch (error) {
    console.error("Yaza account deletion error:", error?.message || error);
    return reply(res, 500, { error: error.message || "Could not safely delete your account. Please contact Yaza support." });
  }
}
