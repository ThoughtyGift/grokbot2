/**
 * Tool catalog the model may call. The turn loop lives in turn.ts.
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname } from "node:path";
import { config, loadPoolKey } from "../config.js";
import { BROWSER_TOOL_NAMES, isBrowserConfigured, isBrowserReachable, runBrowserTool, browserProbe } from "../browser.js";
import { imageSize, readAttachmentImage } from "../attachments.js";
import { availableTools, toolProtocol as boxToolProtocol, isAutoApproved, unquote, toolArgs } from "../tools.js";
import { boxConfigured, boxCall } from "../box-exec.js";
import { desktopAct, desktopConfigured, parseDesktopArg, screenInfo } from "../desktop.js";
import { runSubagent, SUBAGENT_TYPES } from "../subagents.js";
import { getMcpTools, callMcpTool, mcpServers } from "../mcp.js";
import { knowledgeBase } from "../memory.js";
import type { AgentRecord, EmailDraftMsg, SlackDraftMsg, SendArgs, ToolCtx } from "../conversation/types.js";
import { agents, transcripts, todos, renderTodos, automationCreateRef, persist } from "../chat/state.js";
import { createAgent, updateAgent, rosterChanged, ownerOf } from "../directory/index.js";
import { DEFAULT_USER } from "../auth.js";
import { catalog } from "../plugin-catalog.js";
import { installedIds, installPlugin } from "../plugins.js";
import { IMG_MIME, postAttachment, postFileAttachment } from "../conversation/index.js";

/** Late-bound so the catalog does not import the turn loop. */
export const turnHooks = {
  sendPrompt: ((_args: SendArgs) => { throw new Error("runtime/turn not loaded"); }) as (args: SendArgs) => unknown,
  messageAgent: ((_from: string, _to: string, _content: string) => {
    throw new Error("runtime/turn not loaded");
  }) as (from: string, to: string, content: string) => string,
  startSubagentRun: ((_parent: string, _type: string, _title: string) => {
    throw new Error("runtime/turn not loaded");
  }) as (parent: string, type: string, title: string) => string,
  finishSubagentRun: ((_parent: string, _id: string, _status: "running" | "done" | "aborted" | "error") => {
    throw new Error("runtime/turn not loaded");
  }) as (parent: string, id: string, status: "running" | "done" | "aborted" | "error") => void,
};

export function attachmentsOf(a: SendArgs): { path?: string; name?: string }[] {
  if (a.attachments?.length) return a.attachments;
  return (a.attachmentPaths ?? []).map((path, i) => ({ path, name: a.attachmentNames?.[i] }));
}

export function readImageAttachment(atts?: { path?: string; name?: string }[]): string | undefined {
  for (const a of atts ?? []) {
    if (!a.path) continue;
    const staged = readAttachmentImage({ path: a.path });
    if (staged?.dataUrl) return staged.dataUrl;
    const mime = IMG_MIME[extname(a.path || a.name || "").toLowerCase()];
    if (!mime) continue;
    try {
      if (!existsSync(a.path) || statSync(a.path).size > 6_000_000) continue;
      return `data:${mime};base64,${readFileSync(a.path).toString("base64")}`;
    } catch { /* skip unreadable */ }
  }
  return undefined;
}

/** Every tool the model is actually offered right now — used by scripts/tool-coverage.mjs. */
export const toolNames = (): string[] => Object.keys(TOOLS);

const TOOLS: Record<string, (arg: string, ctx: ToolCtx) => string | Promise<string>> = {
  echo: (a) => a || "(empty)",
  time: () => new Date().toISOString(),
  reverse: (a) => [...a].reverse().join(""),
  upper: (a) => a.toUpperCase(),
  count: (a) => `${a.trim().split(/\s+/).filter(Boolean).length} từ, ${a.length} ký tự`,
  calc: (a) => {
    if (!/^[\d\s+\-*/().]+$/.test(a)) return "chỉ hỗ trợ số và + - * / ( )";
    try { return String(Function(`"use strict";return(${a})`)()); } catch { return "biểu thức không hợp lệ"; }
  },
};

/**
 * Ask the user a multiple-choice question (`ask_question` in the original catalog).
 * Auto-approved: it has no side effect, and putting an approval card in front of a question
 * would make the user click twice to be asked something.
 */
/**
 * Remember something about this user (`knowledge_base` in the original catalog).
 *
 * Auto-approved: writing a note has no side effect outside the agent's own memory, and an
 * approval card in front of it would train the model to stop bothering.
 */
/**
 * Search this install's own past conversations — the grokbot2 answer to the stock host's
 * `pastConversationExplorer` subagent.
 *
 * Deliberately NOT one of the original's 54 tool names. The host's version reads an `_index.json`
 * on the box (`status="FINISHED"`, `source="team"`) that does not exist here, so borrowing its name
 * would claim a contract we do not implement. `search_conversations` is ours and says so.
 *
 * Searches the live transcript map — the same entries any transcript read serves — so a result is
 * always something the user could scroll to. (Naming the client's command here would be a
 * boundary violation: `boundaries.test.ts` asserts no domain module knows a Cursor command
 * name, and it caught this comment doing exactly that.) Skips the CURRENT agent's own history: the
 * model already has that in context, and including it makes every search echo the question back.
 */
TOOLS.search_conversations = (arg, ctx) => {
  const { query, agent: agentFilter, days } = toolArgs(arg, [
    { name: "query", aliases: ["q", "term", "search_term", "text", "keyword"] },
    { name: "agent", aliases: ["agentName", "bot", "agentId"] },
    { name: "days", aliases: ["since_days", "within_days", "lookback"] },
  ]);
  const needle = (query ?? "").trim().toLowerCase();
  if (!needle) return 'search_conversations cần {"query":"từ khoá"} — tuỳ chọn: "agent", "days".';

  const windowMs = Number(days) > 0 ? Number(days) * 86_400_000 : 0;
  const oldest = windowMs > 0 ? Date.now() - windowMs : 0;
  const wantAgent = (agentFilter ?? "").trim().toLowerCase();

  const hits: { agentId: string; agentName: string; entryId: string; snippet: string; timestampMs: number }[] = [];
  for (const [agentId, entries] of transcripts) {
    if (agentId === ctx.agentId) continue;
    const rec = agents.get(agentId);
    const agentName = rec?.name ?? agentId;
    if (wantAgent && !agentName.toLowerCase().includes(wantAgent) && agentId.toLowerCase() !== wantAgent) continue;
    for (const e of entries) {
      if (e.timestampMs < oldest) continue;
      const text = e.kind === "message" ? e.content
        : e.kind === "send-message" ? (e.message.type === "text" ? e.message.content : "")
        : e.kind === "tool-call" ? `${e.name} ${e.summary ?? ""} ${e.result ?? ""}`
        : "";
      if (!text || !text.toLowerCase().includes(needle)) continue;
      const at = text.toLowerCase().indexOf(needle);
      hits.push({
        agentId,
        agentName,
        entryId: e.id,
        // A window around the match, not the head of the entry: a hit 3000 chars into a shell
        // result is invisible if the snippet always starts at character zero.
        snippet: text.slice(Math.max(0, at - 90), at + 150).replace(/\s+/g, " ").trim(),
        timestampMs: e.timestampMs,
      });
    }
  }

  if (hits.length === 0) {
    const scope = [wantAgent ? `bot "${agentFilter}"` : null, windowMs ? `${days} ngày gần đây` : null].filter(Boolean).join(", ");
    return `Không thấy "${query}" trong hội thoại cũ${scope ? ` (${scope})` : ""}.`;
  }

  // Newest first, capped: this goes into a prompt, and 400 hits would crowd out the answer.
  hits.sort((a, b) => b.timestampMs - a.timestampMs);
  const shown = hits.slice(0, 20);
  const head = `${hits.length} kết quả cho "${query}"${hits.length > shown.length ? `, hiện ${shown.length} mới nhất` : ""}:`;
  return [head, ...shown.map((h) => {
    const when = new Date(h.timestampMs).toISOString().slice(0, 16).replace("T", " ");
    return `- [${h.agentName}] ${when} · ${h.entryId}\n    ${h.snippet}`;
  })].join("\n");
};

TOOLS.knowledge_base = async (arg, ctx) => {
  let spec: any;
  try { spec = JSON.parse(arg); } catch { spec = { knowledge_to_store: arg }; }
  const r = await knowledgeBase(ctx.agentId, {
    knowledge_to_store: spec?.knowledge_to_store ?? spec?.content ?? spec?.text,
    title: spec?.title,
    existing_knowledge_id: spec?.existing_knowledge_id ?? spec?.id,
    action: spec?.action,
  });
  return r.confirmation_message;
};

TOOLS.ask_question = (arg, ctx) => {
  let spec: any;
  try { spec = JSON.parse(arg); } catch { return 'ask_question cần JSON, ví dụ {"prompt":"…","options":[{"label":"A"}]}'; }
  // The client's own zod schema caps options at SIX; a seventh makes the whole card invalid
  // and it renders as nothing. Models happily produce eight, so cap here rather than let a
  // question disappear — a silently missing question reads as the agent ignoring the user.
  const options = (Array.isArray(spec?.options) ? spec.options : [])
    .map((o: any) => (typeof o === "string" ? { label: o } : o))
    .filter((o: any) => typeof o?.label === "string")
    .slice(0, 6);
  const prompt = typeof spec?.prompt === "string" ? spec.prompt : typeof spec?.title === "string" ? spec.title : "";
  const id = ctx.ask({
    prompt,
    options,
    ...(typeof spec?.helpText === "string" ? { helpText: spec.helpText } : {}),
    ...(typeof spec?.allowCustom === "boolean" ? { allowCustom: spec.allowCustom } : {}),
    ...(typeof spec?.dismissOnMoveOn === "boolean" ? { dismissOnMoveOn: spec.dismissOnMoveOn } : {}),
  });
  return id == null
    ? "ask_question cần prompt không rỗng và ít nhất một option"
    : `đã hỏi người dùng: ${prompt}`;
};

/**
 * Show a draft before anything is sent. These render as the client's own draft cards, but the
 * renderer gives them no send button — see EmailDraftMsg — so the turn should say what it wants
 * to do with the draft rather than implying it went out.
 */
/**
 * Message another bot (`send_message` in the original's tool identifiers). This is what makes
 * a roster act like a team: one bot briefs another and the reply comes back as its own turn.
 */
TOOLS.message_agent = (arg, ctx) => {
  let spec: any;
  try { spec = JSON.parse(arg); } catch {
    const m = arg.match(/^\s*([^:,]+)\s*[:,]\s*([\s\S]+)$/);   // "Sales: nội dung"
    spec = m ? { to: m[1], content: m[2] } : null;
  }
  const raw = spec?.to ?? spec?.agent ?? spec?.name ?? spec?.agents ?? spec?.bots;
  // One target or many. The client turns several consecutive outbound entries into
  // "Messaged N agents" by itself (see the fan-out note on messageAgent), so briefing a whole
  // team is just this tool called with a list — no new entry kind, no new gateway method.
  const targets = (Array.isArray(raw) ? raw : String(raw ?? "").split(/[,;]/))
    .map((t) => String(t).trim()).filter(Boolean);
  const content = String(spec?.content ?? spec?.message ?? spec?.text ?? "").trim();
  if (targets.length === 0 || !content) return 'message_agent cần {"to":"tên bot" hoặc ["bot A","bot B"],"content":"nội dung"}';
  return targets.map((t) => turnHooks.messageAgent(ctx.agentId, t, content)).join("; ");
};

/**
 * Speak mid-turn — the port of the original's `SendMessage`.
 *
 * The two architectures are inverted, and this is the seam. In the original, the model's plain
 * text is a private scratchpad and `SendMessage` is the ONLY channel that reaches the user, so
 * every call is its own bubble and a long task narrates itself step by step. Here the plain
 * text IS the message, which gives exactly one bubble per turn — so a multi-step turn ran the
 * browser, attached screenshots, and said nothing at all until the very end. Reported as
 * "agent làm việc rồi vất mấy tấm ảnh, không có phản hồi nào".
 *
 * Rather than invert our model (risky, and the streaming reply is the good part), this adds the
 * missing half: the model can post an interim line whenever it wants, and its closing text is
 * still the final bubble. `ctx.note` already emits the right entry — a `send-message` with
 * `type:"text"` is exactly what the renderer draws as a bubble — so nothing new is needed on
 * the transcript side.
 *
 * The name is the catalog's (`send_to_user`, CLIENT_SIDE_TOOL_V2_SEND_TO_USER). Its parameter
 * shape is not in the extracted catalog (`paramsMessage: null`), so this takes plain text and a
 * `{"text":…}` object rather than pretending to know the original's field name.
 */
TOOLS.send_to_user = (arg, ctx) => {
  let text = arg.trim();
  if (text.startsWith("{")) {
    try {
      const o = JSON.parse(text);
      text = String(o?.text ?? o?.message ?? o?.content ?? "").trim();
    } catch { text = unquote(arg); }
  } else {
    text = unquote(arg);
  }
  if (!text) return "(send_to_user cần nội dung)";
  ctx.note(text);
  return "đã gửi";
};

/**
 * Building the roster from inside a conversation.
 *
 * The original's agent does this — its history shows one bot answering "Tạo 3 con luôn. Con
 * 'New Bot' trống mình đổi thành Quản lý, rồi thêm Gmail và Discord CSKH." and the roster
 * gaining three bots. The activity table names the tools `CreateAgent` and `UpdateAgent`
 * (both render as "Messaging"), which is why those are the activity strings used here.
 *
 * Creating is deliberately not auto-approved: it changes the user's sidebar, which is theirs.
 */
TOOLS.create_agent = (arg, ctx) => {
  let spec: any;
  try { spec = JSON.parse(arg); } catch { spec = { name: unquote(arg) }; }
  const names = (Array.isArray(spec?.names) ? spec.names : [spec?.name ?? spec?.title ?? unquote(arg)])
    .map((n: unknown) => String(n ?? "").trim()).filter(Boolean);
  if (names.length === 0) return 'create_agent cần {"name":"tên bot"} hoặc {"names":["A","B"]}';
  const made: AgentRecord[] = names.map((n: string) => createAgent({ name: n }));
  // Brief each new bot with its purpose, if one was given — an empty bot is not a colleague.
  const brief = String(spec?.brief ?? spec?.role ?? spec?.instructions ?? "").trim();
  if (brief) for (const m of made) turnHooks.sendPrompt({ agentId: m.id, content: brief, fromAgent: { id: ctx.agentId, name: agents.get(ctx.agentId)?.name ?? "bot" } });
  return `đã tạo ${made.map((m) => m.name).join(", ")}`;
};

/**
 * Let a bot schedule ITSELF — the piece the original has and we did not.
 *
 * Traced in the original's own history: nobody asked for a routine. The user said "mở đúng chat Thư ký
 * trên Grok Bot. Muốn thử Slack thì bảo mình install", and the bot installed the Slack connector,
 * connected it, then created a routine called "Slack lệnh Thư ký" and told the user to `/invite
 * @Cursor`. The instruction it wrote is in ENGLISH inside an otherwise Vietnamese conversation and
 * names the exact ids and roles of five sibling bots — which is the tell that the agent wrote it, not
 * the person. The later `updated` event has no bot message before it: that one WAS the routine editor.
 *
 * The backend side already existed (`createAgentAutomation`, the scheduler, the panel); only the tool
 * was missing, so the model had no way to reach any of it.
 */
TOOLS.create_routine = (arg, ctx) => {
  let spec: any;
  try { spec = JSON.parse(arg); } catch { spec = { prompt: unquote(arg) }; }
  const prompt = String(spec?.prompt ?? spec?.instruction ?? spec?.task ?? "").trim();
  if (!prompt) return 'create_routine cần {"name":"tên","prompt":"việc cần làm","trigger":"0 9 * * *"}';
  const name = String(spec?.name ?? spec?.title ?? "").trim() || "Routine";
  // The trigger is a cron string, or a platform word for an event-driven routine. Passing the word
  // through unchanged is what lets `listenerPlatform` recognise it and warn that nothing can fire it.
  const trigger = String(spec?.trigger ?? spec?.schedule ?? spec?.when ?? "0 9 * * *").trim();
  if (!automationCreateRef) return "(routine chưa sẵn sàng)";
  const made = automationCreateRef(ctx.agentId, { name, prompt, trigger });
  return made ? `đã tạo routine "${name}" — ${made}` : "(không tạo được routine)";
};

TOOLS.rename_agent = (arg, ctx) => {
  let spec: any;
  try { spec = JSON.parse(arg); } catch {
    const m = arg.match(/^\s*([^,]+)\s*,\s*([\s\S]+)$/);      // "Cũ, Mới"
    spec = m ? { from: m[1], to: m[2] } : { to: unquote(arg) };
  }
  const wanted = String(spec?.to ?? spec?.name ?? spec?.newName ?? "").trim();
  if (!wanted) return 'rename_agent cần {"from":"tên cũ","to":"tên mới"} (bỏ "from" để tự đổi tên mình)';
  const fromRaw = String(spec?.from ?? spec?.agent ?? "").trim();
  const target = fromRaw
    ? agents.get(fromRaw) ?? [...agents.values()].find((a) => a.name.toLowerCase() === fromRaw.toLowerCase())
    : agents.get(ctx.agentId);
  if (!target) return `(không tìm thấy bot "${fromRaw}")`;
  const was = target.name;
  updateAgent({ id: target.id, profile: { name: wanted } });
  rosterChanged(target.id);
  return `đã đổi tên "${was}" thành "${wanted}"`;
};

/**
 * Attach a file the agent already wrote (with edit_file_v2) to the conversation.
 *
 * Kept separate from writing on purpose: the original writes and attaches as two visible
 * steps, and folding them together would attach every scratch file the agent touches.
 */
TOOLS.attach_file = async (arg, ctx) => {
  let spec: any;
  try { spec = JSON.parse(arg); } catch { spec = { path: unquote(arg) }; }
  const path = String(spec?.path ?? spec?.file ?? spec?.target_file ?? "").trim();
  if (!path) return 'attach_file cần {"path":"tên file trên máy tính của bạn"}';

  // Resolve to the absolute box path: the renderer keys the preview off exactly the string
  // in `url`, so a relative path here and an absolute one at read time never meet.
  let abs = path, size = 0;
  try {
    const r = await boxCall<{ path: string; totalSize: number }>("readBytes", { target_file: path, offset: 0, length: 0 });
    abs = r.path; size = r.totalSize;
  } catch (e) {
    return `Không đọc được ${path}: ${(e as Error).message}`;
  }
  const fileName = abs.split("/").pop() || path;
  const alt = String(spec?.alt ?? spec?.caption ?? fileName);
  postFileAttachment(ctx.agentId, abs, fileName, alt);
  return `Đã đính kèm ${fileName} (${size} byte).`;
};

/** Refuse anything larger than this. A transcript attachment is inlined as base64 to the client. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * Is this host inside the machine or its network?
 *
 * Checking the literal string is not enough — `evil.test` can resolve to 127.0.0.1, and that is
 * the ordinary way a fetcher is turned against its own host. So the name is resolved and every
 * address it returns is judged; a name resolving to several addresses is only safe when all of
 * them are. Unresolvable is treated as internal: the fetch would fail anyway, and defaulting a
 * security check to "allow" on an error is how these fences stop working quietly.
 */
async function isInternalHost(hostname: string): Promise<boolean> {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  let addrs: string[];
  try {
    const { lookup } = await import("node:dns/promises");
    addrs = (await lookup(host, { all: true })).map((a) => a.address);
  } catch {
    return true;
  }
  return addrs.length === 0 || addrs.some(isPrivateAddress);
}

/** Loopback, link-local, and the RFC1918 / unique-local ranges, for both address families. */
function isPrivateAddress(addr: string): boolean {
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(addr);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 127 || a === 10
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 169 && b === 254)      // link-local, incl. the 169.254.169.254 metadata address
      || (a === 100 && b >= 64 && b <= 127)
      || a >= 224;                     // multicast and reserved
  }
  const v6 = addr.toLowerCase();
  if (v6 === "::" || v6 === "::1") return true;
  if (v6.startsWith("fe80") || v6.startsWith("fc") || v6.startsWith("fd")) return true;
  // ::ffff:127.0.0.1 and friends — an IPv4 address wearing a v6 coat.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  return mapped ? isPrivateAddress(mapped[1]) : false;
}

/**
 * Show a picture that lives on the web, by fetching the bytes and attaching them.
 *
 * This is the only implementation that works. The renderer will not load a third-party URL —
 * a real CDN link renders as "Couldn't load image" — which is exactly why every image in the
 * original's transcript is an attachment and never a link (parity.md §2u). Without this tool
 * the model's only way to answer "show me the images on this page" was a markdown link, which
 * is what it was doing.
 *
 * The URL comes from the model, so this is a request forger's tool by construction. It is
 * fenced accordingly: http(s) only, and no address inside the machine or its network. That
 * matters more here than the generic advice implies — the box's Chrome DevTools port listens
 * on loopback and is unauthenticated remote code execution, so an unfenced fetcher would hand
 * a prompt-injected page a way to reach it.
 */
TOOLS.attach_image = async (arg, ctx) => {
  let spec: any;
  try { spec = JSON.parse(arg); } catch { spec = { url: unquote(arg) }; }

  // One call per image was the first shape, and it spends a tool step per picture against a
  // budget of MAX_TOOL_STEPS for the whole turn: asking for six images left no steps to answer
  // with. The batch form is the same tool, so the model can keep using `url` for one.
  const list: string[] = Array.isArray(spec?.urls) ? spec.urls
    : Array.isArray(spec?.url) ? spec.url
    : [spec?.url ?? spec?.src ?? spec?.href];
  const urls = list.map((u) => String(u ?? "").trim()).filter(Boolean);
  if (urls.length === 0) return 'attach_image cần {"url":"https://…"} hoặc {"urls":["…","…"]}';

  if (urls.length > 1) {
    const capped = urls.slice(0, MAX_IMAGES_PER_CALL);
    // Sequential, not Promise.all: each success posts an attachment, and the transcript should
    // fill in the order the model asked for rather than in whichever order the CDNs answer.
    const lines: string[] = [];
    for (const [i, u] of capped.entries()) lines.push(`${i + 1}. ${await attachOneImage(ctx.agentId, u, spec?.alt)}`);
    if (urls.length > capped.length) lines.push(`(bỏ qua ${urls.length - capped.length} ảnh: mỗi lần gọi tối đa ${MAX_IMAGES_PER_CALL})`);
    return lines.join("\n");
  }
  return attachOneImage(ctx.agentId, urls[0], spec?.alt);
};

/** At most this many images in one batched call, so a turn cannot be flooded with attachments. */
const MAX_IMAGES_PER_CALL = 8;

/** Fetch, fence, measure and post a single image. Returns the sentence the model reads back. */
async function attachOneImage(agentId: string, raw: string, altHint?: unknown): Promise<string> {
  let target: URL;
  try { target = new URL(raw); } catch { return `Không phải URL hợp lệ: ${raw}`; }
  if (target.protocol !== "http:" && target.protocol !== "https:") return "Chỉ tải được ảnh qua http/https.";
  if (await isInternalHost(target.hostname)) return "Không tải ảnh từ địa chỉ nội bộ.";

  let bytes: Buffer;
  let res: Response;
  try {
    res = await fetch(target, { redirect: "follow", signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return `Tải ảnh thất bại (HTTP ${res.status}).`;
    // Cap what is read. Content-Length is a claim the server makes and can omit or lie about,
    // so the buffer is checked after the read as well as before it.
    const claimed = Number(res.headers.get("content-length") ?? 0);
    if (claimed > MAX_IMAGE_BYTES) return `Ảnh quá lớn (${Math.round(claimed / 1024)} KB).`;
    bytes = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    return `Không tải được ảnh: ${(e as Error).message}`;
  }
  if (bytes.length > MAX_IMAGE_BYTES) return `Ảnh quá lớn (${Math.round(bytes.length / 1024)} KB).`;

  // A redirect can leave http(s) for the internal network, and the fence above only saw the
  // first hop. `res.url` is where the bytes actually came from, so re-check it.
  try {
    const landed = new URL(res.url || target.href);
    if (await isInternalHost(landed.hostname)) return "Không tải ảnh từ địa chỉ nội bộ.";
  } catch { /* keep the original verdict */ }

  const measured = imageSize(bytes);
  if (measured == null) return "Nội dung tải về không phải ảnh đọc được (PNG/JPEG/GIF/WebP).";

  const fileName = decodeURIComponent(target.pathname.split("/").pop() || "") || `image.${measured.mime.slice(6)}`;
  const alt = String(altHint ?? fileName);
  postAttachment(agentId, `data:${measured.mime};base64,${bytes.toString("base64")}`, fileName, alt);
  return `Đã đính kèm ${fileName} (${measured.width}×${measured.height}).`;
}

/**
 * Make a picture from a description — `generate_image` in the original's catalog.
 *
 * The catalog entry carries no parameter message (`paramsMessage: null`) and the shipped prompt
 * never describes it, so the contract came from the pool itself rather than from a guess:
 *
 *   POST /v1/images {model, prompt}
 *     → {model, count, images:[{url, rel, mimeType}], edited, account}
 *
 * It answers with a URL, not bytes, so the second half is `attachOneImage` unchanged — the same
 * download, internal-address fence, format measurement and staging that `attach_image` uses. The
 * client cannot load a remote image (parity.md §2u), so staging is not an optimisation here; it
 * is the only thing that puts the picture on screen.
 */
TOOLS.generate_image = async (arg, ctx) => {
  let spec: any;
  try { spec = JSON.parse(arg); } catch { spec = { prompt: unquote(arg) }; }
  const prompt = String(spec?.prompt ?? spec?.description ?? spec?.text ?? "").trim();
  if (!prompt) return 'generate_image cần {"prompt":"mô tả ảnh muốn vẽ"}';

  const key = loadPoolKey();
  if (!key) return "Chưa có key cho pool nên không tạo được ảnh.";

  let payload: { images?: { url?: string }[] };
  try {
    const res = await fetch(config.imagesUrl, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: config.imageModel, prompt }),
      // Generation is slower than a chat turn; the pool answered in ~10s when probed.
      signal: AbortSignal.timeout(120_000),
    });
    const text = await res.text();
    if (!res.ok) return `Tạo ảnh thất bại (HTTP ${res.status}): ${text.slice(0, 160)}`;
    payload = JSON.parse(text);
  } catch (e) {
    return `Không tạo được ảnh: ${(e as Error).message}`;
  }

  const url = payload?.images?.[0]?.url;
  if (typeof url !== "string" || !url) return "Pool không trả về ảnh nào.";
  const alt = String(spec?.alt ?? prompt).slice(0, 200);
  return attachOneImage(ctx.agentId, url, alt);
};

TOOLS.email_draft = (arg, ctx) => {
  let d: any;
  try { d = JSON.parse(arg); } catch { return 'email_draft cần {"to":["a@b.c"],"subject":"…","body":"…"}'; }
  const to = Array.isArray(d?.to) ? d.to.filter((x: unknown) => typeof x === "string") : typeof d?.to === "string" ? [d.to] : [];
  const subject = typeof d?.subject === "string" ? d.subject : "";
  const body = typeof d?.body === "string" ? d.body : "";
  if (to.length === 0 || !body) return 'email_draft cần ít nhất {"to":[…],"body":"…"}';
  ctx.draft({ type: "email-draft", draft: { ...(typeof d.from === "string" ? { from: d.from } : {}), to, subject, body } });
  return `đã soạn nháp email tới ${to.join(", ")} (chưa gửi — cần người dùng xác nhận)`;
};

TOOLS.slack_draft = (arg, ctx) => {
  let d: any;
  try { d = JSON.parse(arg); } catch { return 'slack_draft cần {"target":"#kênh","body":"…"}'; }
  const target = typeof d?.target === "string" ? d.target : "";
  const body = typeof d?.body === "string" ? d.body : "";
  if (!target || !body) return 'slack_draft cần {"target":"#kênh hoặc @người","body":"…"}';
  ctx.draft({
    type: "slack-draft",
    draft: {
      ...(typeof d.workspace === "string" ? { workspace: d.workspace } : {}),
      target,
      ...(typeof d.thread === "string" ? { thread: d.thread } : {}),
      body,
    },
  });
  return `đã soạn nháp Slack cho ${target} (chưa gửi — cần người dùng xác nhận)`;
};

/**
 * A visible checklist for multi-step work (`todo_write` / `todo_read` in the original catalog).
 * Persisted with everything else, so a restart mid-task does not lose the plan.
 */
TOOLS.todo_write = (arg, ctx) => {
  let items: any;
  try { items = JSON.parse(arg); } catch { return 'todo_write cần một mảng, ví dụ ["việc A","việc B"] hoặc [{"text":"…","done":true}]'; }
  const list = (Array.isArray(items) ? items : items?.todos ?? [])
    .map((t: any) => (typeof t === "string" ? { text: t, done: false } : { text: String(t?.text ?? ""), done: t?.done === true }))
    .filter((t: { text: string }) => t.text.length > 0);
  if (list.length === 0) return "todo_write cần ít nhất một việc";
  todos.set(ctx.agentId, list);
  persist();
  return renderTodos(list);
};

TOOLS.todo_read = (_arg, ctx) => {
  const list = todos.get(ctx.agentId) ?? [];
  return list.length ? renderTodos(list) : "(chưa có việc nào)";
};

/**
 * `create_plan` — the original's plan tool. There is no plan card in the renderer, so the plan
 * is delivered as an ordinary message and kept as the todo list, which is what makes it visible.
 */
TOOLS.create_plan = (arg, ctx) => {
  let spec: any;
  try { spec = JSON.parse(arg); } catch { spec = { steps: arg.split(/\s*[;\n]\s*/) }; }
  const title = typeof spec?.title === "string" ? spec.title : "Kế hoạch";
  const steps = (Array.isArray(spec?.steps) ? spec.steps : Array.isArray(spec?.todos) ? spec.todos : [])
    .map((x: any) => String(typeof x === "string" ? x : x?.text ?? "")).filter((x: string) => x.trim());
  if (steps.length === 0) return 'create_plan cần {"title":"…","steps":["…","…"]}';
  const list = steps.map((text: string) => ({ text, done: false }));
  todos.set(ctx.agentId, list);
  persist();
  return `${title}\n${renderTodos(list)}`;
};

/**
 * Hand the box's screen to the user for a step only they can do — signing in, 2FA, an OAuth
 * approval (`request_box_help` in the original catalog).
 *
 * The turn blocks here until they press hand-back, which is the point: the agent must never
 * ask for, see, or type a password. They authenticate on the box desktop and the session
 * persists there, so it is a one-time step.
 */
TOOLS.request_box_help = async (arg, ctx) => {
  let spec: any;
  try { spec = JSON.parse(arg); } catch { spec = { instruction: arg }; }
  // Read the key the model actually used, not the one we hoped for. Falling back to the raw
  // `arg` printed `{"message":"…"}` verbatim into the chat when it sent `message` — a JSON
  // blob shown to the user as if it were a sentence. Any single string value will do.
  const named = spec?.instruction ?? spec?.prompt ?? spec?.message ?? spec?.task ?? spec?.text ?? spec?.ask;
  const onlyString = named == null && spec && typeof spec === "object"
    ? Object.values(spec).find((v) => typeof v === "string" && v.trim())
    : undefined;
  const instruction = String(named ?? onlyString ?? (typeof spec === "string" ? spec : "")).trim();
  if (!instruction) return 'request_box_help cần {"instruction":"việc cần bạn làm trên màn hình"}';
  ctx.note(`Mình cần bạn thao tác trên màn hình máy tính của mình: ${instruction}`);
  return ctx.requestBoxHelp(instruction);
};

/**
 * Hand a self-contained chunk of work to a subagent (`task_v2` in the original catalog).
 * This is how the original drives the browser: not from the main turn, but through a
 * `browserUse` subagent carrying its own prompt and tool set (see subagents.ts).
 */
TOOLS.task_v2 = async (arg, ctx) => {
  let spec: any;
  try { spec = JSON.parse(arg); } catch { spec = { subagent_type: "browserUse", prompt: arg }; }
  const type = String(spec?.subagent_type ?? spec?.type ?? "browserUse");
  const task = String(spec?.prompt ?? spec?.task ?? spec?.description ?? "").trim();
  if (!task) return 'task_v2 cần {"subagent_type":"browserUse","prompt":"…"}';

  // The title is the first line of the task, which is what the original's registry stores and
  // what the subagent list shows. Registering before the run is the point: a list that only
  // gains a row once the work finishes never shows anything as "running".
  const title = task.split("\n")[0].slice(0, 80);
  const subagentId = turnHooks.startSubagentRun(ctx.agentId, type, title);
  try {
    const out = await runSubagent(type, task, Object.keys(TOOLS), {
      runTool: async (name, toolArg) => {
        const fn = TOOLS[name];
        if (!fn) return `(không có công cụ ${name})`;
        try { return String(await fn(toolArg, ctx)); } catch (e) { return `lỗi: ${(e as Error).message}`; }
      },
      // The original tells the parent to keep the user posted while a subagent works; the
      // subagent's own steps are the only honest source of that.
      onStep: (text) => ctx.note(text),
    });
    // runSubagent reports its own refusals as text rather than throwing, so a leading "(" is
    // the difference between "ran and answered" and "never started".
    turnHooks.finishSubagentRun(ctx.agentId, subagentId, out.startsWith("(") ? "error" : "done");
    return out;
  } catch (e) {
    turnHooks.finishSubagentRun(ctx.agentId, subagentId, "error");
    throw e;
  }
};

/**
 * MCP tools (`get_mcp_tools` / `call_mcp_tool` in the original catalog) — structured access to
 * connected services.
 *
 * Registered UNCONDITIONALLY. They used to sit behind `if (isMcpConfigured())`, evaluated once when
 * this module loaded — which had two consequences once servers became per-user and installable:
 * installing a plugin could not make the tools appear (they were decided at boot), and an install
 * on a machine whose default config was empty at startup was inert for ever. The tools are
 * self-describing when there is nothing to reach ("chưa cấu hình MCP …"), and the PROMPT below only
 * mentions MCP to owners who actually have servers, so nothing is advertised that cannot run.
 *
 * Multi-tenant Phase 6: servers run under the agent's OWNER, so one tenant's tokens never spawn for
 * another. The turn is detached from the request, so ownerOf(agentId) is the identity — not
 * currentOwner(), which would be the default here.
 */
/**
 * `setup_plugin` — install a marketplace plugin and hand it its credentials.
 *
 * The client's own setup form was the only way to do this, so a bot that had just read an App ID off
 * a page had nowhere to put it: it could browse, and it could not finish. This is the missing half.
 *
 * Two modes, like `get_mcp_tools`: no argument lists the catalog and what each row needs; a plugin
 * installs it. Credentials go to the owner's secret store, never into the MCP config and never into
 * the transcript — the reply names the keys it saved, never their values.
 *
 * Deliberately bounded. It can only install ids that are ALREADY in this install's catalog, which
 * the operator controls, so the worst a hijacked turn can do is add a plugin you had vetted. It is
 * not auto-approved, so it shows the permission card like the other tools that write.
 *
 * Required-vs-optional comes from the same schema the app's form uses. Missing a required one does
 * NOT install: it answers with the names, so the model asks the person instead of installing
 * something that cannot work.
 */
function setupPlugin(arg: string, owner: string): string {
  const rows = catalog();
  const needs = (r: (typeof rows)[number]): { key: string; required: boolean }[] =>
    Object.keys(r.variablesSchema?.properties ?? {}).map((key) => ({
      key,
      required: r.variablesSchema?.required?.includes(key) ?? false,
    }));

  const installed = new Set(installedIds(owner));
  const describe = (r: (typeof rows)[number]): string => {
    const n = needs(r);
    return `- ${r.name} (${r.displayName})${installed.has(r.id) ? " [đã cài]" : ""}` +
      (n.length ? ` — cần: ${n.map((c) => c.key + (c.required ? "*" : "")).join(", ")}` : " — không cần gì");
  };

  const raw = arg.trim();
  let want = "";
  let values: Record<string, string> = {};
  if (raw.startsWith("{")) {
    try {
      const d = JSON.parse(raw) as { plugin?: unknown; name?: unknown; id?: unknown; values?: unknown };
      want = String(d.plugin ?? d.name ?? d.id ?? "").trim();
      if (d.values && typeof d.values === "object") {
        for (const [k, v] of Object.entries(d.values as Record<string, unknown>)) {
          if (typeof v === "string") values[k] = v;
        }
      }
    } catch {
      return 'setup_plugin cần JSON, ví dụ {"plugin":"lark","values":{"LARK_APP_ID":"…","LARK_APP_SECRET":"…"}}';
    }
  } else {
    want = raw.replace(/^["']|["']$/g, "");
  }

  if (!want) {
    return "Plugin cài được (dấu * = bắt buộc):\n" + rows.map(describe).join("\n") +
      '\nCài bằng TOOL_CALL: setup_plugin({"plugin":"<tên>","values":{"KHOÁ":"giá trị"}})';
  }

  const key = want.toLowerCase();
  const row = rows.find((r) => String(r.id) === want || r.name.toLowerCase() === key) ??
    rows.find((r) => r.displayName.toLowerCase() === key);
  if (!row) return `Không có plugin "${want}". Có: ${rows.map((r) => r.name).join(", ")}.`;

  const missing = needs(row).filter((c) => c.required && !(values[c.key] ?? "").trim());
  if (missing.length) {
    return `"${row.displayName}" cần ${missing.map((c) => c.key).join(", ")} trước khi cài được. ` +
      "Hỏi người dùng giá trị (hoặc lấy từ trang quản trị của họ), rồi gọi lại kèm chúng trong \"values\".";
  }

  if (!installPlugin(row.id, owner, values)) return `Không cài được "${row.displayName}".`;

  const saved = Object.keys(values).filter((k) => values[k].trim());
  return `Đã cài ${row.displayName}` +
    (row.mcp ? ` — MCP server "${row.mcp.name}" sẵn sàng ở lượt sau` : "") +
    (saved.length ? `. Đã lưu: ${saved.join(", ")} (giá trị không hiện ở đây)` : "") + ".";
}

TOOLS.setup_plugin = (arg, ctx) => setupPlugin(arg, ownerOf(ctx.agentId) ?? DEFAULT_USER.authId);

TOOLS.get_mcp_tools = (arg, ctx) => getMcpTools(arg, ownerOf(ctx.agentId) ?? DEFAULT_USER.authId);
TOOLS.call_mcp_tool = (arg, ctx) => callMcpTool(arg, ownerOf(ctx.agentId) ?? DEFAULT_USER.authId);

/**
 * These protocol strings are ENGLISH on purpose, like the rest of the prompt.
 *
 * `BASE_SYSTEM_PROMPT` is generated from the original app (79 of its 179 chapters) and is English
 * throughout; these seams were written here in Vietnamese, which left the shipped prompt a mix —
 * measured, 18 of 100 non-empty lines and 8% of its characters. Where the original has a sentence for
 * something, its wording is quoted below rather than paraphrased, so a model that knows the original
 * behaves the same way here. Only the mechanics of `TOOL_CALL: name(args)` are ours, because the
 * original invokes tools as native ClientSideToolV2Call protobufs and the pool has no native tool
 * calling at all.
 *
 * Measured before switching, three sequential attempts per cell with gemini-3.7-flash: tool calling is
 * IDENTICAL between the two languages (two-file task 6 calls either way, shell 3/3 either way, no
 * spurious calls either way), and a Vietnamese question still gets a Vietnamese answer 3/3 with an
 * English seam — the reply language follows the user, not the prompt. So this change buys consistency
 * with the original, not behaviour, and it is claimed as nothing more.
 *
 * What stays Vietnamese: every string the USER reads. `"[grokbot2] Pool trả về rỗng — thử gửi lại."`
 * and its kind are rendered in the app, not read by the model.
 */
/**
 * The MCP paragraph, for ONE owner, computed per turn.
 *
 * It was a module-level constant built from `mcpServers()` at import time, which read the DEFAULT
 * owner's config outside any request. Two bugs followed: every tenant's bot was told the default
 * user's server names (and never its own), and a plugin installed after boot stayed invisible to
 * the model until the backend restarted. Naming a server the model cannot reach is worse than
 * silence, so an owner with no servers gets no paragraph at all.
 */
const mcpProtocolFor = (owner: string): string => {
  const names = Object.keys(mcpServers(owner));
  if (names.length === 0) return "";
  return "\n\nMCP: these services are already connected — " + names.join(", ") + ". " +
    "List a server's tools with TOOL_CALL: get_mcp_tools(<server name>), then call one with " +
    'TOOL_CALL: call_mcp_tool({"server":"…","tool_name":"…","tool_args":{…}}). ' +
    "Prefer MCP over opening a browser when the service is already here.";
};

// Browser actions are only offered when a box browser is actually configured — advertising
// tools that cannot run just teaches the model to call them and fail.
// Registered only once the browser has actually answered. Configured-but-unreachable is
// the expensive case: the tool is offered, the model calls it, and the user waits out a
// socket timeout for "fetch failed".
// Registration follows CONFIGURATION, not a one-shot reachability probe.
//
// Gating on the probe meant a tunnel that happened to be down for those few seconds removed
// the browser tools for the whole life of the process — they never came back when the tunnel
// did, and the model simply answered as if it had no browser. A per-call failure is honest and
// recoverable ("no page target - is Chrome running on the box?"); a silently missing tool is
// neither. The probe stays, but only to say so in the startup line.
if (isBrowserConfigured()) {
  for (const name of BROWSER_TOOL_NAMES) TOOLS[name] = (arg, ctx) => runBrowserTool(name, arg, ctx);
  void browserProbe();
}

// Tools under their real ClientSideToolV2 names. availableTools() drops the shell/file ones
// when no box is attached — they run inside it and nowhere else — while web_search and
// web_fetch need neither a box nor a key, so they are always on.
for (const [name, spec] of Object.entries(availableTools())) TOOLS[name] = (arg) => spec.run(arg);

/**
 * The names and the "you already get the page back" rule come from the original's own
 * browser-use subagent reminder (docs/extracted/subagent-prompts.md); reusing its vocabulary
 * means a model that knows the original behaves correctly here.
 */
const BROWSER_PROTOCOL = isBrowserConfigured()
  // "box" is internal jargon; the original forbids saying it to the user, and the model repeats
  // whatever the tool text uses — it introduced itself as running on a "Linux Box" in a live reply.
  ? "\n\nBROWSER: the browser_* tools drive Chrome on your computer, and the user watches it live on " +
    "screen. Arguments are JSON, e.g. " +
    'TOOL_CALL: browser_navigate({"url":"https://example.com"}) or ' +
    'TOOL_CALL: browser_fill({"selector":"#q","value":"hello"}). ' +
    "Every action already returns the page state that follows it, so do NOT call browser_snapshot " +
    "or browser_take_screenshot right after another action. " +
    // Observed: asked to pull the images out of an article it had just opened, the model wrote a
    // python3 + urllib scraper and called run_terminal_command_v2 — which needs approval, refetches
    // the page as a bot, and loses everything JavaScript had rendered. The page was already there.
    "To pull content OUT of the page that is already open (images, links, titles, tables…), use " +
    "browser_evaluate on that page — do not re-fetch it with a shell command (curl/python) or " +
    "web_fetch: the open page has run its JavaScript and carries the cookies and sign-in, while a " +
    "re-fetch is usually blocked and loses everything rendered dynamically. " +
    'To collect images: TOOL_CALL: browser_evaluate({"expression":' +
    '"[...document.querySelectorAll(\'img\')].map(i=>i.currentSrc||i.src).filter(u=>u.startsWith(\'http\')).slice(0,20)"})' +
    // Having the URLs was only half of it: the model then wrote them out as markdown links,
    // which is the one thing that cannot work — the client refuses to load a third-party image
    // and shows "Couldn't load image" (parity.md §2u). Naming the tool here is what closes the
    // loop between finding an image and the user seeing it.
    // "Show your work. When you've done something visible, attach the screenshot or file that proves
    // it." — the original's own words; this is the tool that carries them out.
    "\nShow your work: once you have the image URLs, attach them so the USER actually SEES them, with " +
    'TOOL_CALL: attach_image({"urls":["https://…","https://…"]}) — send ALL of them in ONE call ' +
    '(max 8); for a single image use {"url":"https://…","alt":"description"}. ' +
    "A markdown link ![](…) will NOT display the image."
  : "";

/**
 * Image generation is advertised separately from the browser rules.
 *
 * The `attach_image` instructions live inside BROWSER_PROTOCOL because they are about pictures
 * found on a page, and that block disappears when no browser is configured. Drawing one does not
 * need a browser, so putting it there would have hidden the tool on exactly the setups where it
 * is the only way to produce an image at all.
 */
const IMAGE_PROTOCOL =
  "\n\nDRAWING IMAGES: when the user wants a picture that does not exist yet (an illustration, a rough " +
  "logo, a cover image…), call " +
  'TOOL_CALL: generate_image({"prompt":"a detailed description in English"}) — the image appears in the ' +
  "chat by itself. The more specific the description (composition, colour, style), the closer the " +
  "result. This draws something new; for a picture that already exists on the web, use attach_image.";

const ASK_PROTOCOL =
  // "…if you need a decision first, ask with a widget rather than stalling." — the original's rule,
  // and `ask_question` is the widget it means.
  "\n\nASKING THE USER: when the user has to choose between directions, ask with the widget rather than " +
  "stalling: " +
  'TOOL_CALL: ask_question({"prompt":"The question?","options":[{"label":"Option A"},{"label":"Option B"}]}) ' +
  "— up to 6 options, add \"allowCustom\":true if they may type their own answer. " +
  "Do not ask and then answer yourself: end the turn after asking, the answer arrives on the next one.";

/**
 * Memory only helps if the agent writes to it, and models do not volunteer that.
 *
 * So the rule names the trigger (a durable fact about the person, not the current task) and
 * the anti-trigger — otherwise it either never remembers anything, or fills memory with
 * transcript.
 */
const MEMORY_PROTOCOL = boxConfigured()
  ? "\n\nMEMORY: when the user says something worth keeping for the long term — their name, their job, " +
    "preferences, how they want to be answered, facts about their projects — store it with " +
    'TOOL_CALL: knowledge_base({"title":"a short label","knowledge_to_store":"the content"}). ' +
    "Only store what will still be true in a later conversation; do NOT store passing details of the " +
    "current one. Whatever is already remembered is placed at the start of every turn, so there is no " +
    "need to read it back."
  : "";

const DRAFT_PROTOCOL =
  "\n\nDRAFTS: when composing mail or a message on the user's behalf, use " +
  'TOOL_CALL: email_draft({"to":["a@b.c"],"subject":"...","body":"..."}) or ' +
  'TOOL_CALL: slack_draft({"target":"#channel","body":"..."}). ' +
  "A draft card is for review only — the system CANNOT send yet, so never say it was sent; ask the " +
  "user what to do next.";

const PEER_PROTOCOL =
  "\n\nMESSAGING OTHER BOTS: the bots in the sidebar can message each other with " +
  'TOOL_CALL: message_agent({"to":"bot name","content":"..."}). ' +
  "Use it when the work belongs to another bot's speciality; tell the user who you messaged. " +
  "Their reply arrives on a later turn — do not wait for it within this one. " +
  // The original narrates step by step because SendMessage is its only voice. Ours streams the
  // final text, so without this a multi-step turn is silent until the end — screenshots pile up
  // with no words. Tell the model it can speak between steps.
  // "Work out loud. Do the work while keeping the user posted on meaningful beats; never vanish into a
  // long run of silent tool calls." — the original's sentence, quoted, and then the tool that does it.
  "\n\nWORK OUT LOUD: do the work while keeping the user posted on meaningful beats; never vanish into " +
  "a long run of silent tool calls. After each meaningful beat, " +
  'TOOL_CALL: send_to_user("one short line about what you just did and what comes next") — each one is ' +
  "its own message, shown to the user immediately. The final answer is still written normally. Do not " +
  "use it for single-step work, and do not repeat what you already said. " +
  'Brief several bots at once with a list: {"to":["Sales","Marketing"],"content":"..."}. ' +
  "\n\nCREATING / RENAMING BOTS: " +
  'TOOL_CALL: create_agent({"name":"Manager","brief":"the role and how to work together"}) — add "names":[…] to create several. ' +
  'TOOL_CALL: rename_agent({"from":"New Bot","to":"Manager"}) — drop "from" to rename yourself. ' +
  "Brief a bot on its role as soon as you create it; never leave an empty one.";

/**
 * Scaffolding from the first spike — `calc`, `echo` and friends. They stay callable so the
 * older e2e scripts keep working, but they are no longer advertised: the original has nothing
 * like them, and a model shown a `calc` tool reaches for it instead of doing arithmetic in an
 * ordinary sentence.
 */
const DEV_TOOLS = new Set(["echo", "time", "reverse", "upper", "count", "calc"]);

const toolProtocolBase = (): string =>
  // "DUY NHẤT một dòng" is why a multi-step turn went silent. The model obeyed it exactly: every
  // step was a bare TOOL_CALL, so the user watched screenshots pile up with no words — measured,
  // the bubble mid-turn contained the call itself and nothing else. The parser already accepts
  // prose in front (TOOL_CALL is anchored at the END) and the bubble now keeps whatever was
  // said, so this instruction was the only thing forbidding it.
  // The one-call-per-reply half of that instruction is also gone, and for the same reason: it was
  // ours, while the original's own subagent prompts say "Parallel tool calls are critical … call all
  // tools together in a single response". Now that runTurn reads every call and batches the read-only
  // ones, saying "exactly one line" would cap the fan-out at one again — from the other end of the
  // prompt, where it would be easy to miss. Both protocol strings have to agree.
  "\n\nTOOLS: when you need one of the tools below, say ONE short line about what you are about to do, " +
  "then END the reply with lines of the form TOOL_CALL: <name>(<args>), one call per line. " +
  // Verbatim from the original's buildBugbotSubagentPrompt; two more of its subagent prompts repeat it.
  "Parallel tool calls are critical. For maximum efficiency, invoke all relevant tools simultaneously " +
  "rather than sequentially. When you need to verify multiple things, call all tools together in a " +
  "single response. Write nothing after those lines. Tools: " +
  Object.keys(TOOLS).filter((n) => !DEV_TOOLS.has(n)).join(", ") +
  ". If no tool is needed, just answer. Once tool results come back, answer from them." +
  BROWSER_PROTOCOL + IMAGE_PROTOCOL + ASK_PROTOCOL + DRAFT_PROTOCOL + PEER_PROTOCOL + MEMORY_PROTOCOL + boxToolProtocol();

/** The tool protocol for one owner — the shared part plus that owner's MCP servers. */
/**
 * The plugin paragraph. Unconditional: the catalog is the same for everyone, and a plugin nobody has
 * installed yet is exactly the case this tool exists for.
 */
const PLUGIN_PROTOCOL =
  "\n\nPLUGINS: TOOL_CALL: setup_plugin() lists what can be installed and which credentials each " +
  'needs; TOOL_CALL: setup_plugin({"plugin":"lark","values":{"LARK_APP_ID":"…"}}) installs one. ' +
  "You may look a credential up in the browser when the person is signed in to that console, but " +
  "never invent one, and never print a credential back into the chat — pass it in `values` and say " +
  "which keys you saved. If a required value is missing, ask the person for it.";

/**
 * Replaying a task somebody demonstrated.
 *
 * A taught task arrives as an ordinary routine whose prompt is a numbered step list, so nothing
 * about the turn is special — except one thing that has to be said out loud: a step list is a record
 * of what a PERSON did, not a plan the model may improve. Selectors go stale, pages get redesigned,
 * and the tempting failure is to find something that looks close and click it. Stopping at the first
 * mismatch and naming the step is worth more than a run that half-worked somewhere unexpected.
 *
 * Only offered when the browser is configured: a step list is browser steps, and advertising a
 * protocol for tools this install cannot run just teaches the model to try them.
 */
const TEACH_PROTOCOL = isBrowserConfigured()
  ? "\n\nTAUGHT TASKS: a routine whose prompt is a numbered list of browser steps was RECORDED from " +
    "somebody demonstrating it. Replay it with the browser_* tools in the order given, and treat the " +
    "list as evidence rather than a suggestion: do not reorder it, do not add steps, and do not " +
    "substitute a control that merely looks similar. A step marked as having a weak selector needs a " +
    "look at the page first. If a step has no match, STOP and say which step and what you saw " +
    "instead — a taught task that stops halfway is recoverable; one that clicked the wrong thing is " +
    "not always."
  : "";

/**
 * Driving the box's desktop, for tasks that are not in a browser.
 *
 * The screen size is in here because the vendor puts it in theirs, and for the same reason: every
 * action is a COORDINATE, and a model that has not been told the screen is 1920x1080 is guessing at
 * the scale of everything it sees. The size is read from the box once and cached — it does not
 * change between turns.
 *
 * The discipline matters more than the actions. There is no "click the Save button" here, only
 * "click (x, y)", so the only way to be right is to look first and look again: screenshot, choose
 * coordinates from what is actually on screen, act, and check the result. A model that fires three
 * clicks from one screenshot is guessing at two of them.
 */
let desktopProtocolCache: string | null = null;

/**
 * Ask the box its screen size once, at startup rather than on the first turn.
 *
 * Building the prompt is synchronous, so a size fetched lazily arrives one turn too late — and the
 * turn it misses is the first one, where the model has the least idea what it is looking at. The
 * screen does not change, so one read at boot covers the whole run; if the box is down the
 * paragraph simply goes out without the numbers.
 */
if (desktopConfigured()) {
  void screenInfo().then((info) => {
    if (info) desktopProtocolCache = desktopParagraph(info);
  });
}

const desktopProtocol = (): string =>
  !desktopConfigured() ? "" : (desktopProtocolCache ?? desktopParagraph(null));

const desktopParagraph = (info: { width: number; height: number; dpi: number } | null): string =>
  "\n\nDESKTOP: the box has a full desktop, not only a browser. " +
  (info ? `Its screen is ${info.width}x${info.height} pixels at ${info.dpi} DPI. ` : "") +
  'Drive it with TOOL_CALL: computer_use({"action":"…"}) — screenshot, click, mouse_move, ' +
  "mouse_down, mouse_up, drag, scroll, type, key, cursor_position. Every action takes COORDINATES, " +
  "not a name: there is no way to say \"the Save button\", only where it is. So look before you " +
  "act and look after: take a screenshot, read the coordinates off it, do ONE action, and check " +
  "the screenshot that comes back. Firing several clicks from one screenshot is guessing at all " +
  "but the first. Prefer the browser_* tools whenever the task is inside a web page — they match " +
  "on selectors and do not go stale when a window moves.";

const toolProtocolFor = (owner: string): string =>
  toolProtocolBase() + PLUGIN_PROTOCOL + TEACH_PROTOCOL + desktopProtocol() + mcpProtocolFor(owner);

/** Every tool this install can run — chat-level tools plus the box tools from tools.ts. */
const isKnownTool = (name: string): boolean => name.toLowerCase() in TOOLS;

/**
 * Which tools may run side by side in one batch.
 *
 * Deliberately narrower than "auto-approved". Three kinds of tool are auto-approved yet must NOT
 * be parallelised:
 *
 *   browser_*        — stateful and ordered. navigate then screenshot describes one page; run them
 *                      together and the screenshot races the navigation.
 *   ask_question     — parks the turn waiting on a human, so it cannot be one of several results
 *   request_box_help   arriving together; the turn resumes when the person acts.
 *
 * What is left is the read-only box surface — read_file_v2, list_dir_v2, glob_file_search,
 * ripgrep_raw_search, web_search, web_fetch — which is exactly the set P5 wanted to fan out.
 */
const BARRIER_TOOLS = new Set(["ask_question", "request_box_help"]);
const isParallelSafe = (name: string): boolean => {
  const l = name.toLowerCase();
  if (BARRIER_TOOLS.has(l) || l.startsWith("browser_") || l === "computer_use") return false;
  return isAutoApproved(l);
};


/**
 * `computer_use` — điều khiển desktop của box, giai đoạn 1 của docs/plan/desktop-computer-use.md.
 *
 * Một tool thay vì mười, đúng như bản gốc: `ComputerUseParams` của họ là một danh sách action với
 * `oneof` 11 nhánh, không phải 11 RPC. Model chọn nhánh bằng trường `action`.
 *
 * Sau mỗi hành động có thay đổi màn hình, tool tự chụp lại và đính vào hội thoại. Đó không phải
 * tiện nghi: toàn bộ cách làm việc ở đây là chụp → chọn toạ độ → hành động → **nhìn lại**, và bắt
 * model tự nhớ gọi screenshot sau mỗi bước là chỗ nó sẽ quên.
 */
if (desktopConfigured()) TOOLS.computer_use = async (arg, ctx) => {
  const parsed = parseDesktopArg(arg);
  if ("error" in parsed) return parsed.error;

  const r = await desktopAct(parsed);
  if (!r.ok) return `computer_use ${parsed.action} lỗi: ${r.error ?? "không rõ"}`;

  // Into the transcript for the person AND in front of the model for the next turn. Only the first
  // half existed at first, and it made the whole feature a mime show: the bot clicked by
  // coordinate, attached a picture, and read back the words "đã chụp màn hình 1920x1080".
  const show = (dataUrl: string, alt: string) => { ctx.attach(dataUrl, "screen.jpg", alt); ctx.see(dataUrl); };

  if (parsed.action === "screenshot") {
    if (r.imageBase64) show(`data:image/jpeg;base64,${r.imageBase64}`, "màn hình máy tính của bot");
    return `đã chụp màn hình ${r.width}x${r.height}`;
  }
  if (parsed.action === "cursor_position") return `con trỏ đang ở (${r.x}, ${r.y})`;
  if (parsed.action === "screen_info") return `màn hình ${r.width}x${r.height}, ${r.dpi} DPI`;

  // Mọi action còn lại đều đổi màn hình. Chụp lại ngay thay vì trông chờ model tự nhớ: bước
  // "nhìn lại" chính là bước nó sẽ bỏ, và bỏ rồi thì hành động sau bấm mù.
  const after = await desktopAct({ action: "screenshot" });
  if (after.ok && after.imageBase64) show(`data:image/jpeg;base64,${after.imageBase64}`, `màn hình sau khi ${parsed.action}`);
  return `${parsed.action} xong`;
};

export { TOOLS, isKnownTool, isParallelSafe, toolProtocolFor };
