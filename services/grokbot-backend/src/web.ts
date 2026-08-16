/**
 * `web_search` and `web_fetch`, shaped to the original's result contracts:
 *
 *   WebSearchResult { references: [{ title, url, chunk }], is_final, rejected }
 *   WebFetchResult  { url, markdown, error }
 *
 * These are the only two tools in the original's set that need neither a box nor a key,
 * which is why they come first while the box is unreachable.
 */

const UA =
  process.env.GROKBOT2_WEB_UA ??
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";
const TIMEOUT = Number(process.env.GROKBOT2_WEB_TIMEOUT_MS ?? 20_000);

export interface WebReference { title: string; url: string; chunk: string }

const withTimeout = async (url: string, init: RequestInit = {}): Promise<Response> => {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    return await fetch(url, { ...init, redirect: "follow", signal: ctl.signal, headers: { "user-agent": UA, ...(init.headers ?? {}) } });
  } finally {
    clearTimeout(timer);
  }
};

const decodeEntities = (s: string): string =>
  s
    .replace(/&(#\d+|#x[0-9a-fA-F]+|amp|lt|gt|quot|#39|apos|nbsp);/g, (m, e) => {
      if (e === "amp") return "&";
      if (e === "lt") return "<";
      if (e === "gt") return ">";
      if (e === "quot") return '"';
      if (e === "#39" || e === "apos") return "'";
      if (e === "nbsp") return " ";
      if (e.startsWith("#x")) return String.fromCodePoint(parseInt(e.slice(2), 16));
      if (e.startsWith("#")) return String.fromCodePoint(Number(e.slice(1)));
      return m;
    });

const stripTags = (html: string): string => decodeEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

// ── web_search ────────────────────────────────────────────────────────────────

/**
 * DuckDuckGo's HTML endpoint is the default because it needs no key: this tool has to work
 * on a fresh clone. Set GROKBOT2_SEARCH_URL to a real search API when you have one — HTML
 * scraping breaks whenever the page changes, so treat it as the fallback it is.
 */
export async function webSearch(term: string, limit = 6): Promise<{ references: WebReference[]; is_final: boolean; rejected: boolean }> {
  const query = term.trim();
  if (!query) return { references: [], is_final: true, rejected: true };

  const res = await withTimeout(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `q=${encodeURIComponent(query)}`,
  });
  if (!res.ok) throw new Error(`tìm kiếm thất bại (HTTP ${res.status})`);
  const html = await res.text();

  const refs: WebReference[] = [];
  const linkRe = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRe = /<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  const snippets = [...html.matchAll(snippetRe)].map((m) => stripTags(m[1]));

  for (const [i, m] of [...html.matchAll(linkRe)].entries()) {
    if (refs.length >= limit) break;
    // DDG wraps results as /l/?uddg=<encoded target>; the wrapper is useless to the model.
    let url = decodeEntities(m[1]);
    const wrapped = /[?&]uddg=([^&]+)/.exec(url);
    if (wrapped) url = decodeURIComponent(wrapped[1]);
    if (!/^https?:/i.test(url)) continue;
    refs.push({ title: stripTags(m[2]), url, chunk: snippets[i] ?? "" });
  }
  return { references: refs, is_final: true, rejected: false };
}

// ── web_fetch ─────────────────────────────────────────────────────────────────

/**
 * Fetch a page as markdown-ish text.
 *
 * Deliberately not a full HTML→Markdown port: the model needs the readable content and the
 * link targets, and a dependency-free converter that handles headings, links, lists and code
 * covers that. Script/style/nav are dropped before anything else, since they are most of the
 * bytes and none of the meaning.
 */
export async function webFetch(rawUrl: string): Promise<{ url: string; markdown: string; error: string }> {
  const url = rawUrl.trim();
  if (!/^https?:\/\//i.test(url)) return { url, markdown: "", error: "URL phải bắt đầu bằng http:// hoặc https://" };

  let res: Response;
  try {
    res = await withTimeout(url, { headers: { accept: "text/html,text/plain,*/*" } });
  } catch (e) {
    return { url, markdown: "", error: (e as Error)?.name === "AbortError" ? `quá ${TIMEOUT}ms không phản hồi` : String((e as Error).message ?? e) };
  }
  if (!res.ok) return { url: res.url || url, markdown: "", error: `HTTP ${res.status}` };

  const type = res.headers.get("content-type") ?? "";
  const body = await res.text();
  if (!/html/i.test(type)) return { url: res.url || url, markdown: body.slice(0, 40_000), error: "" };

  return { url: res.url || url, markdown: htmlToMarkdown(body).slice(0, 40_000), error: "" };
}

export function htmlToMarkdown(html: string): string {
  let s = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|svg|iframe|nav|footer|form)[\s\S]*?<\/\1>/gi, " ");

  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(s)?.[1];

  s = s
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, n, t) => `\n\n${"#".repeat(Number(n))} ${stripTags(t)}\n\n`)
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, t) => `\n- ${stripTags(t)}`)
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_m, t) => `\n\n\`\`\`\n${stripTags(t)}\n\`\`\`\n\n`)
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_m, t) => `\`${stripTags(t)}\``)
    // Keep the href: a link the model cannot follow is worse than no link.
    .replace(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, t) => {
      const label = stripTags(t);
      return label ? `[${label}](${decodeEntities(href)})` : "";
    })
    .replace(/<(br|hr)\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|tr|h[1-6])>/gi, "\n\n");

  const text = decodeEntities(s.replace(/<[^>]*>/g, ""))
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n").map((l) => l.trim()).join("\n")
    .trim();

  return title ? `# ${stripTags(title)}\n\n${text}` : text;
}
