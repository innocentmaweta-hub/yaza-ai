import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./lib/supabase.js";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import mammoth from "mammoth/mammoth.browser";
import {
  Archive, ArchiveRestore, ArrowDown, ArrowUp, AudioLines, Check, ChevronDown, Code2, Compass, Copy, CreditCard, LogIn, LogOut, Mic, MicOff,
  FileText, Globe2, ImagePlus, Link2, Menu, MessageSquare, MoreHorizontal, Pencil,
  PanelLeftClose, Plus, Search, Settings2, Share2, Sparkles, SquarePen, Trash2, UserRoundPlus,
  X, Zap
} from "lucide-react";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const PROVIDERS = {
  openai: { label: "OpenAI", models: [{ id: "gpt-4.1-mini", label: "GPT-4.1 mini" }, { id: "gpt-4.1", label: "GPT-4.1" }, { id: "o4-mini", label: "o4-mini" }] },
  gemini: { label: "Gemini", models: [{ id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" }, { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" }, { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" }] },
  openrouter: { label: "OpenRouter", models: [{ id: "openrouter/free", label: "Free model (automatic)" }, { id: "~google/gemini-flash-latest", label: "Gemini Flash (latest)" }, { id: "google/gemini-3.7-flash", label: "Gemini 3.7 Flash" }, { id: "openai/gpt-4.1", label: "GPT-4.1" }, { id: "deepseek/deepseek-r1", label: "DeepSeek R1" }, { id: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4" }] },
  kimi: { label: "Kimi", models: [{ id: "moonshot-v1-8k", label: "Kimi 8K" }, { id: "moonshot-v1-32k", label: "Kimi 32K" }, { id: "moonshot-v1-128k", label: "Kimi 128K" }] },
  yaza: { label: "Yaza AI", models: [{ id: "wachabe", label: "Wachabe" }] }
};
const STORAGE = "yaza-ai-conversations-v1";
const makeChat = () => ({ id: crypto.randomUUID(), title: "New chat", messages: [], updatedAt: Date.now() });
const PROVIDER_SETTINGS = "yaza-ai-provider-settings-v1";
const USER_PREFERENCES = "yaza-ai-user-preferences-v1";
const DEFAULT_PREFERENCES = { theme: "dark", voiceInputEnabled: true, readAloudEnabled: true };
function readProviderSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(PROVIDER_SETTINGS) || "{}");
    const provider = PROVIDERS[saved.provider] ? saved.provider : "openai";
    const model = PROVIDERS[provider].models.some(item => item.id === saved.model)
      ? saved.model
      : PROVIDERS[provider].models[0].id;
    return { provider, model };
  } catch {
    return { provider: "openai", model: PROVIDERS.openai.models[0].id };
  }
}


function renderInlineMarkdown(value) {
  const text = String(value || "");
  const tokenPattern = /(\`[^\`]+\`|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\*[^*\n]+\*|_[^_\n]+_|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g;
  return text.split(tokenPattern).filter(Boolean).map((part, index) => {
    if (part.startsWith("\`") && part.endsWith("\`")) return <code className="md-inline-code" key={index}>{part.slice(1, -1)}</code>;
    if ((part.startsWith("**") && part.endsWith("**")) || (part.startsWith("__") && part.endsWith("__"))) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("~~") && part.endsWith("~~")) return <del key={index}>{part.slice(2, -2)}</del>;
    if ((part.startsWith("*") && part.endsWith("*")) || (part.startsWith("_") && part.endsWith("_"))) return <em key={index}>{part.slice(1, -1)}</em>;
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
    if (link) return <a key={index} href={link[2]} target="_blank" rel="noopener noreferrer">{link[1]}</a>;
    return part;
  });
}

function renderMarkdown(content, onCopyCode) {
  const lines = String(content || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let index = 0;
  const isSpecial = line => /^\s*(```|#{1,6}\s|>|[-*+]\s|\d+[.)]\s)/.test(line) || (line.includes("|") && index + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1]));
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index++; continue; }
    const fence = line.match(/^\s*```\s*([\w+-]*)\s*$/);
    if (fence) {
      index++;
      const codeLines = [];
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) codeLines.push(lines[index++]);
      if (index < lines.length) index++;
      const code = codeLines.join("\n");
      blocks.push(<div className="md-code-block" key={blocks.length}><div className="md-code-toolbar"><span>{fence[1] || "Code"}</span><button type="button" onClick={() => onCopyCode(code)}>Copy code</button></div><pre><code>{code}</code></pre></div>);
      continue;
    }
    const heading = line.match(/^\s*(#{1,6})\s+(.+)$/);
    if (heading) { const level = heading[1].length; const Tag = `h${level}`; blocks.push(<Tag key={blocks.length}>{renderInlineMarkdown(heading[2])}</Tag>); index++; continue; }
    if (line.includes("|") && index + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1])) {
      const cells = row => row.trim().replace(/^\||\|$/g, "").split("|").map(cell => cell.trim());
      const headers = cells(line);
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) rows.push(cells(lines[index++]));
      blocks.push(<div className="md-table-wrap" key={blocks.length}><table><thead><tr>{headers.map((cell,i)=><th key={i}>{renderInlineMarkdown(cell)}</th>)}</tr></thead><tbody>{rows.map((row,r)=><tr key={r}>{headers.map((_,i)=><td key={i}>{renderInlineMarkdown(row[i] || "")}</td>)}</tr>)}</tbody></table></div>);
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) quote.push(lines[index++].replace(/^\s*>\s?/, ""));
      blocks.push(<blockquote key={blocks.length}>{quote.map((item,i)=><Fragment key={i}>{i>0 && <br/>}{renderInlineMarkdown(item)}</Fragment>)}</blockquote>);
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items = [];
      while (index < lines.length && (ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*+]\s+/).test(lines[index])) {
        items.push(lines[index++].replace(ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*+]\s+/, ""));
      }
      const Tag = ordered ? "ol" : "ul";
      blocks.push(<Tag key={blocks.length}>{items.map((item,i)=><li key={i}>{renderInlineMarkdown(item)}</li>)}</Tag>);
      continue;
    }
    const paragraph = [line];
    index++;
    while (index < lines.length && lines[index].trim() && !isSpecial(lines[index])) paragraph.push(lines[index++]);
    blocks.push(<p key={blocks.length}>{paragraph.map((item,i)=><Fragment key={i}>{i>0 && <br/>}{renderInlineMarkdown(item)}</Fragment>)}</p>);
  }
  return <div className="markdown-content">{blocks}</div>;
}

function App() {
  const [chats, setChats] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE)) || [makeChat()]; }
    catch { return [makeChat()]; }
  });
  const [activeId, setActiveId] = useState(() => chats[0]?.id);
  const [providerSettings] = useState(readProviderSettings);
  const [provider, setProvider] = useState(providerSettings.provider);
  const [model, setModel] = useState(providerSettings.model);
  const [theme, setTheme] = useState(() => { try { return JSON.parse(localStorage.getItem(USER_PREFERENCES) || "{}").theme === "light" ? "light" : "dark"; } catch { return "dark"; } });
  const [voiceInputEnabled, setVoiceInputEnabled] = useState(() => { try { return JSON.parse(localStorage.getItem(USER_PREFERENCES) || "{}").voiceInputEnabled !== false; } catch { return true; } });
  const [readAloudEnabled, setReadAloudEnabled] = useState(() => { try { return JSON.parse(localStorage.getItem(USER_PREFERENCES) || "{}").readAloudEnabled !== false; } catch { return true; } });
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [preferencesStatus, setPreferencesStatus] = useState("This browser");
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [deleteAccountPhrase, setDeleteAccountPhrase] = useState("");
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState([]);
  const fileInputRef = useRef(null);
  const [sending, setSending] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [providerMenu, setProviderMenu] = useState(false);
  const [modelMenu, setModelMenu] = useState(false);
  const [search, setSearch] = useState("");
  const [showArchivedChats, setShowArchivedChats] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [imageMode, setImageMode] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState(null);
  const recognitionRef = useRef(null);
  const voiceBasePromptRef = useRef("");
  const [notice, setNotice] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [sharedView, setSharedView] = useState(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareError, setShareError] = useState("");
  const [session, setSession] = useState(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState("general");
  const [authMode, setAuthMode] = useState("signin");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [cloudReady, setCloudReady] = useState(false);
  const [cloudStatus, setCloudStatus] = useState("");
  const [memories, setMemories] = useState([]);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [memoryDraft, setMemoryDraft] = useState("");
  const [editingMemoryId, setEditingMemoryId] = useState(null);
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [adminAccess, setAdminAccess] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminData, setAdminData] = useState(null);
  const [wachabeProvider, setWachabeProvider] = useState("openrouter");
  const [wachabeModel, setWachabeModel] = useState("openrouter/free");
  const [wachabeSaving, setWachabeSaving] = useState(false);
  const [usageData, setUsageData] = useState(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageError, setUsageError] = useState("");
  const [walletData, setWalletData] = useState(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const [walletError, setWalletError] = useState("");
  const [topupAmount, setTopupAmount] = useState("1000");
  const [topupBusy, setTopupBusy] = useState(false);
  const [pricingDrafts, setPricingDrafts] = useState({});
  const [pricingSaving, setPricingSaving] = useState({});
  const endRef = useRef(null);
  const textareaRef = useRef(null);
  const activeChat = chats.find(c => c.id === activeId) || chats[0];
  const messages = activeChat?.messages || [];
  const isNew = messages.length === 0;

  useEffect(() => { localStorage.setItem(STORAGE, JSON.stringify(chats)); }, [chats]);
  useEffect(() => () => { try { recognitionRef.current?.stop(); window.speechSynthesis?.cancel(); } catch {} }, []);
  useEffect(() => {
    localStorage.setItem(PROVIDER_SETTINGS, JSON.stringify({ provider, model }));
    localStorage.setItem(USER_PREFERENCES, JSON.stringify({ theme, voiceInputEnabled, readAloudEnabled }));
    document.documentElement.dataset.theme = theme;
  }, [provider, model, theme, voiceInputEnabled, readAloudEnabled]);

  useEffect(() => {
    if (!supabase) { setCloudStatus("Local mode"); setCloudReady(true); return; }
    let alive = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return;
      setSession(data.session || null);
      if (data.session?.user) {
        await loadCloudPreferences(data.session.user.id);
        await loadCloudChats(data.session.user.id);
        await loadCloudMemories();
        await checkAdminAccess(data.session);
      } else setCloudReady(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession || null);
      if (!nextSession) { setPreferencesReady(false); setPreferencesStatus("This browser"); setCloudReady(true); setCloudStatus("Signed out"); setMemories([]); setAdminAccess(false); setAdminData(null); setAdminOpen(false); setUsageData(null); setUsageError(""); setWalletData(null); setWalletError(""); }
      else { setPreferencesReady(false); setCloudReady(false); setTimeout(async () => { await loadCloudPreferences(nextSession.user.id); await loadCloudChats(nextSession.user.id); await loadCloudMemories(); await checkAdminAccess(nextSession); }, 0); }
    });
    return () => { alive = false; listener.subscription.unsubscribe(); };
  }, []);

  async function loadCloudPreferences(userId) {
    if (!supabase || !userId) return;
    try {
      const { data, error } = await supabase.from("user_preferences")
        .select("preferences").eq("user_id", userId).maybeSingle();
      if (error) throw error;
      if (data?.preferences) {
        const saved = data.preferences;
        const nextProvider = PROVIDERS[saved.provider] ? saved.provider : provider;
        const nextModel = PROVIDERS[nextProvider].models.some(item => item.id === saved.model)
          ? saved.model : PROVIDERS[nextProvider].models[0].id;
        setProvider(nextProvider);
        setModel(nextModel);
        setTheme(saved.theme === "light" ? "light" : "dark");
        setVoiceInputEnabled(saved.voiceInputEnabled !== false);
        setReadAloudEnabled(saved.readAloudEnabled !== false);
      } else {
        const local = { provider, model, theme, voiceInputEnabled, readAloudEnabled };
        const { error: saveError } = await supabase.from("user_preferences")
          .upsert({ user_id: userId, preferences: local, updated_at: new Date().toISOString() });
        if (saveError) throw saveError;
      }
      setPreferencesStatus("Synced to your account");
    } catch (error) {
      console.error("Yaza preferences load:", error);
      setPreferencesStatus("Sync issue — using this browser");
      setNotice("Could not sync your settings. Your browser preferences are still available.");
    } finally { setPreferencesReady(true); }
  }

  useEffect(() => {
    if (!supabase || !session?.user || !preferencesReady) return;
    const timer = setTimeout(async () => {
      try {
        const preferences = { provider, model, theme, voiceInputEnabled, readAloudEnabled };
        const { error } = await supabase.from("user_preferences").upsert({
          user_id: session.user.id, preferences, updated_at: new Date().toISOString()
        });
        if (error) throw error;
        setPreferencesStatus("Synced to your account");
      } catch (error) {
        console.error("Yaza preferences save:", error);
        setPreferencesStatus("Sync issue — using this browser");
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [provider, model, theme, voiceInputEnabled, readAloudEnabled, session, preferencesReady]);

  async function loadCloudChats(userId) {
    if (!supabase) return;
    try {
      const { data: rows, error } = await supabase.from("conversations").select("id,title,updated_at,is_archived").eq("user_id", userId).order("updated_at", { ascending: false });
      if (error) throw error;
      const ids = (rows || []).map(row => row.id);
      let messageRows = [];
      if (ids.length) {
        const result = await supabase.from("messages").select("id,conversation_id,role,content,provider,model,attachments,created_at").in("conversation_id", ids).order("created_at", { ascending: true });
        if (result.error) throw result.error;
        messageRows = result.data || [];
      }
      const remoteChats = (rows || []).map(row => ({
        id: row.id, title: row.title, isArchived: row.is_archived === true, updatedAt: new Date(row.updated_at).getTime(),
        messages: messageRows.filter(m => m.conversation_id === row.id).map(m => ({ id: m.id, role: m.role, content: m.content, provider: m.provider, model: m.model, attachments: m.attachments || [] }))
      }));
      if (remoteChats.length) { setChats(remoteChats); setActiveId((remoteChats.find(chat => !chat.isArchived) || remoteChats[0]).id); }
      setCloudStatus("Synced");
    } catch (error) {
      console.error("Yaza cloud history:", error);
      setCloudStatus("Sync issue");
      setNotice("Could not load cloud history. Check the Supabase database setup.");
    } finally { setCloudReady(true); }
  }

  useEffect(() => {
    if (!supabase || !session?.user || !cloudReady) return;
    const persist = async () => {
      try {
        for (const chat of chats) {
          const { error: conversationError } = await supabase.from("conversations").upsert({
            id: chat.id, user_id: session.user.id, title: chat.title,
            is_archived: chat.isArchived === true,
            updated_at: new Date(chat.updatedAt || Date.now()).toISOString()
          });
          if (conversationError) throw conversationError;
          if (chat.messages.length) {
            const rows = chat.messages.map(message => ({
              id: message.id, conversation_id: chat.id, role: message.role, content: message.content,
              provider: message.provider || null, model: message.model || null, attachments: message.attachments || []
            }));
            const { error } = await supabase.from("messages").upsert(rows);
            if (error) throw error;
          }
        }
        setCloudStatus("Synced");
      } catch (error) {
        console.error("Yaza cloud save:", error);
        setCloudStatus("Sync issue");
      }
    };
    const timer = setTimeout(persist, 700);
    return () => clearTimeout(timer);
  }, [chats, session, cloudReady]);

  async function checkAdminAccess(currentSession) {
    if (!currentSession?.access_token) { setAdminAccess(false); return; }
    try {
      const response = await fetch("/api/admin", { headers: { Authorization: "Bearer " + currentSession.access_token } });
      const data = await response.json().catch(() => ({}));
      setAdminAccess(response.ok && data.isAdmin === true);
    } catch { setAdminAccess(false); }
  }

  async function openAdminDashboard() {
    if (!session?.access_token || adminBusy) return;
    setAdminBusy(true);
    setAdminOpen(true);
    try {
      const response = await fetch("/api/admin", { headers: { Authorization: "Bearer " + session.access_token } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not load the admin dashboard.");
      setAdminData(data);
      setWachabeProvider(data.wachabe?.provider || "openrouter");
      setWachabeModel(data.wachabe?.model || "openrouter/free");
      setPricingDrafts(Object.fromEntries((data.modelPricing || []).map(item => [item.model_key, { ...item }])));
    } catch (error) { setNotice(error.message || "Could not load the admin dashboard."); setAdminOpen(false); }
    finally { setAdminBusy(false); }
  }

  async function saveWachabeModel() {
    if (!session?.access_token || wachabeSaving) return;
    setWachabeSaving(true);
    try {
      const response = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token },
        body: JSON.stringify({ action: "set-wachabe-model", provider: wachabeProvider, model: wachabeModel })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not update Wachabe.");
      setAdminData(current => current ? { ...current, wachabe: data.wachabe } : current);
      setNotice("Wachabe's model has been updated for all Yaza AI users.");
    } catch (error) {
      setNotice(error.message || "Could not update Wachabe's model.");
    } finally { setWachabeSaving(false); }
  }

  function updatePricingDraft(modelKey, field, value) {
    setPricingDrafts(current => ({ ...current, [modelKey]: { ...(current[modelKey] || {}), [field]: value } }));
  }

  async function saveModelPricing(modelKey) {
    if (!session?.access_token || pricingSaving[modelKey]) return;
    const draft = pricingDrafts[modelKey]; if (!draft) return;
    setPricingSaving(current => ({ ...current, [modelKey]: true }));
    try {
      const response = await fetch("/api/admin", { method:"POST", headers:{ "Content-Type":"application/json", Authorization:"Bearer " + session.access_token },
        body:JSON.stringify({ action:"save-model-pricing", model_key:modelKey, enabled:draft.enabled===true, pricing_mode:draft.pricing_mode||"tokens", input_rate_per_1k_mwk:Number(draft.input_rate_per_1k_mwk||0), output_rate_per_1k_mwk:Number(draft.output_rate_per_1k_mwk||0), message_rate_mwk:Number(draft.message_rate_mwk||0) }) });
      const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || "Could not save model pricing.");
      setAdminData(current => current ? { ...current, modelPricing:(current.modelPricing||[]).map(item => item.model_key===modelKey ? { ...data.pricing, label:item.label } : item) } : current);
      setPricingDrafts(current => ({ ...current, [modelKey]:{ ...data.pricing, label:draft.label } })); setNotice("Pricing saved for " + modelKey + ".");
    } catch (error) { setNotice(error.message || "Could not save model pricing."); }
    finally { setPricingSaving(current => ({ ...current, [modelKey]:false })); }
  }

  async function loadWallet() {
    if (!session?.access_token) { setWalletData(null); setWalletError("Sign in to use your Yaza wallet."); return; }
    setWalletLoading(true); setWalletError("");
    try { const response = await fetch("/api/wallet", { headers:{ Authorization:"Bearer " + session.access_token } }); const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not load your wallet."); setWalletData(data);
    } catch (error) { setWalletError(error.message || "Could not load your wallet."); } finally { setWalletLoading(false); }
  }

  async function startWalletTopup() {
    if (!session?.access_token || topupBusy) { if (!session?.access_token) { setAuthMode("signin"); setAuthOpen(true); } return; }
    const amount = Number(topupAmount); if (!Number.isSafeInteger(amount) || amount < 500 || amount > 500000) { setWalletError("Enter a whole amount between MK 500 and MK 500,000."); return; }
    setTopupBusy(true); setWalletError("");
    try { const response = await fetch("/api/payments/create", { method:"POST", headers:{ "Content-Type":"application/json", Authorization:"Bearer " + session.access_token }, body:JSON.stringify({ amount }) });
      const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || "Could not start PayChangu checkout."); window.location.assign(data.checkoutUrl);
    } catch (error) { setWalletError(error.message || "Could not start PayChangu checkout."); setTopupBusy(false); }
  }
  async function loadUsageReport() {
    if (!session?.access_token) { setUsageData(null); setUsageError("Sign in to view account usage."); return; }
    setUsageLoading(true); setUsageError("");
    try {
      const response = await fetch("/api/usage", { headers: { Authorization: "Bearer " + session.access_token } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not load usage.");
      setUsageData(data);
    } catch (error) { setUsageError(error.message || "Could not load usage."); }
    finally { setUsageLoading(false); }
  }

  async function loadCloudMemories() {
    if (!supabase) return;
    const { data, error } = await supabase.from("user_memories")
      .select("id,content,created_at,updated_at")
      .order("updated_at", { ascending: false });
    if (error) {
      console.error("Yaza memory load:", error);
      setNotice("Could not load your saved memories. Check the Yaza memory table in Supabase.");
      return;
    }
    setMemories(data || []);
  }

  async function saveMemory(event) {
    event?.preventDefault();
    const content = memoryDraft.trim();
    if (!content || !session?.user || memoryBusy) return;
    if (content.length > 500) { setNotice("Each memory must be 500 characters or fewer."); return; }
    setMemoryBusy(true);
    try {
      const query = supabase.from("user_memories");
      const result = editingMemoryId
        ? await query.update({ content, updated_at: new Date().toISOString() }).eq("id", editingMemoryId).select("id,content,created_at,updated_at").single()
        : await query.insert({ user_id: session.user.id, content }).select("id,content,created_at,updated_at").single();
      if (result.error) throw result.error;
      setMemories(old => editingMemoryId
        ? old.map(item => item.id === editingMemoryId ? result.data : item).sort((a,b) => new Date(b.updated_at)-new Date(a.updated_at))
        : [result.data, ...old]);
      setMemoryDraft("");
      setEditingMemoryId(null);
      setNotice("Memory saved to your Yaza account.");
    } catch (error) {
      setNotice(error.message || "Could not save this memory.");
    } finally { setMemoryBusy(false); }
  }

  async function removeMemory(id) {
    if (!supabase || memoryBusy) return;
    setMemoryBusy(true);
    try {
      const { error } = await supabase.from("user_memories").delete().eq("id", id);
      if (error) throw error;
      setMemories(old => old.filter(item => item.id !== id));
      if (editingMemoryId === id) { setEditingMemoryId(null); setMemoryDraft(""); }
    } catch (error) { setNotice(error.message || "Could not delete this memory."); }
    finally { setMemoryBusy(false); }
  }

  async function submitAuth(event) {
    event.preventDefault();
    if (!supabase) return;
    setAuthBusy(true); setNotice("");
    try {
      const result = authMode === "signup"
        ? await supabase.auth.signUp({
            email: authEmail.trim(),
            password: authPassword,
            options: { emailRedirectTo: "https://yaza-ai.vercel.app/" }
          })
        : await supabase.auth.signInWithPassword({ email: authEmail.trim(), password: authPassword });
      if (result.error) throw result.error;
      if (authMode === "signup" && !result.data.session) setNotice("Check your email to confirm your Yaza AI account, then sign in.");
      else { setAuthOpen(false); setAuthPassword(""); }
    } catch (error) { setNotice(error.message || "Authentication failed."); }
    finally { setAuthBusy(false); }
  }

  async function signOut() {
    if (supabase) await supabase.auth.signOut();
    setSession(null);
    setCloudStatus("Signed out");
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const txRef = params.get("tx_ref");
    if (params.get("payment") !== "return" || !txRef || !session?.access_token) return;
    let alive = true;
    (async () => {
      try {
        const response = await fetch("/api/payments/verify", { method:"POST", headers:{ "Content-Type":"application/json", Authorization:"Bearer " + session.access_token }, body:JSON.stringify({ tx_ref:txRef }) });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Could not verify the PayChangu payment.");
        if (alive) {
          setSettingsOpen(true); setSettingsTab("billing");
          setNotice(data.status==="success" ? "Your Yaza wallet top-up has been confirmed." : data.status==="pending" ? "PayChangu is still processing your payment. Refresh your wallet shortly." : "The payment was not completed.");
          await loadWallet();
        }
      } catch (error) {
        if (alive) { setSettingsOpen(true); setSettingsTab("billing"); setWalletError(error.message || "Payment verification failed."); }
      } finally {
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete("payment"); cleanUrl.searchParams.delete("tx_ref"); cleanUrl.searchParams.delete("status");
        window.history.replaceState({}, "", cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);
      }
    })();
    return () => { alive = false; };
  }, [session?.access_token]);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("share");
    if (!token) return;
    let alive = true;
    setShareLoading(true);
    fetch(`/api/share?token=${encodeURIComponent(token)}`)
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "This shared conversation is unavailable.");
        if (alive) setSharedView(data);
      })
      .catch(error => { if (alive) setShareError(error.message || "Could not load this shared conversation."); })
      .finally(() => { if (alive) setShareLoading(false); });
    return () => { alive = false; };
  }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, sending]);
  useEffect(() => {
    const onKey = e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); document.querySelector(".search-input")?.focus(); }
      if (e.key === "Escape") { setProviderMenu(false); setModelMenu(false); setAccountMenuOpen(false); setSettingsOpen(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const visibleChats = useMemo(() => {
    const term = search.trim().toLowerCase();
    return chats
      .filter(chat => (chat.isArchived === true) === showArchivedChats)
      .filter(chat => !term || chat.title.toLowerCase().includes(term) ||
        (chat.messages || []).some(message => String(message.content || "").toLowerCase().includes(term)))
      .sort((a,b) => b.updatedAt - a.updatedAt);
  }, [chats, search, showArchivedChats]);

  function updateChat(id, updater) {
    setChats(old => old.map(c => c.id === id ? { ...updater(c), updatedAt: Date.now() } : c));
  }
  function newChat() {
    const chat = makeChat();
    setChats(old => [chat, ...old]);
    setActiveId(chat.id);
    setPrompt("");
    setNotice("");
  }
  function chooseProvider(id) {
    setProvider(id);
    setModel(PROVIDERS[id].models[0].id);
    setProviderMenu(false);
    setModelMenu(false);
  }
  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
      reader.readAsDataURL(file);
    });
  }
  async function renderPdfPageForOcr(page) {
    const viewport = page.getViewport({ scale: 1.35 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Your browser could not prepare a scanned PDF page for OCR.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport }).promise;
    const data = canvas.toDataURL("image/jpeg", 0.68);
    canvas.width = 0;
    canvas.height = 0;
    return data;
  }
  async function addFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    if (!supabase || !session?.user) {
      setNotice("Sign in to Yaza AI before attaching files so they can be saved securely to your account.");
      setAuthMode("signin");
      setAuthOpen(true);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    const supported = files.filter(file =>
      /^image\/(png|jpeg|jpg|webp|gif)$/i.test(file.type) ||
      file.type === "application/pdf" || /\.pdf$/i.test(file.name) ||
      file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || /\.docx$/i.test(file.name) ||
      /\.(txt|md|csv|json|xml|html|css|js|jsx|ts|tsx|py|java|c|cpp|sql|log)$/i.test(file.name)
    );
    if (supported.length !== files.length) setNotice("Supported: images, PDF, DOCX and common text/code files.");
    const remaining = Math.max(0, 5 - attachments.length);
    const chosen = supported.slice(0, remaining);
    if (supported.length > remaining) setNotice("You can attach up to 5 files per message.");
    try {
      const imageBytes = attachments.filter(file => file.kind === "image").reduce((sum, file) => sum + (file.file?.size || 0), 0) + chosen.filter(file => file.type.startsWith("image/")).reduce((sum, file) => sum + file.size, 0);
      if (imageBytes > 2.8 * 1024 * 1024) throw new Error("Please keep the combined image attachments below 2.8 MB per message.");
      const loaded = await Promise.all(chosen.map(async file => {
        if (file.size > 10 * 1024 * 1024) throw new Error(`${file.name} is larger than 10 MB. Please choose a smaller file.`);
        const id = crypto.randomUUID();
        if (file.type.startsWith("image/")) {
          if (file.size > 2.5 * 1024 * 1024) throw new Error(`${file.name} is larger than 2.5 MB. Please choose a smaller image.`);
          return { id, name: file.name, type: file.type, kind: "image", data: await readFileAsDataUrl(file), file };
        }
        if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
          const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
          const pages = [];
          const ocrImages = [];
          for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
            const page = await pdf.getPage(pageNumber);
            const content = await page.getTextContent();
            const pageText = content.items.map(item => item.str || "").join(" ").trim();
            if (pageText) {
              pages.push(`--- Page ${pageNumber} ---\n${pageText}`);
            } else if (ocrImages.length < 5) {
              const data = await renderPdfPageForOcr(page);
              ocrImages.push({ name: `${file.name} — scanned page ${pageNumber}`, type: "image/jpeg", kind: "image", data });
            }
            page.cleanup?.();
          }
          const extracted = pages.join("\n\n").slice(0, 100000);
          if (!extracted.trim() && !ocrImages.length) throw new Error(`${file.name} does not contain readable text or pages that could be prepared for OCR.`);
          return { id, name: file.name, type: "application/pdf", kind: "text", text: extracted, ocrImages, file };
        }
        if (file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || /\.docx$/i.test(file.name)) {
          const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
          const extracted = (result.value || "").slice(0, 100000);
          if (!extracted.trim()) throw new Error(`${file.name} does not contain readable text.`);
          return { id, name: file.name, type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", kind: "text", text: extracted, file };
        }
        if (file.size > 1024 * 1024) throw new Error(`${file.name} is larger than 1 MB. Please choose a smaller text file.`);
        return { id, name: file.name, type: file.type || "text/plain", kind: "text", text: (await file.text()).slice(0, 100000), file };
      }));
      const imagePayloadBytes = [...attachments, ...loaded].reduce((total, item) => {
        const directImageBytes = item.kind === "image" && item.data ? Math.ceil(item.data.length * 0.75) : 0;
        const scannedPageBytes = (item.ocrImages || []).reduce((sum, page) => sum + Math.ceil(page.data.length * 0.75), 0);
        return total + directImageBytes + scannedPageBytes;
      }, 0);
      if (imagePayloadBytes > 2.8 * 1024 * 1024) {
        throw new Error("The combined images and scanned PDF pages exceed 2.8 MB. Attach fewer scanned pages or smaller images.");
      }
      setAttachments(old => [...old, ...loaded].slice(0, 5));
      setNotice("");
    } catch (error) { setNotice(error.message || "Could not read the selected file."); }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function openAttachment(file) {
    if (!supabase || !file?.path) return;
    const tab = window.open("about:blank", "_blank");
    const { data, error } = await supabase.storage.from("chat-attachments").createSignedUrl(file.path, 60);
    if (error || !data?.signedUrl) {
      if (tab) tab.close();
      setNotice(error?.message || "Could not open this saved attachment.");
      return;
    }
    if (tab) tab.location.href = data.signedUrl;
    else window.location.href = data.signedUrl;
  }

  async function sendMessage(text = prompt) {
    const content = text.trim();
    if ((!content && !attachments.length) || sending) return;
    if (!session?.user) { setNotice("Sign in to use Yaza AI. Paid model access requires a wallet."); setAuthMode("signin"); setAuthOpen(true); return; }
    const pendingAttachments = attachments;
    const messageContent = content || "Please review the attached file(s).";
    if (pendingAttachments.length && (!supabase || !session?.user)) {
      setNotice("Sign in to save attachments permanently before sending them.");
      setAuthMode("signin"); setAuthOpen(true); return;
    }
    let chat = activeChat;
    if (!chat) { chat = makeChat(); setChats([chat]); setActiveId(chat.id); }
    const userMessageId = crypto.randomUUID();
    const assistantMessage = { id: crypto.randomUUID(), role: "assistant", content: "", provider, model, streaming: true };
    setPrompt("");
    setAttachments([]);
    setSending(true);
    setNotice("");
    let userMessage;
    try {
      let webContext = "";
      let webSources = [];
      if (webSearchEnabled) {
        const searchResponse = await fetch("/api/search", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: content || "information relevant to the attached file" })
        });
        const searchData = await searchResponse.json().catch(() => ({}));
        if (!searchResponse.ok) throw new Error(searchData.error || "Web search failed.");
        webSources = Array.isArray(searchData.results) ? searchData.results : [];
        if (webSources.length) {
          webContext = "\n\nUse the following live web search results to answer the user's request. Cite relevant claims with [1], [2], etc. Do not invent facts beyond these results.\n\n" + webSources.map((item, index) => `[${index + 1}] ${item.title}\nURL: ${item.url}\nSummary: ${item.content}`).join("\n\n");
        } else webContext = "\n\nThe web search returned no results. Say so clearly and do not pretend you searched successfully.";
      }
      const savedAttachments = [];
      for (const file of pendingAttachments) {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "attachment";
        const path = `${session.user.id}/${chat.id}/${userMessageId}/${file.id}-${safeName}`;
        const { error } = await supabase.storage.from("chat-attachments").upload(path, file.file, {
          contentType: file.type || "text/plain", upsert: false
        });
        if (error) {
          if (savedAttachments.length) await supabase.storage.from("chat-attachments").remove(savedAttachments.map(item => item.path));
          throw new Error(`Could not save ${file.name}: ${error.message}`);
        }
        savedAttachments.push({ id: file.id, name: file.name, type: file.type, kind: file.kind, path });
      }
      userMessage = { id: userMessageId, role: "user", content: messageContent, attachments: savedAttachments };
      const nextMessages = [...chat.messages, userMessage];
      updateChat(chat.id, c => ({
        ...c,
        title: c.messages.length ? c.title : messageContent.slice(0, 42) + (messageContent.length > 42 ? "…" : ""),
        messages: [...c.messages, userMessage, assistantMessage]
      }));
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(session?.access_token ? { Authorization: "Bearer " + session.access_token } : {}) },
        body: JSON.stringify({
          provider, model,
          memories: memories.map(item => item.content),
          messages: nextMessages.map((message, index) => ({ role: message.role, content: index === nextMessages.length - 1 ? message.content + webContext : message.content })),
          attachments: pendingAttachments.flatMap(({ name, type, kind, data, text, ocrImages }) => [
            { name, type, kind, data, text },
            ...(Array.isArray(ocrImages) ? ocrImages : [])
          ])
        })
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        if (response.status === 402) { setSettingsOpen(true); setSettingsTab("billing"); loadWallet(); }
        throw new Error(data.error || "Something went wrong.");
      }
      if (!response.body) throw new Error("Streaming is not supported by this browser. Please refresh and try again.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "", answer = "", streamError = "", completed = false;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";
        for (const event of events) {
          const line = event.split("\n").find(part => part.startsWith("data: "));
          if (!line) continue;
          const payload = JSON.parse(line.slice(6));
          if (payload.delta) {
            answer += payload.delta;
            updateChat(chat.id, c => ({ ...c, messages: c.messages.map(m => m.id === assistantMessage.id ? { ...m, content: answer } : m) }));
          }
          if (payload.error) streamError = payload.error;
          if (payload.done) completed = true;
        }
      }
      buffer += decoder.decode();
      if (buffer.trim().startsWith("data: ")) {
        const payload = JSON.parse(buffer.trim().slice(6));
        if (payload.delta) answer += payload.delta;
        if (payload.error) streamError = payload.error;
        if (payload.done) completed = true;
      }
      if (answer) {
        const sourceList = webSearchEnabled && webSources.length ? "\n\nSources\n" + webSources.map((item, index) => `[${index + 1}] ${item.title} — ${item.url}`).join("\n") : "";
        answer += sourceList;
        updateChat(chat.id, c => ({ ...c, messages: c.messages.map(m => m.id === assistantMessage.id ? { ...m, content: answer, provider, model, streaming: false } : m) }));
      } else {
        updateChat(chat.id, c => ({ ...c, messages: c.messages.filter(m => m.id !== assistantMessage.id) }));
      }
      if (streamError) setNotice(streamError);
      else if (!completed) setNotice("The response stream ended unexpectedly. Any text received has been kept.");
    } catch (error) {
      if (userMessage) {
        updateChat(chat.id, c => ({ ...c, messages: c.messages.filter(m => m.id !== assistantMessage.id) }));
      }
      setNotice(error.message || "Unable to send your message.");
      setPrompt(content);
      if (!userMessage) setAttachments(pendingAttachments);
    } finally { setSending(false); textareaRef.current?.focus(); }
  }

  async function createShareLink() {
    if (!session?.access_token || !activeChat || !activeChat.messages?.length) {
      setNotice("Sign in and open a conversation with messages before sharing.");
      return;
    }
    setShareBusy(true); setShareError(""); setShareUrl("");
    try {
      const { error: conversationSaveError } = await supabase.from("conversations").upsert({
        id: activeChat.id, user_id: session.user.id, title: activeChat.title,
        is_archived: activeChat.isArchived === true,
        updated_at: new Date(activeChat.updatedAt || Date.now()).toISOString()
      });
      if (conversationSaveError) throw conversationSaveError;
      const messageRows = activeChat.messages.map(message => ({
        id: message.id, conversation_id: activeChat.id, role: message.role, content: message.content,
        provider: message.provider || null, model: message.model || null, attachments: message.attachments || []
      }));
      const { error: messageSaveError } = await supabase.from("messages").upsert(messageRows);
      if (messageSaveError) throw messageSaveError;
      const response = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ conversationId: activeChat.id })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not create a share link.");
      const url = new URL(window.location.href);
      url.search = "";
      url.hash = "";
      url.searchParams.set("share", data.token);
      setShareUrl(url.toString());
    } catch (error) { setShareError(error.message || "Could not create a share link."); }
    finally { setShareBusy(false); }
  }
  async function revokeShareLinks() {
    if (!session?.access_token || !activeChat) return;
    if (!window.confirm("Revoke all public links for this conversation? Anyone using an old link will lose access.")) return;
    setShareBusy(true); setShareError("");
    try {
      const response = await fetch("/api/share", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ conversationId: activeChat.id })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not revoke share links.");
      setShareUrl("");
      setShareError("All existing public links for this conversation have been revoked.");
    } catch (error) { setShareError(error.message || "Could not revoke share links."); }
    finally { setShareBusy(false); }
  }
  async function copyShareLink() {
    if (!shareUrl) return;
    try { await navigator.clipboard.writeText(shareUrl); setShareError("Link copied. Anyone with the link can view this conversation."); }
    catch { setShareError("Copy was blocked by your browser. Select and copy the link above."); }
  }
  function renameChat(id) {
    const chat = chats.find(item => item.id === id);
    if (!chat) return;
    const nextTitle = window.prompt("Rename conversation", chat.title);
    if (nextTitle === null) return;
    const title = nextTitle.trim();
    if (!title) { setNotice("A conversation name cannot be empty."); return; }
    updateChat(id, current => ({ ...current, title: title.slice(0, 120) }));
  }
  function archiveChat(id, archived) {
    updateChat(id, current => ({ ...current, isArchived: archived }));
    if (archived && activeId === id) {
      const next = chats.find(item => item.id !== id && item.isArchived !== true);
      if (next) setActiveId(next.id);
      else newChat();
    }
    setNotice(archived ? "Conversation archived." : "Conversation restored.");
  }
  async function deleteChat(id) {
    const chat = chats.find(item => item.id === id);
    if (!chat || !window.confirm(`Delete "${chat.title}" permanently? This also deletes its saved messages.`)) return;
    if (supabase && session?.user) {
      const attachmentPaths = [...new Set((chat.messages || []).flatMap(message =>
        (message.attachments || []).map(attachment => attachment.path).filter(Boolean)
      ))];
      if (attachmentPaths.length) {
        const { error: storageError } = await supabase.storage.from("chat-attachments").remove(attachmentPaths);
        if (storageError) { setNotice(storageError.message || "Could not remove this conversation's saved attachments."); return; }
      }
      const { error } = await supabase.from("conversations").delete().eq("id", id).eq("user_id", session.user.id);
      if (error) { setNotice(error.message || "Could not delete this conversation from your account."); return; }
    }
    const remaining = chats.filter(item => item.id !== id);
    const next = remaining.length ? remaining : [makeChat()];
    setChats(next);
    if (activeId === id) setActiveId(next[0].id);
    setNotice("Conversation deleted.");
  }
  function toggleVoiceInput() {
    if (!voiceInputEnabled) { setNotice("Voice input is disabled in Settings."); return; }
    if (voiceListening) {
      try { recognitionRef.current?.stop(); } catch {}
      setVoiceListening(false);
      return;
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setNotice("Voice input is not supported in this browser. Try the latest Google Chrome or Microsoft Edge.");
      return;
    }
    if (sending) return;
    try {
      const recognition = new SpeechRecognition();
      recognition.lang = navigator.language || "en-US";
      recognition.continuous = true;
      recognition.interimResults = true;
      voiceBasePromptRef.current = prompt.trim() ? prompt.trim() + " " : "";
      recognition.onresult = event => {
        let transcript = "";
        for (let index = 0; index < event.results.length; index++) {
          transcript += event.results[index][0].transcript;
        }
        setPrompt(voiceBasePromptRef.current + transcript.trim());
      };
      recognition.onerror = event => {
        setVoiceListening(false);
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          setNotice("Microphone access was blocked. Allow microphone permission in your browser and try again.");
        } else if (event.error !== "no-speech" && event.error !== "aborted") {
          setNotice("Voice input stopped. Please try again.");
        }
      };
      recognition.onend = () => {
        setVoiceListening(false);
        recognitionRef.current = null;
      };
      recognitionRef.current = recognition;
      recognition.start();
      setVoiceListening(true);
      setNotice("Listening… speak clearly, then select the microphone again to stop.");
    } catch (error) {
      recognitionRef.current = null;
      setVoiceListening(false);
      setNotice("Could not start the microphone. Check browser permissions and try again.");
    }
  }

  function toggleSpeak(message) {
    if (!readAloudEnabled) { setNotice("Read aloud is disabled in Settings."); return; }
    if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
      setNotice("Voice output is not supported in this browser. Try the latest Google Chrome or Microsoft Edge.");
      return;
    }
    if (speakingMessageId === message.id) {
      window.speechSynthesis.cancel();
      setSpeakingMessageId(null);
      return;
    }
    window.speechSynthesis.cancel();
    const spokenText = String(message.content || "")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/\bSources\s*:?/gi, "Sources.")
      .replace(/[*_~#>]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!spokenText) return;
    const utterance = new SpeechSynthesisUtterance(spokenText);
    utterance.lang = navigator.language || "en-US";
    utterance.onend = () => setSpeakingMessageId(current => current === message.id ? null : current);
    utterance.onerror = () => {
      setSpeakingMessageId(current => current === message.id ? null : current);
      setNotice("Voice playback stopped. Please try again.");
    };
    setSpeakingMessageId(message.id);
    window.speechSynthesis.speak(utterance);
  }
  async function generateImage() {
    const content = prompt.trim();
    if (!content || sending) return;
    if (!supabase || !session?.user) {
      setNotice("Sign in to create and permanently save images to your Yaza AI account.");
      setAuthMode("signin"); setAuthOpen(true); return;
    }
    let chat = activeChat;
    if (!chat) { chat = makeChat(); setChats(old => [chat, ...old]); setActiveId(chat.id); }
    const userMessageId = crypto.randomUUID();
    const assistantMessageId = crypto.randomUUID();
    const userMessage = { id: userMessageId, role: "user", content };
    const pendingMessage = { id: assistantMessageId, role: "assistant", content: "Creating your image…", provider: "openrouter", model: "image generation", streaming: true };
    setPrompt(""); setSending(true); setNotice("");
    updateChat(chat.id, current => ({ ...current, title: current.messages.length ? current.title : content.slice(0, 42) + (content.length > 42 ? "…" : ""), messages: [...current.messages, userMessage, pendingMessage] }));
    try {
      const response = await fetch("/api/images", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + session.access_token
        },
        body: JSON.stringify({ prompt: content, chat_id: chat.id, message_id: assistantMessageId })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 402) { setSettingsOpen(true); setSettingsTab("billing"); loadWallet(); }
        throw new Error(data.error || "Image generation failed.");
      }
      if (!data.attachment?.path) throw new Error("The generated image was not saved to your account.");
      const attachment = data.attachment;
      const walletCharge = (Number(data.billedAmountMinor || 0) / 100).toFixed(2);
      updateChat(chat.id, current => ({ ...current, messages: current.messages.map(message => message.id === assistantMessageId ? { ...message, content: `Image created successfully. Wallet charge: MK ${walletCharge}.`, attachments: [attachment], model: data.model || "OpenRouter image model", streaming: false } : message) }));
      setImageMode(false);
    } catch (error) {
      updateChat(chat.id, current => ({ ...current, messages: current.messages.filter(message => message.id !== assistantMessageId) }));
      setPrompt(content);
      setNotice(error.message || "Could not create your image. Please try again.");
    } finally { setSending(false); textareaRef.current?.focus(); }
  }
  function handleSubmit(e) { e.preventDefault(); if (imageMode) generateImage(); else sendMessage(); }
  async function permanentlyDeleteAccount() {
    if (!session?.access_token || deleteAccountPhrase !== "DELETE MY ACCOUNT" || deletingAccount) return;
    setDeletingAccount(true); setNotice("");
    try {
      const response = await fetch("/api/account", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token }, body: JSON.stringify({ confirmation: deleteAccountPhrase }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Account deletion failed. Your account has not been confirmed as deleted.");
      await supabase.auth.signOut({ scope: "local" });
      setSession(null); setChats([makeChat()]); setActiveId(null); setMemories([]); setAdminAccess(false); setAdminData(null);
      setDeleteAccountOpen(false); setDeleteAccountPhrase(""); setSettingsOpen(false);
      setNotice("Your Yaza account and associated cloud data have been deleted.");
    } catch (error) { setNotice(error.message || "Could not delete your account."); }
    finally { setDeletingAccount(false); }
  }

  function exportChatData() {
    const payload = { exportedAt: new Date().toISOString(), product: "Yaza AI", conversations: chats.map(chat => ({ id: chat.id, title: chat.title, updatedAt: new Date(chat.updatedAt || Date.now()).toISOString(), messages: (chat.messages || []).map(message => ({ id: message.id, role: message.role, content: message.content, provider: message.provider || null, model: message.model || null, attachments: (message.attachments || []).map(({ id, name, type, kind, path }) => ({ id, name, type, kind, path })) })) })) };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url; link.download = "yaza-ai-data-export.json"; link.click();
    URL.revokeObjectURL(url);
    setNotice("Your conversation export has been prepared as a JSON file.");
  }
  function handlePromptKey(e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }
  const suggestions = [
    { icon: Compass, title: "Explore an idea", text: "Help me explore a new idea and turn it into a plan." },
    { icon: Code2, title: "Write code", text: "Help me build a clean, modern web application." },
    { icon: FileText, title: "Write something", text: "Help me write a clear and compelling document." },
    { icon: Globe2, title: "Understand a topic", text: "Explain a complex topic in simple, practical terms." }
  ];

  if (shareLoading) return <div className="shared-page"><div className="shared-card"><div className="brand-mark"><Sparkles size={20}/></div><p>Loading shared conversation…</p></div></div>;
  if (shareError && !sharedView && new URLSearchParams(window.location.search).has("share")) return <div className="shared-page"><div className="shared-card"><div className="brand-mark"><Sparkles size={20}/></div><h1>Shared conversation unavailable</h1><p>{shareError}</p><a href="/">Open Yaza AI</a></div></div>;
  if (sharedView) return <div className="shared-page"><header className="shared-topbar"><a href="/" className="shared-brand"><span className="brand-mark"><Sparkles size={17}/></span> yaza<span>ai</span></a><span><Link2 size={14}/> Shared conversation · Read only</span></header><main className="shared-content"><div className="shared-heading"><div className="eyebrow"><span></span> SHARED WITH YOU</div><h1>{sharedView.title || "Conversation"}</h1><p>Read-only copy · Attachments are not included</p></div>{(sharedView.messages || []).map((message,index) => <article className={`shared-message ${message.role}`} key={message.id || index}><div className="shared-message-author">{message.role === "assistant" ? <><Sparkles size={14}/> Yaza AI</> : "You"}</div><div className="shared-message-content">{renderMarkdown(message.content, code => navigator.clipboard?.writeText(code))}</div></article>)}<footer>Shared using <a href="/">Yaza AI</a></footer></main></div>;
  return <div className={`app-shell theme-${theme}`}>
    <aside className={`sidebar ${sidebarOpen ? "open" : "closed"}`}>
      <div className="side-top">
        <button className="brand" onClick={newChat} aria-label="Yaza AI home"><span className="brand-mark"><Sparkles size={19}/></span><span>yaza<span className="brand-ai">ai</span></span></button>
        <button className="icon-btn side-collapse" onClick={() => setSidebarOpen(false)} title="Close sidebar"><PanelLeftClose size={18}/></button>
      </div>
      <button className="new-chat-btn" onClick={newChat}><SquarePen size={17}/> <span>New chat</span><span className="shortcut">⌘ K</span></button>
      <button className="memory-nav-btn" onClick={() => { if (!session?.user) { setAuthMode("signin"); setAuthOpen(true); return; } setMemoryOpen(true); }}><Sparkles size={16}/> <span>Memory</span><span className="memory-count">{memories.length}</span></button>
      {adminAccess && <button className="memory-nav-btn admin-nav-btn" onClick={openAdminDashboard}><Settings2 size={16}/> <span>Admin dashboard</span></button>}
      <div className="side-search"><Search size={15}/><input className="search-input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search conversations"/><span>⌘K</span></div>
      <div className="history-heading"><div className="history-label">{showArchivedChats ? "ARCHIVED" : "YOUR CHATS"}</div><button className="history-view-toggle" onClick={() => setShowArchivedChats(value => !value)}>{showArchivedChats ? "Active" : "Archived"}</button></div>
      <div className="chat-list">
        {visibleChats.map(chat => <div key={chat.id} className={`chat-row ${chat.id === activeId ? "selected" : ""}`}>
          <button className="chat-select" onClick={() => setActiveId(chat.id)}><MessageSquare size={15}/><span>{chat.title}</span></button>
          <div className="chat-row-actions">
            <button className="chat-action" onClick={() => renameChat(chat.id)} title="Rename conversation" aria-label="Rename conversation"><Pencil size={13}/></button>
            <button className="chat-action" onClick={() => archiveChat(chat.id, !chat.isArchived)} title={chat.isArchived ? "Restore conversation" : "Archive conversation"} aria-label={chat.isArchived ? "Restore conversation" : "Archive conversation"}>{chat.isArchived ? <ArchiveRestore size={13}/> : <Archive size={13}/>}</button>
            <button className="chat-action chat-delete" onClick={() => deleteChat(chat.id)} title="Delete conversation" aria-label="Delete conversation"><Trash2 size={13}/></button>
          </div>
        </div>)}
        {!visibleChats.length && <p className="empty-search">{search ? "No conversations match your search" : showArchivedChats ? "No archived conversations" : "No conversations yet"}</p>}
      </div>
      <div className="side-bottom">
        <div className="plan-card"><div className="plan-icon"><Zap size={16}/></div><div><strong>Yaza AI</strong><span>Your space to think bigger.</span></div><MoreHorizontal size={17}/></div>
        <div className="account-menu-wrap">
          <button className="profile-row profile-action" aria-expanded={accountMenuOpen} onClick={() => setAccountMenuOpen(value => !value)}>
            <div className="avatar">{session ? (session.user.email?.[0] || "Y").toUpperCase() : "Y"}</div>
            <div className="profile-copy"><strong>{session?.user?.email || "Guest"}</strong><span>{session ? "Account" : "Sign in or create an account"}</span></div>
            <MoreHorizontal size={18}/>
          </button>
          {accountMenuOpen && <div className="account-menu">
            <div className="account-menu-heading"><div className="avatar">{session ? (session.user.email?.[0] || "Y").toUpperCase() : "Y"}</div><div><strong>{session?.user?.email || "Guest"}</strong><span>{session ? "Yaza AI account" : "Local workspace"}</span></div></div>
            <div className="account-menu-divider"/>
            {session ? <>
              <button onClick={() => { setSettingsOpen(true); setSettingsTab("billing"); setAccountMenuOpen(false); loadWallet(); }}><CreditCard size={16}/> Wallet</button>
              <button onClick={() => { setSettingsOpen(true); setAccountMenuOpen(false); }}><Settings2 size={16}/> Settings</button>
              <button onClick={() => { setAccountMenuOpen(false); setMemoryOpen(true); }}><Sparkles size={16}/> Personalization <span className="account-menu-count">{memories.length}</span></button>
              {adminAccess && <button onClick={() => { setAccountMenuOpen(false); openAdminDashboard(); }}><Settings2 size={16}/> Admin dashboard</button>}
              <div className="account-menu-divider"/>
              <button className="account-menu-signout" onClick={() => { setAccountMenuOpen(false); signOut(); }}><LogOut size={16}/> Sign out</button>
            </> : <>
              <button onClick={() => { setAuthMode("signin"); setAuthOpen(true); setAccountMenuOpen(false); }}><LogIn size={16}/> Sign in</button>
              <button onClick={() => { setAuthMode("signup"); setAuthOpen(true); setAccountMenuOpen(false); }}><UserRoundPlus size={16}/> Create account</button>
              <div className="account-menu-divider"/>
              <button onClick={() => { setSettingsOpen(true); setAccountMenuOpen(false); }}><Settings2 size={16}/> Settings</button>
            </>}
          </div>}
        </div>
      </div>
    </aside>

    <main className="main-area">
      <header className="topbar">
        <div className="top-left">
          {!sidebarOpen && <button className="icon-btn" onClick={() => setSidebarOpen(true)}><Menu size={19}/></button>}
          <span className="mobile-brand"><span className="brand-mark"><Sparkles size={16}/></span> yaza<span>ai</span></span>
          <div className="model-controls">
            <div className="dropdown-wrap">
              <button className="model-button" onClick={() => { setProviderMenu(!providerMenu); setModelMenu(false); }}><span className={`provider-dot ${provider}`}></span>{PROVIDERS[provider].label}<ChevronDown size={14}/></button>
              {providerMenu && <div className="dropdown provider-dropdown">{Object.entries(PROVIDERS).map(([id,p]) => <button key={id} onClick={() => chooseProvider(id)}><span className={`provider-dot ${id}`}></span>{p.label}{provider === id && <Check size={15}/>}</button>)}</div>}
            </div>
            <span className="control-divider">/</span>
            <div className="dropdown-wrap">
              <button className="model-button model-name" onClick={() => { setModelMenu(!modelMenu); setProviderMenu(false); }}>{PROVIDERS[provider].models.find(m => m.id === model)?.label || model}<ChevronDown size={14}/></button>
              {modelMenu && <div className="dropdown model-dropdown">{PROVIDERS[provider].models.map(m => <button key={m.id} onClick={() => { setModel(m.id); setModelMenu(false); }}>{m.label}{model === m.id && <Check size={15}/>}</button>)}</div>}
            </div>
          </div>
        </div>
        <div className="top-actions">{messages.length > 0 && <button className="share-conversation-btn" onClick={() => { if (!session?.user) { setAuthMode("signin"); setAuthOpen(true); return; } setShareError(""); setShareUrl(""); setShareOpen(true); }} disabled={sending}><Share2 size={14}/> Share</button>}<span className="private-label"><span></span> {session ? "Cloud synced" : cloudStatus || "Private session"}</span><button className="upgrade-btn" onClick={() => setNotice("Account plans will be available when Yaza accounts are enabled.")}> <Sparkles size={14}/> Explore Yaza</button></div>
      </header>

      {shareOpen && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setShareOpen(false); }}><section className="share-dialog" role="dialog" aria-modal="true" aria-labelledby="share-dialog-title"><button className="modal-close" onClick={() => setShareOpen(false)} aria-label="Close"><X size={17}/></button><div className="share-dialog-icon"><Share2 size={19}/></div><h2 id="share-dialog-title">Share conversation</h2><p>Create a public, read-only link to this conversation. Anyone with the link can view its text, so only share content you are comfortable making public.</p><div className="share-privacy-note"><Check size={14}/> You can revoke the link at any time. Attachments are not included.</div>{shareUrl && <div className="share-url-row"><input readOnly value={shareUrl} aria-label="Public share link"/><button onClick={copyShareLink} title="Copy link"><Copy size={15}/></button></div>}{shareError && <p className="share-feedback">{shareError}</p>}<div className="share-dialog-actions"><button className="share-revoke-btn" onClick={revokeShareLinks} disabled={shareBusy}>Revoke links</button><button className="share-create-btn" onClick={createShareLink} disabled={shareBusy}>{shareBusy ? "Please wait…" : shareUrl ? "Create another link" : "Create public link"}</button></div></section></div>}
      <section className={`conversation ${isNew ? "welcome" : ""}`}>
        {isNew ? <div className="welcome-content">
          <div className="welcome-emblem"><span><Sparkles size={25}/></span><i></i><b></b></div>
          <div className="eyebrow"><span></span> YOUR AI, YOUR POSSIBILITIES</div>
          <h1>What can we <em>create</em><br/>today?</h1>
          <p className="welcome-subtitle">A clearer way to think, discover, and get things done.<br className="desktop-break"/> Ask Yaza anything — let's make something meaningful.</p>
          <div className="suggestion-grid">{suggestions.map(({icon:Icon,title,text}) => <button className="suggestion-card" key={title} onClick={() => setPrompt(text)}><span className="suggestion-icon"><Icon size={18}/></span><span><strong>{title}</strong><small>{text}</small></span><ArrowUp size={15} className="suggestion-arrow"/></button>)}</div>
        </div> : <div className="messages-wrap">
          {messages.map((m,i) => <article className={`message ${m.role}`} key={m.id || i}>
            {m.role === "assistant" ? <div className="message-avatar"><Sparkles size={16}/></div> : <div className="user-avatar">Y</div>}
            <div className="message-body"><div className="message-author">{m.role === "assistant" ? "Yaza AI" : "You"}</div><div className="message-content">{m.attachments?.length > 0 && <div className="sent-attachments">{m.attachments.map(file => <button type="button" className="sent-attachment" key={file.id} onClick={() => openAttachment(file)} title="Open saved attachment">{file.kind === "image" ? <ImagePlus size={13}/> : <FileText size={13}/>} {file.name}</button>)}</div>}{m.content ? renderMarkdown(m.content, code => navigator.clipboard?.writeText(code)) : (m.streaming ? <span className="typing"><i></i><i></i><i></i><span>Thinking</span></span> : "")}</div>{m.role === "assistant" && !m.streaming && m.content && <div className="message-meta">{m.provider && <span>{PROVIDERS[m.provider]?.label || m.provider}</span>}<button onClick={() => toggleSpeak(m)} title={!readAloudEnabled ? "Read aloud is disabled in Settings" : speakingMessageId === m.id ? "Stop reading" : "Read response aloud"} aria-label={speakingMessageId === m.id ? "Stop reading response" : "Read response aloud"} disabled={!readAloudEnabled} className={speakingMessageId === m.id ? "speaking-control" : ""}>{speakingMessageId === m.id ? <MicOff size={13}/> : <AudioLines size={13}/>} {speakingMessageId === m.id ? "Stop" : "Read aloud"}</button><button onClick={() => navigator.clipboard?.writeText(m.content)} title="Copy response"><FileText size={13}/> Copy</button></div>}</div>
          </article>)}
          <div ref={endRef}/>
        </div>}
      </section>

      <footer className="composer-area">
        {notice && <div className="notice"><span>{notice}</span><button onClick={() => setNotice("")}><X size={14}/></button></div>}
        <form className="composer" onSubmit={handleSubmit}>
          {attachments.length > 0 && <div className="attachment-list">{attachments.map(file => <div className="attachment-chip" key={file.id}><span className="attachment-icon">{file.kind === "image" ? <ImagePlus size={14}/> : <FileText size={14}/>}</span><span className="attachment-name">{file.name}</span><button type="button" onClick={() => setAttachments(old => old.filter(item => item.id !== file.id))} aria-label={`Remove ${file.name}`}><X size={13}/></button></div>)}</div>}
          <textarea ref={textareaRef} value={prompt} onChange={e => setPrompt(e.target.value)} onKeyDown={handlePromptKey} placeholder={imageMode ? "Describe the image you want Yaza AI to create..." : "Message Yaza AI..."} rows={1} disabled={sending}/>
          <div className="composer-bottom">
            <div className="composer-tools"><button type="button" className={`tool-btn tool-label ${imageMode ? "tool-active" : ""}`} onClick={() => setImageMode(value => !value)} aria-pressed={imageMode} title={imageMode ? "Return to chat" : "Create an image"} disabled={sending}><ImagePlus size={15}/> <span>{imageMode ? "Image mode on" : "Create image"}</span></button><button type="button" className="tool-btn" title="Attach files" onClick={() => fileInputRef.current?.click()}><Plus size={18}/></button><input ref={fileInputRef} type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx,.txt,.md,.csv,.json,.xml,.html,.css,.js,.jsx,.ts,.tsx,.py,.java,.c,.cpp,.sql,.log" hidden onChange={e => addFiles(e.target.files)}/><button type="button" className={`tool-btn tool-label ${webSearchEnabled ? "tool-active" : ""}`} onClick={() => setWebSearchEnabled(value => !value)} aria-pressed={webSearchEnabled} title={webSearchEnabled ? "Turn web search off" : "Turn web search on"}><Globe2 size={15}/> <span>{webSearchEnabled ? "Search on" : "Search"}</span></button><button type="button" className={`tool-btn tool-label ${voiceListening ? "tool-active voice-active" : ""}`} onClick={toggleVoiceInput} aria-pressed={voiceListening} title={!voiceInputEnabled ? "Voice input is disabled in Settings" : voiceListening ? "Stop voice input" : "Start voice input"} disabled={sending || !voiceInputEnabled}><>{voiceListening ? <MicOff size={15}/> : <Mic size={15}/>} <span>{voiceListening ? "Listening" : "Voice"}</span></></button></div>
            <div className="send-side"><span className="enter-hint">↵ to send</span><button type="submit" className="send-btn" disabled={(!prompt.trim() && !attachments.length) || sending} aria-label="Send message">{sending ? <span className="send-spinner"/> : <ArrowUp size={18}/>}</button></div>
          </div>
        </form>
        <p className="disclaimer">Images, scanned PDFs, Word files and text documents supported · Scanned pages are read using your selected AI model · Yaza AI can make mistakes. Check important information.</p>
      </footer>
    </main>

    {adminOpen && <div className="auth-backdrop admin-backdrop" onClick={() => setAdminOpen(false)}>
      <section className="admin-dialog" onClick={event => event.stopPropagation()}>
        <button className="auth-close" onClick={() => setAdminOpen(false)} aria-label="Close"><X size={18}/></button>
        <div className="admin-heading"><div className="auth-mark"><Settings2 size={21}/></div><div><h2>Yaza administration</h2><p>Private platform overview. Message contents and passwords are never displayed here.</p></div></div>
        {adminBusy && <div className="admin-loading">Loading platform statistics…</div>}
        {adminData && <>
          <div className="admin-stat-grid">
            <div className="admin-stat"><span>Total users</span><strong>{adminData.stats.users}</strong></div>
            <div className="admin-stat"><span>Conversations</span><strong>{adminData.stats.conversations}</strong></div>
            <div className="admin-stat"><span>Messages</span><strong>{adminData.stats.messages}</strong></div>
            <div className="admin-stat"><span>Active providers</span><strong>{adminData.providers.length}</strong></div>
          </div>
          <div className="admin-section-title">YAZA AI MODEL</div>
          <div className="admin-model-config">
            <div className="admin-model-config-copy"><strong>Wachabe</strong><span>Choose the underlying AI provider and model used whenever anyone selects Yaza AI · Wachabe.</span></div>
            <label><span>Underlying provider</span><select value={wachabeProvider} onChange={event => { const next = event.target.value; setWachabeProvider(next); setWachabeModel(PROVIDERS[next].models[0].id); }}>{Object.entries(PROVIDERS).filter(([id]) => id !== "yaza").map(([id,item]) => <option key={id} value={id}>{item.label}</option>)}</select></label>
            <label><span>Underlying model</span><select value={wachabeModel} onChange={event => setWachabeModel(event.target.value)}>{(PROVIDERS[wachabeProvider]?.models || []).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
            <div className="admin-model-config-footer"><span>Currently active: {adminData.wachabe?.provider || "openrouter"} · {adminData.wachabe?.model || "openrouter/free"}</span><button className="settings-primary-action" onClick={saveWachabeModel} disabled={wachabeSaving || (adminData.wachabe?.provider === wachabeProvider && adminData.wachabe?.model === wachabeModel)}>{wachabeSaving ? "Saving…" : "Save Wachabe model"}</button></div>
            <div className="admin-footnote">The selected provider's API key must be configured in Vercel. The underlying model is hidden from users and is applied server-side.</div>
          </div>
          <div className="admin-section-title">MODEL PRICING & ACCESS</div>
          <div className="admin-footnote">Set what customers pay for each model. Token pricing uses separate input and output rates per 1,000 tokens; message pricing charges once for each completed response. Prices are in MWK. Wachabe has its own customer price even when you change its underlying provider.</div>
          <div className="admin-pricing-list">
            {(adminData.modelPricing || []).map(item => {
              const draft = pricingDrafts[item.model_key] || item;
              return <div className="admin-model-config admin-pricing-card" key={item.model_key}>
                <div className="admin-model-config-copy"><strong>{item.label || item.model_key}</strong><span>{item.model_key}</span></div>
                <label className="admin-pricing-enabled"><span>Available to customers</span><input type="checkbox" checked={draft.enabled === true} onChange={event => updatePricingDraft(item.model_key,"enabled",event.target.checked)} /></label>
                {item.model_key === "image/generation" ? <div className="admin-footnote">Fixed price per generated image. Image usage is charged per image, not per token.</div> : <label><span>Pricing method</span><select value={draft.pricing_mode || "tokens"} onChange={event => updatePricingDraft(item.model_key,"pricing_mode",event.target.value)}><option value="tokens">Per 1,000 tokens</option><option value="message">Fixed per message</option></select></label>}
                {draft.pricing_mode === "message" ? <label><span>{item.model_key === "image/generation" ? "Price per generated image (MWK)" : "Price per completed response (MWK)"}</span><input type="number" min="0" step="0.01" value={draft.message_rate_mwk ?? 0} onChange={event => updatePricingDraft(item.model_key,"message_rate_mwk",event.target.value)} /></label> : <>
                  <label><span>Input price per 1,000 tokens (MWK)</span><input type="number" min="0" step="0.0001" value={draft.input_rate_per_1k_mwk ?? 0} onChange={event => updatePricingDraft(item.model_key,"input_rate_per_1k_mwk",event.target.value)} /></label>
                  <label><span>Output price per 1,000 tokens (MWK)</span><input type="number" min="0" step="0.0001" value={draft.output_rate_per_1k_mwk ?? 0} onChange={event => updatePricingDraft(item.model_key,"output_rate_per_1k_mwk",event.target.value)} /></label>
                </>}
                <div className="admin-model-config-footer"><span>{draft.enabled ? "Enabled after saving" : "Currently disabled"}</span><button className="settings-primary-action" onClick={() => saveModelPricing(item.model_key)} disabled={!!pricingSaving[item.model_key]}>{pricingSaving[item.model_key] ? "Saving…" : "Save pricing"}</button></div>
              </div>;
            })}
          </div>
          <div className="admin-section-title">PAYMENTS & WALLET REVENUE</div>
          <div className="admin-stat-grid usage-admin-grid">
            <div className="admin-stat"><span>Wallet accounts</span><strong>{adminData.wallet?.accounts || 0}</strong></div>
            <div className="admin-stat"><span>Total top-ups</span><strong>MK {(Number(adminData.wallet?.totalTopupsMinor || 0)/100).toLocaleString(undefined,{maximumFractionDigits:2})}</strong></div>
            <div className="admin-stat"><span>Top-ups this month</span><strong>MK {(Number(adminData.wallet?.monthTopupsMinor || 0)/100).toLocaleString(undefined,{maximumFractionDigits:2})}</strong></div>
            <div className="admin-stat"><span>Model charges this month</span><strong>MK {(Number(adminData.wallet?.monthChargesMinor || 0)/100).toLocaleString(undefined,{maximumFractionDigits:2})}</strong></div>
          </div>
          <div className="admin-footnote">Wallet totals are based on the transaction ledger. They represent customer deposits and usage charges, not net profit or provider expenses. The transaction sample may be limited to the latest 10,000 entries.</div>
          <div className="usage-model-list">{(adminData.wallet?.revenueByModel || []).map(item => <div key={item.modelKey}><span>{item.label}</span><strong>MK {(Number(item.amountMinor || 0)/100).toLocaleString(undefined,{maximumFractionDigits:2})}</strong></div>)}{!(adminData.wallet?.revenueByModel || []).length && <div className="settings-info-note">No paid model usage has been recorded yet.</div>}</div>
          <div className="admin-section-title">API USAGE & COST TRACKING</div>
          <div className="admin-stat-grid usage-admin-grid">
            <div className="admin-stat"><span>Requests today</span><strong>{adminData.usage?.todayRequests ?? 0}</strong></div>
            <div className="admin-stat"><span>Requests this month</span><strong>{adminData.usage?.monthRequests ?? 0}</strong></div>
            <div className="admin-stat"><span>Estimated text tokens</span><strong>{((adminData.usage?.estimatedInputTokens || 0)+(adminData.usage?.estimatedOutputTokens || 0)).toLocaleString()}</strong></div>
            <div className="admin-stat"><span>Reported cost this month</span><strong>${Number(adminData.usage?.monthReportedCostUsd || 0).toFixed(4)}</strong></div>
          </div>
          <div className="admin-footnote">Limits: {adminData.quotas?.dailyRequests || 50} requests per signed-in user per day · {adminData.quotas?.monthlyRequests || 1000} per month · {adminData.quotas?.guestDailyRequests || 10} per guest per day. Token counts are estimates from text length. Cost is shown only when a provider reports it; it is not a complete bill. {adminData.usage?.unpricedRequests || 0} of {adminData.usage?.sampledEvents || 0} sampled requests have no provider cost data.{adminData.usage?.sampleMayBeTruncated ? " Usage sample is capped at the latest 10,000 events." : ""}</div>
          <div className="admin-table usage-admin-table">
            <div className="admin-table-row admin-table-head"><span>Provider</span><span>Model</span><span>Requests</span><span>Reported cost (USD)</span></div>
            {(adminData.usage?.byModel || []).map((item,index) => <div className="admin-table-row" key={index}><span>{item.provider}</span><span>{item.model}</span><strong>{item.requests}</strong><strong>${Number(item.reportedCostUsd || 0).toFixed(4)}</strong></div>)}
            {!(adminData.usage?.byModel || []).length && <div className="admin-empty">No API usage has been recorded yet.</div>}
          </div>
          <div className="admin-section-title">MODEL & PROVIDER USAGE</div>
          <div className="admin-table">
            <div className="admin-table-row admin-table-head"><span>Provider</span><span>Model</span><span>Messages</span></div>
            {adminData.providers.map((item,index) => <div className="admin-table-row" key={index}><span>{item.provider}</span><span>{item.model || "Default"}</span><strong>{item.messages}</strong></div>)}
            {!adminData.providers.length && <div className="admin-empty">No provider usage recorded yet.</div>}
          </div>
          <div className="admin-section-title">USAGE BY ACCOUNT</div>
          <div className="admin-table usage-user-table">
            <div className="admin-table-row admin-table-head"><span>Account</span><span>Requests</span><span>Estimated tokens</span><span>Reported cost (USD)</span><span>Wallet charges (MWK)</span></div>
            {(adminData.usage?.byUser || []).map((item,index) => <div className="admin-table-row" key={index}><span>{item.account}</span><strong>{item.requests}</strong><span>{(item.estimatedInputTokens + item.estimatedOutputTokens).toLocaleString()}</span><strong>${Number(item.reportedCostUsd || 0).toFixed(4)}</strong><strong>MK {(Number(item.billedAmountMinor || 0)/100).toLocaleString(undefined,{maximumFractionDigits:2})}</strong></div>)}
            {!(adminData.usage?.byUser || []).length && <div className="admin-empty">No signed-in account usage recorded yet.</div>}
          </div>
          <div className="admin-section-title">RECENT ACCOUNTS</div>
          <div className="admin-users">
            {adminData.users.map(user => <div className="admin-user" key={user.id}><div className="avatar">{(user.email?.[0] || "Y").toUpperCase()}</div><div><strong>{user.email || "No email"}</strong><span>Joined {user.created_at ? new Date(user.created_at).toLocaleDateString() : "unknown"} · Last sign-in {user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleDateString() : "Never"}</span></div></div>)}
            {!adminData.users.length && <div className="admin-empty">No accounts found.</div>}
          </div>
          <div className="admin-footnote">Updated {new Date(adminData.generatedAt).toLocaleString()}. Account list shows the latest {adminData.users.length} users; provider counts are based on stored messages.</div>
        </>}
      </section>
    </div>}

    {memoryOpen && <div className="auth-backdrop" onClick={() => { setMemoryOpen(false); setEditingMemoryId(null); setMemoryDraft(""); }}>
      <section className="memory-dialog" onClick={event => event.stopPropagation()}>
        <button className="auth-close" onClick={() => { setMemoryOpen(false); setEditingMemoryId(null); setMemoryDraft(""); }} aria-label="Close"><X size={18}/></button>
        <div className="auth-mark"><Sparkles size={21}/></div>
        <h2>Yaza memory</h2>
        <p>Save useful details you want Yaza to remember across chats. You control what is stored and can edit or delete it anytime.</p>
        <form className="memory-form" onSubmit={saveMemory}>
          <label>{editingMemoryId ? "Edit memory" : "Add a memory"}</label>
          <textarea value={memoryDraft} onChange={event => setMemoryDraft(event.target.value)} maxLength={500} rows={3} placeholder="For example: I prefer concise answers and work mainly with Supabase." />
          <div className="memory-form-footer"><span>{memoryDraft.length}/500</span><button className="auth-submit" type="submit" disabled={memoryBusy || !memoryDraft.trim()}>{memoryBusy ? "Saving…" : editingMemoryId ? "Update memory" : "Save memory"}</button></div>
        </form>
        <div className="memory-list-title">SAVED MEMORIES ({memories.length})</div>
        <div className="memory-list">
          {memories.map(item => <div className="memory-item" key={item.id}>
            <p>{item.content}</p>
            <div><button type="button" onClick={() => { setEditingMemoryId(item.id); setMemoryDraft(item.content); }}>Edit</button><button type="button" onClick={() => removeMemory(item.id)} disabled={memoryBusy}>Delete</button></div>
          </div>)}
          {!memories.length && <div className="memory-empty">No saved memories yet. Add one above to get started.</div>}
        </div>
        <div className="memory-footnote">Memories are private to your account and are added as context to future AI chats. Avoid saving passwords or highly sensitive information.</div>
      </section>
    </div>}

    {settingsOpen && <div className="settings-page-backdrop" onClick={() => setSettingsOpen(false)}>
      <section className="settings-page" onClick={event => event.stopPropagation()}>
        <aside className="settings-sidebar">
          <div className="settings-sidebar-top"><div className="settings-sidebar-brand"><div className="auth-mark"><Settings2 size={19}/></div><div><strong>Settings</strong><span>Yaza AI preferences</span></div></div><button className="settings-close" onClick={() => setSettingsOpen(false)} aria-label="Close settings"><X size={18}/></button></div>
          <nav className="settings-nav" aria-label="Settings sections">
            {[["general","General"],["ai","AI preferences"],["personalization","Personalization"],["voice","Voice"],["billing","Billing"],["usage","Usage"],["data","Data controls"],["account","Account"]].map(([id,label]) => <button key={id} className={settingsTab===id?"active":""} onClick={() => { setSettingsTab(id); if (id === "usage") loadUsageReport(); if (id === "billing") loadWallet(); }}>{label}</button>)}
          </nav>
          <div className="settings-sidebar-bottom"><span>Yaza AI</span><span>Settings</span></div>
        </aside>
        <main className="settings-content">
          <div className="settings-mobile-heading"><strong>Settings</strong><button className="settings-close" onClick={() => setSettingsOpen(false)} aria-label="Close settings"><X size={18}/></button></div>
          {settingsTab==="general" && <section className="settings-panel-section"><h2>General</h2><p className="settings-panel-intro">Choose how Yaza AI appears and communicates.</p>
            <div className="settings-option"><div><strong>Language</strong><span>The language used across the Yaza interface.</span></div><span className="settings-chip">English</span></div>
            <div className="settings-option"><div><strong>Appearance</strong><span>Choose the interface theme for this device and your signed-in account.</span></div><select className="settings-inline-select" value={theme} onChange={event => setTheme(event.target.value)}><option value="dark">Dark</option><option value="light">Light</option></select></div>
          </section>}
          {settingsTab==="ai" && <section className="settings-panel-section"><h2>AI preferences</h2><p className="settings-panel-intro">Choose the provider and model Yaza starts with when you chat.</p>
            <label className="settings-field"><span>Default AI provider</span><select value={provider} onChange={event => chooseProvider(event.target.value)}>{Object.entries(PROVIDERS).map(([id,item]) => <option key={id} value={id}>{item.label}</option>)}</select></label>
            <label className="settings-field"><span>Default model</span><select value={model} onChange={event => setModel(event.target.value)}>{(PROVIDERS[provider]?.models || []).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
            <div className="settings-info-note">Your provider and model are saved to your Yaza account and sync across devices when signed in. Guests keep these choices in this browser. Provider availability depends on the API keys and credits configured by Yaza.</div>
          </section>}
          {settingsTab==="personalization" && <section className="settings-panel-section"><h2>Personalization</h2><p className="settings-panel-intro">Manage information that helps Yaza tailor future conversations.</p>
            <button className="settings-action-card" onClick={() => { setSettingsOpen(false); if (!session?.user) { setAuthMode("signin"); setAuthOpen(true); } else setMemoryOpen(true); }}><div><strong>Saved memories</strong><span>Review, add, edit or delete memories used in future chats.</span></div><span className="settings-chip">{memories.length} saved</span></button>
          </section>}
          {settingsTab==="voice" && <section className="settings-panel-section"><h2>Voice</h2><p className="settings-panel-intro">Use your browser's built-in speech features with Yaza.</p>
            <div className="settings-option"><div><strong>Voice input</strong><span>Allow speech-to-text from the microphone control. Browser microphone permission is still required.</span></div><label className="settings-toggle"><input type="checkbox" checked={voiceInputEnabled} onChange={event => setVoiceInputEnabled(event.target.checked)}/><span>{voiceInputEnabled ? "On" : "Off"}</span></label></div>
            <div className="settings-option"><div><strong>Read aloud</strong><span>Allow assistant replies to be spoken using your browser voice.</span></div><label className="settings-toggle"><input type="checkbox" checked={readAloudEnabled} onChange={event => setReadAloudEnabled(event.target.checked)}/><span>{readAloudEnabled ? "On" : "Off"}</span></label></div>
            <div className="settings-info-note">Voice availability and voices depend on your browser and device. Chrome generally provides the best support.</div>
          </section>}
          {settingsTab==="billing" && <section className="settings-panel-section"><h2>Wallet & billing</h2><p className="settings-panel-intro">Add money securely with PayChangu and use your balance for Yaza AI model requests.</p>
            {!session && <div className="settings-info-note">Sign in to open a wallet, make top-ups and pay for AI usage.</div>}
            {session && <>
              {walletLoading && <div className="settings-info-note">Loading your wallet…</div>}
              {walletError && <div className="settings-info-note">{walletError}</div>}
              <div className="wallet-balance-card"><span>Available wallet balance</span><strong>MK {(Number(walletData?.balanceMinor || 0)/100).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</strong><small>Malawi Kwacha · Balance shown in MWK</small></div>
              <div className="wallet-topup-card"><strong>Add funds</strong><span>Choose a whole MWK amount. PayChangu securely handles checkout.</span>
                <label>Top-up amount (MWK)<input type="number" min="500" max="500000" step="1" value={topupAmount} onChange={event => setTopupAmount(event.target.value)} /></label>
                <button className="settings-primary-action" onClick={startWalletTopup} disabled={topupBusy}>{topupBusy ? "Connecting to PayChangu…" : "Continue to PayChangu"}</button>
              </div>
              <div className="wallet-history-heading"><strong>Recent wallet activity</strong><button onClick={loadWallet} disabled={walletLoading}>Refresh</button></div>
              <div className="wallet-history-list">
                {(walletData?.transactions || []).map(item => <div className="wallet-history-item" key={item.id}>
                  <div><strong>{item.description || item.kind.replace(/_/g," ")}{item.metadata?.model_key ? " · " + item.metadata.model_key : ""}</strong><span>{new Date(item.created_at).toLocaleString()}</span></div>
                  <strong className={Number(item.amount_minor)>=0?"wallet-credit":"wallet-debit"}>{Number(item.amount_minor)>=0?"+":"−"}MK {(Math.abs(Number(item.amount_minor))/100).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</strong>
                </div>)}
                {!walletLoading && !(walletData?.transactions || []).length && <div className="settings-info-note">No wallet transactions yet. Your first confirmed top-up will appear here.</div>}
              </div>
              <div className="settings-info-note">Top-ups are credited only after Yaza verifies the transaction directly with PayChangu. Model usage is reserved before a response and reconciled after completion.</div>
            </>}
          </section>}
          {settingsTab==="usage" && <section className="settings-panel-section"><h2>Usage</h2><p className="settings-panel-intro">Review your request allowance, token usage and wallet charges.</p>
            {!session && <div className="settings-info-note">Sign in to see your account usage and wallet billing details.</div>}
            {usageLoading && <div className="settings-info-note">Loading your usage report…</div>}
            {usageError && <div className="settings-info-note">{usageError}</div>}
            {usageData && <>
              <div className="usage-meter"><div><strong>Daily requests</strong><span>{usageData.daily.used} of {usageData.daily.limit}</span></div><div className="usage-track"><i style={{width: Math.min(100, usageData.daily.used / usageData.daily.limit * 100) + "%"}}/></div></div>
              <div className="usage-meter"><div><strong>Monthly requests</strong><span>{usageData.monthly.used} of {usageData.monthly.limit}</span></div><div className="usage-track"><i style={{width: Math.min(100, usageData.monthly.used / usageData.monthly.limit * 100) + "%"}}/></div></div>
              <div className="usage-stat-grid">
                <div className="usage-stat"><span>Estimated input tokens</span><strong>{Number(usageData.estimatedInputTokens || 0).toLocaleString()}</strong></div>
                <div className="usage-stat"><span>Estimated output tokens</span><strong>{Number(usageData.estimatedOutputTokens || 0).toLocaleString()}</strong></div>
                <div className="usage-stat"><span>Provider-reported cost this month</span><strong>${Number(usageData.reportedCostUsd || 0).toFixed(4)}</strong></div>
                <div className="usage-stat"><span>Yaza wallet charges this month</span><strong>MK {(Number(usageData.billedAmountMinor || 0)/100).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</strong></div>
                <div className="usage-stat"><span>Requests without cost data</span><strong>{usageData.unpricedRequests}</strong></div>
              </div>
              <div className="settings-info-note">Token counts are approximate estimates based on text length. Provider-reported cost is shown only when the provider includes it (currently most consistently available through OpenRouter); it is not a complete invoice or billing statement.</div>
              <div className="usage-model-list">{usageData.byModel.map((item,index)=><div key={index}><span>{item.publicModelKey || (item.provider + " · " + item.model)}</span><strong>{item.requests} · MK {(Number(item.billedAmountMinor || 0)/100).toLocaleString(undefined,{maximumFractionDigits:2})}</strong></div>)}{!usageData.byModel.length && <div className="settings-info-note">No requests recorded this month yet.</div>}</div>
              <button className="settings-action-card" onClick={loadUsageReport}><div><strong>Refresh usage</strong><span>Update this report from Yaza's server records.</span></div><span className="settings-chip">Refresh</span></button>
            </>}
          </section>}
          {settingsTab==="data" && <section className="settings-panel-section"><h2>Data controls</h2><p className="settings-panel-intro">Understand where your conversations and attachments are kept.</p>
            <div className="settings-option"><div><strong>Conversation history</strong><span>Signed-in conversations are synced with your Yaza account. Local history may also be available in this browser.</span></div><span className="settings-chip">{session ? "Account sync" : "This browser"}</span></div>
            <div className="settings-option"><div><strong>File attachments</strong><span>Uploaded files are stored in private account storage and opened using temporary links.</span></div><span className="settings-chip">Private</span></div>
            <button className="settings-action-card" onClick={exportChatData}><div><strong>Export conversations</strong><span>Download your chats and attachment details as a JSON file.</span></div><span className="settings-chip">Export JSON</span></button>
            <div className="settings-info-note">The export includes conversation text and attachment metadata, not the original uploaded files or account credentials. Account deletion will be added with a separate confirmation and secure server-side cleanup.</div>
          </section>}
          {settingsTab==="account" && <section className="settings-panel-section"><h2>Account</h2><p className="settings-panel-intro">Manage your Yaza AI sign-in.</p>
            <div className="settings-option"><div><strong>Email address</strong><span>{session?.user?.email || "You are using Yaza as a guest."}</span></div><span className="settings-chip">{session ? "Signed in" : "Guest"}</span></div>
            {session ? <><button className="settings-danger-action" onClick={() => { setDeleteAccountOpen(true); setDeleteAccountPhrase(""); }}><Trash2 size={16}/> Delete account and data</button><button className="settings-primary-action" onClick={() => { setSettingsOpen(false); signOut(); }}><LogOut size={16}/> Sign out</button></> : <button className="settings-primary-action" onClick={() => { setSettingsOpen(false); setAuthMode("signin"); setAuthOpen(true); }}><LogIn size={16}/> Sign in or create an account</button>}
          </section>}
          <div className="settings-content-footer"><span>{session ? preferencesStatus : "Saved on this browser"}</span><button onClick={() => setSettingsOpen(false)}>Done</button></div>
        </main>
      </section>
    </div>}

    {deleteAccountOpen && <div className="auth-backdrop" onClick={() => { if (!deletingAccount) setDeleteAccountOpen(false); }}>
      <section className="memory-dialog delete-account-dialog" onClick={event => event.stopPropagation()}>
        <button className="auth-close" onClick={() => setDeleteAccountOpen(false)} aria-label="Close" disabled={deletingAccount}><X size={18}/></button>
        <div className="auth-mark"><Trash2 size={20}/></div>
        <h2>Delete your Yaza account?</h2>
        <p>This permanently deletes your Yaza sign-in, conversations, messages, saved memories, preferences and uploaded chat files. This action cannot be undone.</p>
        <label className="memory-list-title">Type DELETE MY ACCOUNT to confirm</label>
        <input className="delete-account-input" value={deleteAccountPhrase} onChange={event => setDeleteAccountPhrase(event.target.value)} placeholder="DELETE MY ACCOUNT" autoComplete="off"/>
        <button className="settings-danger-action delete-account-confirm" disabled={deleteAccountPhrase !== "DELETE MY ACCOUNT" || deletingAccount} onClick={permanentlyDeleteAccount}>{deletingAccount ? "Deleting account…" : "Permanently delete account"}</button>
      </section>
    </div>}
    {authOpen && <div className="auth-backdrop" onClick={() => setAuthOpen(false)}>
      <section className="auth-dialog" onClick={event => event.stopPropagation()}>
        <button className="auth-close" onClick={() => setAuthOpen(false)} aria-label="Close"><X size={18}/></button>
        <div className="auth-mark"><Sparkles size={21}/></div>
        <h2>{authMode === "signup" ? "Create your Yaza account" : "Welcome back"}</h2>
        <p>{authMode === "signup" ? "Your conversations, available wherever you sign in." : "Sign in to continue your conversations."}</p>
        <form onSubmit={submitAuth}>
          <label>Email address</label><input type="email" value={authEmail} onChange={event => setAuthEmail(event.target.value)} placeholder="you@example.com" required autoComplete="email"/>
          <label>Password</label><input type="password" value={authPassword} onChange={event => setAuthPassword(event.target.value)} placeholder="At least 6 characters" minLength={6} required autoComplete={authMode === "signup" ? "new-password" : "current-password"}/>
          <button className="auth-submit" type="submit" disabled={authBusy}>{authBusy ? "Please wait…" : authMode === "signup" ? "Create account" : "Sign in"}</button>
        </form>
        <div className="auth-switch">{authMode === "signup" ? "Already have an account?" : "New to Yaza AI?"} <button onClick={() => setAuthMode(authMode === "signup" ? "signin" : "signup")}>{authMode === "signup" ? "Sign in" : "Create an account"}</button></div>
      </section>
    </div>}
  </div>;
}

export default App;