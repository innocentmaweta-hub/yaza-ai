import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown, ArrowUp, AudioLines, Check, ChevronDown, Code2, Compass,
  FileText, Globe2, ImagePlus, Menu, MessageSquare, MoreHorizontal,
  PanelLeftClose, Plus, Search, Settings2, Sparkles, SquarePen, Trash2,
  X, Zap
} from "lucide-react";

const PROVIDERS = {
  openai: { label: "OpenAI", models: [{ id: "gpt-4.1-mini", label: "GPT-4.1 mini" }, { id: "gpt-4.1", label: "GPT-4.1" }, { id: "o4-mini", label: "o4-mini" }] },
  gemini: { label: "Gemini", models: [{ id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" }, { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" }, { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" }] },
  openrouter: { label: "OpenRouter", models: [{ id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash" }, { id: "openai/gpt-4.1", label: "GPT-4.1" }, { id: "deepseek/deepseek-r1", label: "DeepSeek R1" }, { id: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4" }] },
  kimi: { label: "Kimi", models: [{ id: "moonshot-v1-8k", label: "Kimi 8K" }, { id: "moonshot-v1-32k", label: "Kimi 32K" }, { id: "moonshot-v1-128k", label: "Kimi 128K" }] }
};
const STORAGE = "yaza-ai-conversations-v1";
const makeChat = () => ({ id: crypto.randomUUID(), title: "New chat", messages: [], updatedAt: Date.now() });

function App() {
  const [chats, setChats] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE)) || [makeChat()]; }
    catch { return [makeChat()]; }
  });
  const [activeId, setActiveId] = useState(() => chats[0]?.id);
  const [provider, setProvider] = useState("openai");
  const [model, setModel] = useState(PROVIDERS.openai.models[0].id);
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [providerMenu, setProviderMenu] = useState(false);
  const [modelMenu, setModelMenu] = useState(false);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const endRef = useRef(null);
  const textareaRef = useRef(null);
  const activeChat = chats.find(c => c.id === activeId) || chats[0];
  const messages = activeChat?.messages || [];
  const isNew = messages.length === 0;

  useEffect(() => { localStorage.setItem(STORAGE, JSON.stringify(chats)); }, [chats]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, sending]);
  useEffect(() => {
    const onKey = e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); document.querySelector(".search-input")?.focus(); }
      if (e.key === "Escape") { setProviderMenu(false); setModelMenu(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const visibleChats = useMemo(() => chats
    .filter(c => c.title.toLowerCase().includes(search.toLowerCase()))
    .sort((a,b) => b.updatedAt - a.updatedAt), [chats, search]);

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
  async function sendMessage(text = prompt) {
    const content = text.trim();
    if (!content || sending) return;
    let chat = activeChat;
    if (!chat) { chat = makeChat(); setChats([chat]); setActiveId(chat.id); }
    const userMessage = { id: crypto.randomUUID(), role: "user", content };
    const nextMessages = [...chat.messages, userMessage];
    updateChat(chat.id, c => ({
      ...c,
      title: c.messages.length ? c.title : content.slice(0, 42) + (content.length > 42 ? "…" : ""),
      messages: [...c.messages, userMessage]
    }));
    setPrompt("");
    setSending(true);
    setNotice("");
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, model, messages: nextMessages.map(({ role, content }) => ({ role, content })) })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Something went wrong.");
      updateChat(chat.id, c => ({ ...c, messages: [...c.messages, { id: crypto.randomUUID(), role: "assistant", content: data.answer, provider: data.provider, model: data.model }] }));
    } catch (error) {
      setNotice(error.message || "Unable to reach Yaza AI.");
      updateChat(chat.id, c => ({ ...c, messages: c.messages.filter(m => m.id !== userMessage.id) }));
      setPrompt(content);
    } finally { setSending(false); textareaRef.current?.focus(); }
  }
  function deleteChat(id) {
    const remaining = chats.filter(c => c.id !== id);
    const next = remaining.length ? remaining : [makeChat()];
    setChats(next);
    if (activeId === id) setActiveId(next[0].id);
  }
  function handleSubmit(e) { e.preventDefault(); sendMessage(); }
  function handlePromptKey(e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }
  const suggestions = [
    { icon: Compass, title: "Explore an idea", text: "Help me explore a new idea and turn it into a plan." },
    { icon: Code2, title: "Write code", text: "Help me build a clean, modern web application." },
    { icon: FileText, title: "Write something", text: "Help me write a clear and compelling document." },
    { icon: Globe2, title: "Understand a topic", text: "Explain a complex topic in simple, practical terms." }
  ];

  return <div className="app-shell">
    <aside className={`sidebar ${sidebarOpen ? "open" : "closed"}`}>
      <div className="side-top">
        <button className="brand" onClick={newChat} aria-label="Yaza AI home"><span className="brand-mark"><Sparkles size={19}/></span><span>yaza<span className="brand-ai">ai</span></span></button>
        <button className="icon-btn side-collapse" onClick={() => setSidebarOpen(false)} title="Close sidebar"><PanelLeftClose size={18}/></button>
      </div>
      <button className="new-chat-btn" onClick={newChat}><SquarePen size={17}/> <span>New chat</span><span className="shortcut">⌘ K</span></button>
      <div className="side-search"><Search size={15}/><input className="search-input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search chats"/><span>⌘K</span></div>
      <div className="history-label">YOUR CHATS</div>
      <div className="chat-list">
        {visibleChats.map(chat => <div key={chat.id} className={`chat-row ${chat.id === activeId ? "selected" : ""}`}>
          <button className="chat-select" onClick={() => setActiveId(chat.id)}><MessageSquare size={15}/><span>{chat.title}</span></button>
          <button className="chat-delete" onClick={() => deleteChat(chat.id)} title="Delete chat"><Trash2 size={14}/></button>
        </div>)}
        {!visibleChats.length && <p className="empty-search">No matching chats</p>}
      </div>
      <div className="side-bottom">
        <div className="plan-card"><div className="plan-icon"><Zap size={16}/></div><div><strong>Yaza AI</strong><span>Your space to think bigger.</span></div><MoreHorizontal size={17}/></div>
        <div className="profile-row"><div className="avatar">Y</div><div className="profile-copy"><strong>Guest</strong><span>Personal workspace</span></div><Settings2 size={17}/></div>
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
        <div className="top-actions"><span className="private-label"><span></span> Private session</span><button className="upgrade-btn" onClick={() => setNotice("Account plans will be available when Yaza accounts are enabled.")}> <Sparkles size={14}/> Explore Yaza</button></div>
      </header>

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
            <div className="message-body"><div className="message-author">{m.role === "assistant" ? "Yaza AI" : "You"}</div><div className="message-content">{m.content}</div>{m.role === "assistant" && <div className="message-meta">{m.provider && <span>{PROVIDERS[m.provider]?.label || m.provider}</span>}<button onClick={() => navigator.clipboard?.writeText(m.content)} title="Copy response"><FileText size={13}/> Copy</button></div>}</div>
          </article>)}
          {sending && <article className="message assistant"><div className="message-avatar"><Sparkles size={16}/></div><div className="message-body"><div className="message-author">Yaza AI</div><div className="typing"><i></i><i></i><i></i><span>Thinking</span></div></div></article>}
          <div ref={endRef}/>
        </div>}
      </section>

      <footer className="composer-area">
        {notice && <div className="notice"><span>{notice}</span><button onClick={() => setNotice("")}><X size={14}/></button></div>}
        <form className="composer" onSubmit={handleSubmit}>
          <textarea ref={textareaRef} value={prompt} onChange={e => setPrompt(e.target.value)} onKeyDown={handlePromptKey} placeholder="Message Yaza AI..." rows={1} disabled={sending}/>
          <div className="composer-bottom">
            <div className="composer-tools"><button type="button" className="tool-btn" title="Attach files" onClick={() => setNotice("File uploads are coming in a future update.")}><Plus size={18}/></button><button type="button" className="tool-btn tool-label" onClick={() => setNotice("Web search is coming in a future update.")}><Globe2 size={15}/> <span>Search</span></button><button type="button" className="tool-btn tool-label" onClick={() => setNotice("Voice input is coming in a future update.")}><AudioLines size={15}/> <span>Voice</span></button></div>
            <div className="send-side"><span className="enter-hint">↵ to send</span><button type="submit" className="send-btn" disabled={!prompt.trim() || sending} aria-label="Send message">{sending ? <span className="send-spinner"/> : <ArrowUp size={18}/>}</button></div>
          </div>
        </form>
        <p className="disclaimer">Yaza AI can make mistakes. Check important information.</p>
      </footer>
    </main>
  </div>;
}

export default App;