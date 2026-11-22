export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: "Web search is not configured yet. Add TAVILY_API_KEY in your Vercel project environment variables, then redeploy."
    });
  }

  const query = typeof req.body?.query === "string" ? req.body.query.trim().slice(0, 500) : "";
  if (query.length < 2) return res.status(400).json({ error: "Enter a question or topic to search for." });

  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: "basic",
        topic: "general",
        max_results: 5,
        include_answer: false,
        include_raw_content: false
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error("Yaza web search provider error:", response.status, data?.message || data?.error || "");
      if (response.status === 401 || response.status === 403) {
        return res.status(502).json({ error: "The web search provider rejected its API key. Check TAVILY_API_KEY in Vercel." });
      }
      if (response.status === 429) {
        return res.status(502).json({ error: "Web search is temporarily rate-limited. Please wait and try again." });
      }
      return res.status(502).json({ error: "The web search provider could not complete this search. Please try again." });
    }

    const results = (Array.isArray(data.results) ? data.results : []).slice(0, 5).map(item => ({
      title: String(item.title || "Web result").slice(0, 300),
      url: String(item.url || ""),
      content: String(item.content || "").slice(0, 3500),
      score: Number.isFinite(item.score) ? item.score : null
    })).filter(item => /^https?:\/\//i.test(item.url) && item.content);

    return res.status(200).json({ query, results });
  } catch (error) {
    console.error("Yaza web search error:", error?.message || error);
    return res.status(502).json({ error: "Yaza AI could not reach web search. Please try again." });
  }
}
