/**
 * Tool catalog the model may call. The turn loop lives in turn.ts.
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname } from "node:path";
import { config, loadPoolKey } from "../config.js";
import { BROWSER_TOOL_NAMES, isBrowserConfigured, isBrowserReachable, runBrowserTool, browserProbe, activateTabOf } from "../browser.js";
import { imageSize, readAttachmentImage } from "../attachments.js";
import { availableTools, toolProtocol as boxToolProtocol, isAutoApproved, unquote, toolArgs } from "../tools.js";
import { runOnUserComputer, connectedMachine, connectedMachines, findMachine, tepDauRaNen } from "../local-exec.js";
import { chepLenBox, chepVeMay } from "../chep-tep.js";
import { lamTrenTrinhDuyet } from "../local-browser.js";
import { soatHanhDong } from "./auto-review.js";
import { postAutoReview } from "../conversation/cards.js";
import type { Entry } from "../conversation/types.js";
import { boxConfigured, boxCall } from "../box-exec.js";
import { desktopAct, desktopConfigured, parseDesktopArg, screenInfo, claimDesktop } from "../desktop.js";
import { publish } from "../events.js";
import { desktopRecordConfigured, startDesktopRecording, stopDesktopTeach } from "../desktop-record.js";
import { nenDinhAnh, quenManHinh } from "./anh-man-hinh.js";
import { runSubagent, SUBAGENT_TYPES } from "../subagents.js";
import { startTask, awaitTasks } from "../tasks.js";
import { getMcpTools, callMcpTool, mcpServers } from "../mcp.js";
import { allInstructions } from "../mcp-prefs.js";
import { knowledgeBase } from "../memory.js";
import type { AgentRecord, EmailDraftMsg, SlackDraftMsg, SendArgs, ToolCtx } from "../conversation/types.js";
import { tail, agents, transcripts, todos, renderTodos, automationCreateRef, persist } from "../chat/state.js";


/**
 * Vài lượt gần nhất của hội thoại, cho lớp tự soát đọc.
 *
 * Lớp soát trả lời đúng một câu hỏi — "việc này có nằm trong thứ người dùng đã nhờ không" — nên nó
 * cần ĐÚNG thứ người dùng đã nhờ, không cần cả cuốn hội thoại. Sáu mục cuối là đủ để thấy yêu cầu
 * gần nhất mà không kéo theo một lượt model đắt.
 */
/**
 * Lấy tên miền gốc của một URL — `banhang.shopee.vn` → `shopee.vn`.
 *
 * So theo tên miền gốc chứ không theo host đầy đủ: người dùng nói "vào Shopee" rồi bot đi
 * `banhang.shopee.vn` là chuyện bình thường, còn bắt nó trùng khít từng subdomain thì mỗi bước
 * trong một trang là một lần hỏi.
 */
const tenMienGoc = (url: string): string => {
  try {
    const h = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    const p = h.split(".");
    return p.length <= 2 ? h : p.slice(-2).join(".");
  } catch { return ""; }
};

/**
 * Soát một lần điều hướng — ca thứ hai app gốc bắt, nguyên văn lý do nó viết:
 *
 *     surface "computer" · Open “https://cinai.app/en/pricing” in the box browser
 *     "The navigation targets https://cinai.app/en/pricing, but the user authorized inspection of
 *      https://cinai.tv/ where you are already logged in. These are different domains, and the
 *      user did not ask to visit cinai.app."
 *
 * ── Lọc TRƯỚC khi hỏi model ────────────────────────────────────────────────────────────────────
 *
 * Soát mọi lần điều hướng là một lượt model mỗi lần bấm — đắt, chậm, và gần như luôn cho qua. Nên
 * chỉ hỏi khi tên miền CHƯA từng xuất hiện trong hội thoại. Điều hướng trong cùng một trang, hay
 * tới trang người dùng vừa nhắc tên, đi thẳng và không tốn gì.
 *
 * Trả về `null` = cho đi. Trả về chuỗi = câu tool báo lại cho model, và thẻ xin duyệt đã được đặt.
 */
const soatDieuHuong = async (arg: string, agentId: string): Promise<string | null> => {
  let url = "";
  try { url = String(JSON.parse(arg)?.url ?? ""); } catch { url = unquote(arg); }
  const mien = tenMienGoc(url);
  if (!mien) return null;

  const boiCanh = boiCanhGanNhat(agentId);
  // Tên miền đã được nhắc tới thì không phải chuyện lạ — đi luôn, không tốn lượt model nào.
  if (!boiCanh || boiCanh.toLowerCase().includes(mien)) return null;

  const soat = await soatHanhDong({
    surface: "computer",
    tomTat: `Mở ${url} trong trình duyệt của bot`,
    boiCanh,
  });
  if (soat.cho) return null;

  postAutoReview(agentId, {
    surface: "computer",
    summary: `Mở ${url} trong trình duyệt của bot`,
    reason: soat.lyDo ?? "",
    ...(soat.luatDeXuat ? { proposedRule: soat.luatDeXuat } : {}),
  });
  return `Chưa mở ${url}: trang này nằm ngoài phạm vi người dùng đã nhờ, đã đặt thẻ xin duyệt trong khung chat. Lý do: ${soat.lyDo}`;
};

/**
 * Bối cảnh đưa cho lớp tự soát: 6 DÒNG CHỮ gần nhất, và LUÔN kèm tin người dùng gần nhất.
 *
 * Bản cũ lấy 6 ENTRY cuối rồi mới lọc ra chữ. Đo 06/09 trên VPS (Thợ dựng bot): một lượt dựng là tin người dùng →
 * ba câu tiến độ + ba tool-call → `create_routine`; sáu entry cuối toàn tool-call (lọc thành rỗng) và câu tiến độ,
 * tin đầu *"shop Z05R … chạy mỗi tối 21h"* rơi ra ngoài. Người soát đọc một bối cảnh KHÔNG có lời người dùng nào và
 * trả đúng như nó thấy — *"người dùng chưa hề đồng ý nhịp chạy"* — 3/4 routine ra thẻ duyệt dù đúng y yêu cầu.
 * Lớp soát chỉ trả lời được câu "người dùng đã nhờ gì" khi được đưa câu người dùng nói; đây là sửa ĐẦU VÀO của nó,
 * không nới luật. `boi-canh-soat.test.ts` khoá.
 */
export const boiCanhGanNhat = (agentId: string): string => {
  const dong = (e: Entry): string => {
    if (e.kind === "message") return `${e.role === "user" ? "NGƯỜI DÙNG" : "BOT"}: ${String(e.content ?? "").slice(0, 600)}`;
    if (e.kind === "send-message" && e.message.type === "text") return `BOT: ${String(e.message.content ?? "").slice(0, 400)}`;
    return "";
  };
  const ds = tail(agentId);
  const chu = ds.filter((e) => dong(e) !== "").slice(-6);
  const nguoiDung = [...ds].reverse().find((e) => e.kind === "message" && e.role === "user");
  const ketHop = nguoiDung && !chu.includes(nguoiDung) ? [nguoiDung, ...chu] : chu;
  return ketHop.map(dong).join("\n");
};
import { createAgent, createGroup, updateAgent, rosterChanged, ownerOf } from "../directory/index.js";
import { createTemplateForAgent, publishBotTemplate, shareUrlOf, getBotTemplateForSourceAgent, stageTemplateForAgent, shareCardOf } from "../bot-templates.js";
import { publishListing, CATEGORIES } from "../marketplace.js";
import { runWithOwner } from "../request-context.js";
import { DEFAULT_USER } from "../auth.js";
import { catalog } from "../plugin-catalog.js";
import { resetSkillsCache, warmSkills } from "../skills.js";
// Đoạn OBS chỉ có nội dung khi box THẬT SỰ có OBS — xem `box-obs.ts`.
import { obsProtocol } from "../box-obs.js";
// Dựng đội cho ra hồn: mỗi con một lịch, và tên có tiền tố miền — xem `doi-bot.ts`.
import { BUOC_DAT_LICH, LUAT_DAT_TEN } from "../doi-bot.js";
import { taoWorkflowTuBot, batDauQuayDemo, dungQuayDemo, dangQuayDemo, tinGiaoBaiHoc } from "../teach-demo.js";
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
    // 0.29 render thật nhánh nhiều-lựa-chọn (`if(e.multiSelect===!0)…`); thiếu trường này thì câu
    // hỏi "chọn những cái nào cần" luôn bị vẽ thành chọn-một.
    ...(typeof spec?.multiSelect === "boolean" ? { multiSelect: spec.multiSelect } : {}),
    ...(typeof spec?.dismissOnMoveOn === "boolean" ? { dismissOnMoveOn: spec.dismissOnMoveOn } : {}),
  });
  return id == null
    ? "ask_question cần prompt không rỗng và ít nhất một option"
    : `đã hỏi người dùng: ${prompt}`;
};

/**
 * Xin một giá trị bí mật — mật khẩu, mã OTP, khoá API.
 *
 * Khác `ask_question` ở chỗ quan trọng nhất: giá trị người dùng gõ KHÔNG quay về model và không
 * vào bản ghi hội thoại. Tool chỉ biết "đã gửi". Bản ghi sống mãi và model đọc lại được, nên một
 * khoá API nằm đó là nằm đó vĩnh viễn — cùng lý do bộ ghi dạy việc phải che giá trị ngay lúc ghi.
 */
TOOLS.request_secret = (arg, ctx) => {
  let spec: { label?: string; description?: string };
  try { spec = JSON.parse(arg); } catch { spec = { label: unquote(arg) }; }
  const id = ctx.askSecret({
    label: String(spec?.label ?? "").trim(),
    ...(spec?.description ? { description: String(spec.description) } : {}),
  });
  return id == null
    ? 'request_secret cần {"label":"<xin cái gì>"} — nhãn không được rỗng'
    : `đã xin: ${spec?.label}. Chờ người dùng gửi; giá trị sẽ KHÔNG hiện ra ở đây.`;
};

/**
 * Hỏi một biểu mẫu nhiều ô cùng lúc — đăng nhập, điền thông tin đơn.
 *
 * `id` của mỗi ô là khoá giá trị (`values[field.id]`), nên nó bắt buộc; ô thiếu id bị loại chứ
 * không giữ, vì người dùng gõ vào một ô không id thì cũng không gửi đi được.
 */
TOOLS.request_user_form = (arg, ctx) => {
  let spec: { title?: string; instruction?: string; fields?: unknown; liveHost?: string; domain?: string };
  try { spec = JSON.parse(arg); } catch { return 'request_user_form cần JSON, ví dụ {"title":"Đăng nhập","fields":[{"id":"user","label":"Tài khoản"}]}'; }
  const fields = Array.isArray(spec?.fields) ? (spec.fields as { id?: string; label?: string }[]) : [];
  const id = ctx.askForm({
    title: String(spec?.title ?? "").trim(),
    ...(spec?.instruction ? { instruction: String(spec.instruction) } : {}),
    fields: fields as never,
    ...(spec?.liveHost ? { liveHost: String(spec.liveHost) } : {}),
    ...(spec?.domain ? { domain: String(spec.domain) } : {}),
  });
  return id == null
    ? 'request_user_form cần "title" không rỗng và ít nhất một ô có đủ {"id","label"}'
    : `đã hỏi biểu mẫu "${spec?.title}" (${fields.length} ô). Chờ người dùng điền.`;
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
  /*
   * 0.29 giao SOP cho bot con qua DESCRIPTION, không phải qua một tin nhắn: roster app gốc cho
   * thấy 5 bot Shopee sinh trong 6 giây, mỗi con mang một bản SOP đầy đủ trong ô Description
   * (docs/extracted/chat-goc-0.29.md). Description giờ vào thẳng lời nhắc hệ thống (prompt.ts),
   * nên đây là chỗ nhân cách của bot con được ĐÓNG ĐINH — tin nhắn brief thì trôi theo transcript.
   */
  const specs: { name: string; description?: string }[] = (
    Array.isArray(spec?.agents)
      ? spec.agents.map((a: any) => ({
          name: String(a?.name ?? "").trim(),
          description: String(a?.description ?? a?.role ?? "").trim() || undefined,
        }))
      : (Array.isArray(spec?.names) ? spec.names : [spec?.name ?? spec?.title ?? unquote(arg)])
          .map((n: unknown) => ({ name: String(n ?? "").trim(), description: String(spec?.description ?? "").trim() || undefined }))
  ).filter((a: { name: string }) => a.name);
  if (specs.length === 0) return 'create_agent cần {"agents":[{"name":"Kho","description":"vai + luật"}]} hoặc {"name":"tên bot"}';
  // Lượt nền (cron, automation) không có request context — chủ của bot con là chủ của bot MẸ,
  // không phải danh tính mặc định của tiến trình.
  const owner = ownerOf(ctx.agentId) ?? DEFAULT_USER.authId;
  const made: AgentRecord[] = runWithOwner(owner, () => specs.map((a) => createAgent(a)));
  // Brief each new bot with its purpose, if one was given — an empty bot is not a colleague.
  const brief = String(spec?.brief ?? spec?.instructions ?? "").trim();
  if (brief) for (const m of made) turnHooks.sendPrompt({ agentId: m.id, content: brief, fromAgent: { id: ctx.agentId, name: agents.get(ctx.agentId)?.name ?? "bot" } });
  return `đã tạo ${made.map((m) => m.name).join(", ")}`;
};

/**
 * `create_diagram` — sơ đồ, vẽ bằng đúng đường 0.29 vẽ.
 *
 * Trích từ bundle: client KHÔNG có message type riêng cho sơ đồ (`"diagram"` = 0 hit trong danh
 * sách type của renderer), nhưng có hẳn `mermaid.core-*.js` và các lớp CSS `mermaid-figure`,
 * `mermaid-error`, `mermaid-expand`, `mermaid-diagram.png`. Tức sơ đồ chỉ là **markdown có khối
 * ```mermaid** trong một bong bóng text bình thường.
 *
 * Nên tool này không dựng entry kiểu mới; nó phát đúng khối code đó. Lợi thêm: khi backend này
 * phục vụ FE khác (grokbot-web), khối mermaid vẫn là markdown hợp lệ chứ không phải một shape lạ.
 *
 * Kiểm tối thiểu — chỉ chặn thứ chắc chắn vẽ ra `mermaid-error`: rỗng, hoặc không mở đầu bằng một
 * từ khoá sơ đồ nào. Không cố phân tích cú pháp mermaid ở đây: thư viện của client mới là trọng
 * tài, và một bộ kiểm nửa vời sẽ chặn nhầm sơ đồ hợp lệ.
 */
const MERMAID_KINDS = [
  "graph", "flowchart", "sequenceDiagram", "classDiagram", "stateDiagram", "stateDiagram-v2",
  "erDiagram", "journey", "gantt", "pie", "mindmap", "timeline", "gitGraph", "quadrantChart",
  "requirementDiagram", "sankey-beta", "xychart-beta", "block-beta", "packet-beta", "architecture-beta",
];

TOOLS.create_diagram = (arg, ctx) => {
  let spec: any;
  try { spec = JSON.parse(arg); } catch { spec = { code: unquote(arg) }; }
  let code = String(spec?.code ?? spec?.mermaid ?? spec?.diagram ?? spec?.content ?? unquote(arg) ?? "").trim();
  // Model hay gói sẵn trong ```mermaid — gỡ ra rồi bọc lại một lần, tránh khối lồng khối.
  code = code.replace(/^```[a-zA-Z-]*\s*\n?/, "").replace(/\n?```$/, "").trim();
  if (!code) return 'create_diagram cần {"code":"flowchart TD\\n  A[Bắt đầu] --> B[Xong]"} (cú pháp mermaid)';
  const head = code.split(/\s|\n/)[0] ?? "";
  if (!MERMAID_KINDS.some((k) => head === k || head.startsWith(k))) {
    return `create_diagram: dòng đầu phải là loại sơ đồ mermaid (${MERMAID_KINDS.slice(0, 6).join(", ")}…), đang thấy "${head.slice(0, 30)}"`;
  }
  const title = String(spec?.title ?? "").trim();
  ctx.note(`${title ? `**${title}**\n\n` : ""}\`\`\`mermaid\n${code}\n\`\`\``);
  return `đã vẽ sơ đồ (${head})`;
};

/**
 * Bot tự dựng phòng chung — nửa còn lại của quy trình 0.29: tạo dàn bot xong thì mở nhóm cho cả
 * dàn (Shopee Ops sinh 06:37:38, đúng 7 giây sau con bot cuối). Thành viên nhận theo TÊN vì đó là
 * thứ model biết; tên chỉ được so trong dàn bot của CHÍNH CHỦ — id người khác không có đường vào.
 */
/**
 * `share_bot_template` — đóng gói một bot (hoặc cả ĐỘI) thành bản CHỜ XÁC NHẬN, đúng luồng client 0.43.
 *
 * Đường TẠO mẫu của hãng không có trong client (không có `createBotTemplate`, và `publishBotTemplate`
 * chỉ mang `{shareId, version}`), nên đây là đường của TA — và cố ý là một tool chứ không phải một lần
 * đọc: bản đầu tạo mẫu ngay khi pane đọc, và app thật hiện "Delete Template" trên mọi bot dù chưa ai
 * chia sẻ gì.
 *
 * Luồng đo từ cache client app gốc 05/09 (bot "dr eggbot", bấm "Share as template"): client tự gửi
 * `CAU_CHIA_SE_MAU`; bot đăng 4–5 câu tiến độ (memories → skills → routines → plugins → "giữ N…"), rồi
 * bản ghi mọc thẻ `bot-template-share` `{published:false, version:1, visibility:"public"}` với nút
 * **Publish**; câu chốt: "đã stage template public … check card rồi confirm để publish". Người dùng bấm
 * Publish → client gọi `publishBotTemplate{shareId,version}` → thẻ đổi sang Published · Copy link, menu
 * header đổi sang View template details / Update template / Delete Template (đọc `published` từ
 * `getBotTemplateForSourceAgent`). "Update template" gửi lại CÙNG câu → bản chờ = bản active + 1.
 *
 * Bản trước của tool này xuất bản NGAY và để tầm nhìn `team` — tức bỏ qua bước duyệt của người dùng
 * và không có thẻ nào trong bản ghi. Các câu tiến độ ở đây do TOOL đăng (`ctx.note`) từ dữ liệu thật
 * của snapshot — rẻ, không tốn lượt model, không bịa số. Thân thẻ (`description`) là của MODEL: kiểu
 * Marketplace, 2–4 câu (xem `huongDanChiaSeMau` trong turn.ts).
 */
TOOLS.share_bot_template = async (arg, ctx) => {
  let spec: any;
  try { spec = JSON.parse(arg); } catch { spec = { description: unquote(arg) }; }
  const owner = ownerOf(ctx.agentId) ?? DEFAULT_USER.authId;
  const wanted = String(spec?.agent ?? spec?.name ?? spec?.agentId ?? "").trim();
  const mine = [...agents.values()].filter((a) => ownerOf(a.id) === owner);
  const target = wanted
    ? mine.find((a) => a.id === wanted) ?? mine.find((a) => a.name.toLowerCase() === wanted.toLowerCase())
    : agents.get(ctx.agentId);
  if (!target) return `(không thấy bot "${wanted}")`;
  const description = String(spec?.description ?? spec?.body ?? "").trim();
  const visibility = spec?.visibility === "team" ? "team" : "public";
  const truoc = runWithOwner(owner, () => getBotTemplateForSourceAgent(target.id));
  const tpl = await runWithOwner(owner, () => stageTemplateForAgent(target.id, { description, visibility }));
  if (!tpl) return "(không tạo được mẫu cho bot này)";
  const r = (tpl.staged ?? tpl).snapshot.recipe;
  const ten = (xs: { name?: string; slug?: string }[]) => xs.map((x) => x.name ?? x.slug).filter(Boolean).join(", ");
  // Tiến độ — đúng nhịp app gốc, chỉ nói về thứ có thật; bot trống thì một câu.
  const dong = [
    r.memory.length ? `memories: ${r.memory.length} mục.` : "",
    r.skills.length ? `skills: ${ten(r.skills)}.` : "",
    r.routines.length ? `routines: ${ten(r.routines)}.` : "",
    r.plugins.length ? `plugins: ${ten(r.plugins)}.` : "",
  ].filter(Boolean);
  for (const d of dong) ctx.note(d);
  ctx.note(dong.length
    ? `giữ ${r.memory.length} memories, ${r.skills.length} skills, ${r.routines.length} routines, ${r.plugins.length} plugins.`
    : "mẫu chỉ chở hồ sơ (tên + mô tả) — bot này chưa có memories, skills hay routines.");
  ctx.draft({ type: "bot-template-share", ...shareCardOf(tpl) });
  const v = tpl.staged?.version ?? tpl.version;
  const capNhat = truoc?.published && truoc.activeVersion != null
    ? ` (cập nhật mẫu đã xuất bản: bản chờ ${v}, bản đang phát vẫn là ${truoc.activeVersion} cho tới khi họ bấm Publish)` : "";
  const doi = tpl.snapshot.members.length ? `, ${tpl.snapshot.members.length} thành viên` : "";
  return `đã đóng gói "${target.name}" thành bản chờ ${v} của mẫu ${tpl.shareId}${capNhat}: `
    + `${r.memory.length} memories, ${r.skills.length} skills, ${r.routines.length} routines, ${r.plugins.length} plugins${doi}. `
    + `Thẻ mẫu (tầm nhìn ${visibility}) đã hiện trong hội thoại với nút Publish — người dùng bấm thì mẫu mới phát ra ngoài qua `
    + `${shareUrlOf(tpl.shareId)}. Giờ trả lời MỘT câu ngắn: mời họ xem thẻ và bấm Publish, muốn sửa gì thì nói để bạn đóng gói lại.`;
};

/**
 * `publish_bot_listing` — đưa một bot lên Marketplace cộng đồng (tab Marketplace → Bots của client 0.43).
 *
 * Gộp ba bước người dùng không cần biết: chưa có mẫu thì đóng gói (như `share_bot_template`), chưa
 * xuất bản thì xuất bản, rồi tạo listing với nhóm đã chọn — tầm nhìn mẫu tự sang `public`. Nhóm
 * phải là một trong 9 khoá client biết; câu trả lời nói rõ danh sách khi sai, để model tự sửa.
 */
TOOLS.publish_bot_listing = async (arg, ctx) => {
  let spec: any;
  try { spec = JSON.parse(arg); } catch { spec = { agent: unquote(arg) }; }
  const owner = ownerOf(ctx.agentId) ?? DEFAULT_USER.authId;
  const wanted = String(spec?.agent ?? spec?.name ?? spec?.agentId ?? "").trim();
  const mine = [...agents.values()].filter((a) => ownerOf(a.id) === owner);
  const target = wanted
    ? mine.find((a) => a.id === wanted) ?? mine.find((a) => a.name.toLowerCase() === wanted.toLowerCase())
    : agents.get(ctx.agentId);
  if (!target) return `(không thấy bot "${wanted}")`;
  const category = String(spec?.category ?? "").trim().toLowerCase();
  if (!(CATEGORIES as readonly string[]).includes(category)) return `publish_bot_listing cần "category" là một trong: ${CATEGORIES.join(", ")}`;
  // Thân thẻ: model đưa "description" (2–4 câu kiểu Marketplace) thì đóng gói bản chờ với đúng câu ấy — không thì thẻ
  // mang mô tả bot = cả SOP (đo 06/09 với danh mục mẫu). Có description ⇒ luôn stage (kể cả mẫu đã phát: bản chờ mới).
  const description = String(spec?.description ?? spec?.body ?? "").trim();
  const tpl = await runWithOwner(owner, async () => description
    ? stageTemplateForAgent(target.id, { description, visibility: "public" })
    : (getBotTemplateForSourceAgent(target.id) ?? await createTemplateForAgent(target.id)));
  if (!tpl) return "(không tạo được mẫu cho bot này)";
  // Bản chờ (do share_bot_template hoặc dòng trên) thì phát bản chờ; đã phát và không chờ gì thì giữ.
  const daPhat = tpl.published && tpl.activeVersion != null && tpl.staged == null;
  const pub = daPhat ? tpl : await runWithOwner(owner, () => publishBotTemplate(tpl.shareId, tpl.staged?.version ?? tpl.version));
  if (!pub) return "(không xuất bản được mẫu)";
  try {
    const l = runWithOwner(owner, () => publishListing({ shareId: pub.shareId, category, categories: spec?.categories }, owner, DEFAULT_USER.authId));
    return `đã đăng "${target.name}" lên Marketplace cộng đồng, nhóm ${l.category} (slug ${l.slug}). Người khác import qua tab Marketplace → Bots hoặc link ${shareUrlOf(pub.shareId)}.`;
  } catch (e) {
    return `(không đăng được: ${e instanceof Error ? e.message : String(e)})`;
  }
};

TOOLS.create_group = (arg, ctx) => {
  let spec: any;
  try { spec = JSON.parse(arg); } catch { spec = { name: unquote(arg) }; }
  const name = String(spec?.name ?? spec?.title ?? "").trim();
  if (!name) return 'create_group cần {"name":"tên phòng","members":["Kho","Ads"]} (members là tên hoặc id bot)';
  const owner = ownerOf(ctx.agentId) ?? DEFAULT_USER.authId;
  const wanted = (Array.isArray(spec?.members) ? spec.members : Array.isArray(spec?.memberNames) ? spec.memberNames : [])
    .map((m: unknown) => String(m ?? "").trim()).filter(Boolean);
  const mine = [...agents.values()].filter((a) => ownerOf(a.id) === owner && !a.isGroup);
  const missing: string[] = [];
  const memberIds = wanted.map((w: string) => {
    const hit = mine.find((a) => a.id === w) ?? mine.find((a) => a.name.toLowerCase() === w.toLowerCase());
    if (!hit) missing.push(w);
    return hit?.id;
  }).filter((id: string | undefined): id is string => Boolean(id));
  const g = runWithOwner(owner, () => createGroup({ name, memberAgentIds: memberIds }));
  const note = missing.length ? ` (không thấy: ${missing.join(", ")})` : "";
  return `đã mở phòng ${g.name} với ${g.memberIds?.length ?? 0} thành viên${note}`;
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
TOOLS.create_routine = async (arg, ctx) => {
  let spec: any;
  try { spec = JSON.parse(arg); } catch { spec = { prompt: unquote(arg) }; }
  const prompt = String(spec?.prompt ?? spec?.instruction ?? spec?.task ?? "").trim();
  if (!prompt) return 'create_routine cần {"name":"tên","prompt":"việc cần làm","trigger":"0 9 * * *"}';
  const name = String(spec?.name ?? spec?.title ?? "").trim() || "Routine";
  // The trigger is a cron string, or a platform word for an event-driven routine. Passing the word
  // through unchanged is what lets `listenerPlatform` recognise it and warn that nothing can fire it.
  const trigger = String(spec?.trigger ?? spec?.schedule ?? spec?.when ?? "0 9 * * *").trim();
  if (!automationCreateRef) return "(routine chưa sẵn sàng)";
  /*
   * Routine gắn cho AI — mặc định là chính mình, nhưng phải chỉ được sang bot khác.
   *
   * Bản đầu cứng `ctx.agentId`. Đo 28/08: bot mẹ dựng đội ba con rồi tạo routine cho từng con —
   * "Kho - Rà soát đơn và tồn kho", "CSKH - Rà soát chat…" — và **cả hai rơi vào bot mẹ**, đúng cái
   * bot không bao giờ chạy chúng. Tên routine nói rõ nó dành cho con nào, nhưng mã không nghe.
   *
   * App gốc gắn routine vào từng con (ảnh chụp: Shopee Kho có "Hàng chờ lấy", Kế toán có "Nhật ký
   * P và L tuần" — mỗi bảng Routines nằm trong panel của chính bot đó).
   *
   * Chỉ nhận bot CÙNG CHỦ: đặt lịch chạy trên bot của người khác là chiếm quyền dùng hạn mức của
   * họ, không phải một tiện ích nhỏ.
   */
  const chiDinh = String(spec?.agent ?? spec?.for ?? spec?.bot ?? spec?.agentName ?? "").trim();
  let target = ctx.agentId;
  if (chiDinh) {
    const chu = ownerOf(ctx.agentId) ?? DEFAULT_USER.authId;
    const wanted = chiDinh.toLowerCase().replace(/^@/, "");
    const mine = [...agents.values()].filter((a) => (ownerOf(a.id) ?? DEFAULT_USER.authId) === chu);
    const hit = mine.find((a) => a.id === chiDinh)
      ?? mine.find((a) => a.name.toLowerCase() === wanted)
      ?? mine.find((a) => a.name.toLowerCase().includes(wanted));
    if (!hit) return `(không thấy bot "${chiDinh}"; có: ${mine.map((a) => a.name).slice(0, 12).join(", ")})`;
    target = hit.id;
  }
  /*
   * Soát trước khi lưu — `auto-review-approval` của app gốc, và đây đúng chỗ nó có giá trị nhất.
   *
   * Routine chạy ĐỊNH KỲ, không ai ngồi xem. Nó là chỗ một quyết định sai sống lâu nhất: lệnh chạm
   * máy người dùng có thẻ xin quyền từng lần, còn routine thì được duyệt một lần rồi tự chạy mãi.
   *
   * Ca thật của app gốc, nguyên văn `reason` nó viết ra:
   *
   *     "…creates a standing automation that will persistently extract and send admin API data and
   *      JWT credentials to an external person on a recurring schedule without explicit user
   *      authorization in this conversation."
   *
   * Không dùng luật cứng được: "chặn routine gửi dữ liệu ra ngoài" nghe hợp lý cho tới lúc người
   * dùng thật sự muốn gửi báo cáo cho kế toán. Ranh giới nằm ở NGƯỜI DÙNG ĐÃ NHỜ GÌ, và chỉ đoạn
   * hội thoại mới trả lời được.
   *
   * Soát hỏng thì cho qua — xem `auto-review.ts`. Một lớp phụ trợ tự nó chặn được việc chính là
   * lớp sẽ bị gỡ vào lần đầu nó sai.
   */
  const soat = await soatHanhDong({
    surface: "automation_write",
    tomTat: `Lưu routine "${name}" chạy theo lịch ${trigger}: "${prompt}"`,
    boiCanh: boiCanhGanNhat(ctx.agentId),
  });
  if (!soat.cho) {
    const id = postAutoReview(ctx.agentId, {
      surface: "automation_write",
      summary: `Lưu routine "${name}" chạy theo lịch ${trigger}`,
      reason: soat.lyDo ?? "",
      ...(soat.luatDeXuat ? { proposedRule: soat.luatDeXuat } : {}),
    });
    return id
      ? `Routine này nằm ngoài phạm vi bạn đã nhờ, nên tôi chưa lưu — đã đặt thẻ xin duyệt trong khung chat. Lý do: ${soat.lyDo}`
      : `Routine này nằm ngoài phạm vi bạn đã nhờ nên tôi chưa lưu. Lý do: ${soat.lyDo}`;
  }

  const made = automationCreateRef(target, { name, prompt, trigger });
  const cho = target === ctx.agentId ? "" : ` cho ${agents.get(target)?.name ?? target}`;
  return made ? `đã tạo routine "${name}"${cho} — ${made}` : "(không tạo được routine)";
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

  /*
   * Video thì kèm kích thước — app gốc làm vậy, và nó có lý do nhìn thấy được.
   *
   * Trích transcript thật của nó:
   *
   *     {"type":"attachment","url":"file:///…/<sha256>.mp4",
   *      "file_name":"2026-08-30_20-07-57.mp4","width":1280,"height":800}
   *
   * Không có `width`/`height`, renderer phải chờ tải đủ metadata mới biết khung hình bao nhiêu, nên
   * bong bóng chat nhảy một nhịp giữa lúc người ta đang đọc. Ảnh không cần vì `stageImage` đọc được
   * kích thước từ chính bytes; video thì phải hỏi ffprobe.
   *
   * Một lần gọi thêm, chỉ cho video, và hỏng thì bỏ qua: thiếu kích thước vẫn gửi được tệp, còn
   * chặn cả việc gửi vì không đo được khung hình là đổi một phiền nhỏ lấy một hỏng lớn.
   */
  let co: { width?: number; height?: number } | undefined;
  if (/\.(mp4|webm|mov|mkv|gif)$/i.test(fileName)) {
    try {
      const q = `'${abs.replace(/'/g, `'\\''`)}'`;
      const r = await boxCall<{ stdout: string }>("exec", {
        command: `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of default=noprint_wrappers=1 ${q}`,
      });
      const w = Number((r.stdout.match(/width=(\d+)/) ?? [])[1]);
      const h = Number((r.stdout.match(/height=(\d+)/) ?? [])[1]);
      if (w > 0 && h > 0) co = { width: w, height: h };
    } catch { /* không đo được thì vẫn gửi tệp */ }
  }

  postFileAttachment(ctx.agentId, abs, fileName, alt, co);
  const kb = Math.round(size / 1024);
  return `Đã đính kèm ${fileName} (${kb} KB${co ? `, ${co.width}×${co.height}` : ""}).`;
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
export async function isInternalHost(hostname: string): Promise<boolean> {
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
/**
 * 3L — bot XEM video, đúng cơ chế app gốc đã lộ trong B2: rút khung hình + đo âm lượng + nhìn
 * khung bằng mắt model. Transcript Test Clone: "~20 giây toàn màn đen", "track AAC có mà gần như
 * câm (-91 dB)" — rồi tự sửa scene và quay lại. Không có phép màu nào khác.
 *
 * Một ảnh duy nhất: các khung ghép thành CONTACT SHEET (tile) vì pool chỉ chở một ảnh mỗi lượt —
 * xem ctx.see. Ảnh vừa vào transcript cho người xem, vừa đặt trước mắt model ở lượt kế.
 */
/*
 * Hai tool chạm vào MÁY THẬT của người dùng, qua local-exec.
 *
 * Khác mọi tool khác ở một điểm phải nói to: `run_terminal_command_v2` chạy trên BOX — một máy
 * Linux dùng riêng cho bot, vứt đi được. Hai tool này chạy trên máy Windows/mac người dùng đang
 * ngồi, nơi có OBS, có Chrome đã đăng nhập, có tệp thật.
 *
 * Vì thế chúng nằm trong `CHAM_MAY_NGUOI_DUNG` (turn.ts): LUÔN dựng thẻ xin quyền, kể cả khi cài
 * đặt `localToolPermission` đang là "always". Đường tắt ấy được bấm trong bối cảnh lệnh chạy trên
 * box; suy ra nó cũng đồng ý cho máy thật là suy diễn thay người dùng.
 *
 * Hai chốt an toàn nữa không phải của ta mà của chính daemon hãng, và đã đo được là đang chạy:
 *   - mọi đường dẫn bị nhốt trong `localRoot` (`C:\Users\<user>`), ra ngoài thì `SandLocalExecPathError`
 *   - lệnh chạy trong một script PowerShell có hạn giờ, hết giờ thì huỷ và báo `SHELL_ABORT_REASON_TIMEOUT`
 */
/** Cắt kết quả trả cho model. Một `dir` trong thư mục lớn có thể ra hàng trăm KB. */
const catBot = (s: string, max = 8000): string =>
  s.length <= max ? s : `${s.slice(0, max)}
… (cắt bớt, còn ${s.length - max} ký tự)`;

/**
 * Dàn máy đang nối. Không cần thẻ quyền: nó chỉ đọc danh sách bên TA, không chạm vào máy nào.
 *
 * Có tool này thì model mới chỉ định máy được. Không có nó, "chạy trên Admin-PC" là model đoán một
 * cái tên và ta trả về "không thấy máy đó" — đúng nhưng vô ích.
 */
TOOLS.local_machines = async () => {
  const ds = connectedMachines();
  if (!ds.length) {
    return "Hiện không máy nào của bạn đang nối. Mở app Grok Bot trên máy đó và đăng nhập là nó tự nối.";
  }
  return ds.map((m) => {
    const giay = Math.round((Date.now() - m.seenAtMs) / 1000);
    return `${m.label} (id ${m.computerId.slice(0, 8)}…) · thư mục gốc ${m.localRoot ?? "?"} · thấy ${giay}s trước`;
  }).join("\n");
};

/**
 * Lái trình duyệt TRÊN MÁY NGƯỜI DÙNG — đọc trang, bấm, gõ, chụp.
 *
 * Vì sao cần, khi đã có `local_shell`: đo 31/08, bảo bot "mở Chrome vào 24h rồi đọc tiêu đề bài
 * đầu", nó MỞ được trang bằng một lệnh nhưng không nhìn vào được cửa sổ ấy — nó tự tải trang về
 * đọc rồi thành thật khai ra. Mở một cửa sổ mà không nhìn được vào trong thì mới là nửa việc.
 *
 * Cửa sổ này là cửa sổ RIÊNG của bot (hồ sơ Chrome riêng, cổng 9333), không phải cửa sổ người dùng
 * đang mở. Nên nó không có sẵn phiên đăng nhập nào — và cũng vì thế bot không đụng nhầm vào phiên
 * ngân hàng hay Zalo đang mở. Muốn bot làm việc trong một tài khoản thì người dùng đăng nhập một
 * lần trong chính cửa sổ ấy.
 */
TOOLS.local_browser = async (arg, ctx) => {
  let spec: Record<string, unknown>;
  try { spec = JSON.parse(arg) as Record<string, unknown>; } catch { spec = { viec: unquote(arg) }; }
  const viec = String(spec?.viec ?? spec?.action ?? "").trim();
  const hopLe = ["mo", "doc", "bam", "go", "anh"];
  if (!hopLe.includes(viec)) {
    return 'local_browser cần {"viec":"mo|doc|bam|go|anh", …}. '
      + 'mo cần "url"; bam cần "chu" (chữ trên nút/liên kết); go cần "o" (tên ô) và "chu", thêm "enter":true để gửi luôn.';
  }

  const chiDinh = String(spec?.machine ?? "").trim();
  const may = chiDinh ? findMachine(chiDinh) : connectedMachine();
  if (chiDinh && !may) {
    const co = connectedMachines().map((m) => m.label);
    return `Không thấy máy "${chiDinh}" đang nối` + (co.length ? ` — đang có: ${co.join(", ")}` : "");
  }
  if (!may) return "Máy tính của bạn đang không kết nối. Mở app Grok Bot trên máy đó rồi thử lại.";

  const r = await lamTrenTrinhDuyet(spec as never, {
    machineId: may.computerId,
    // Lần đầu trong phiên phải chở script sang rồi bật Chrome — mất tới nửa phút.
    timeoutMs: Number(spec?.timeoutMs) || 150_000,
  });
  if (!r.ok) return `[${may.label}] trình duyệt: ${r.loi}`;

  if (viec === "anh") {
    if (!r.anhBase64) return `[${may.label}] chụp được nhưng không có dữ liệu ảnh`;
    const dataUrl = `data:image/jpeg;base64,${r.anhBase64}`;
    ctx.attach(dataUrl, "man-hinh-may-ban.jpg", `màn hình trình duyệt trên ${may.label}`);
    ctx.see(dataUrl);
    return `[${may.label}] đã chụp trang ${r.url ?? "?"} và đặt trước mắt bạn — hãy nhìn rồi nhận xét nội dung thật, đừng đoán.`;
  }
  if (viec === "doc") {
    const chu = String(r.chu ?? "");
    const them = r.doDaiThat && r.doDaiThat > chu.length ? `
(còn ${r.doDaiThat - chu.length} ký tự nữa, gọi lại với "gioiHan" lớn hơn nếu cần)` : "";
    return catBot(`[${may.label}] ${r.url ?? ""}
${chu}${them}`);
  }
  if (viec === "mo") return `[${may.label}] đã mở ${r.url} — tiêu đề: ${r.tieuDe ?? "(không đọc được)"}`;
  if (viec === "bam") return `[${may.label}] ${r.ketQua ?? "đã bấm"} — giờ đang ở ${r.url ?? "?"}`;
  return `[${may.label}] đã gõ xong — đang ở ${r.url ?? "?"}`;
};

TOOLS.local_shell = async (arg, _ctx) => {
  let spec: { command?: string; cwd?: string; timeoutMs?: number };
  try { spec = JSON.parse(arg); } catch { spec = { command: unquote(arg) }; }
  const command = String(spec?.command ?? "").trim();
  if (!command) return 'local_shell cần {"command":"<lệnh>"}';
  // Chỉ định máy bằng TÊN hoặc id. Không chỉ định thì lấy máy vừa thấy gần nhất.
  const chiDinh = String((spec as { machine?: unknown })?.machine ?? "").trim();
  const may = chiDinh ? findMachine(chiDinh) : connectedMachine();
  if (chiDinh && !may) {
    const co = connectedMachines().map((m) => m.label);
    return `Không thấy máy "${chiDinh}" đang nối`
      + (co.length ? ` — đang có: ${co.join(", ")}` : " — hiện không máy nào nối");
  }
  if (!may) {
    return "Máy tính của bạn đang không kết nối. Mở app Grok Bot trên máy đó rồi thử lại"
      + " (Settings → Computer phải thấy tên máy). Trong lúc chờ, mình dùng máy của mình được.";
  }
  const r = await runOnUserComputer(
    { kind: "shell", command, ...(spec?.cwd ? { cwd: String(spec.cwd) } : {}) },
    { machineId: may.computerId, timeoutMs: Number(spec?.timeoutMs) || 30_000 },
  );
  if (!r.ok) return `Không chạy được trên ${may.label}: ${r.error}`;
  const d = (r.data ?? {}) as { stdout?: string; stderr?: string; exitCode?: number; aborted?: string };
  const phan = [
    `[${may.label}] exit=${d.exitCode ?? "?"}${d.aborted ? ` (${d.aborted})` : ""}`,
    d.stdout?.trim() ? `stdout:\n${d.stdout.trim()}` : "",
    d.stderr?.trim() ? `stderr:\n${d.stderr.trim()}` : "",
  ].filter(Boolean);
  return catBot(phan.join("\n"));
};

/**
 * Máy nào — theo TÊN hoặc id trong spec; không chỉ định thì máy vừa thấy gần nhất.
 *
 * Trả câu từ chối thay vì máy khi không có: chỉ định một máy không nối mà lặng lẽ rơi sang máy khác là
 * chạy nhầm máy — thứ không phát hiện được từ kết quả (cùng luật với `runOnUserComputer`).
 */
const chonMay = (spec: { machine?: unknown } | null | undefined):
  { may: NonNullable<ReturnType<typeof connectedMachine>> } | { loi: string } => {
  const chiDinh = String(spec?.machine ?? "").trim();
  const may = chiDinh ? findMachine(chiDinh) : connectedMachine();
  if (chiDinh && !may) {
    const co = connectedMachines().map((m) => m.label);
    return { loi: `Không thấy máy "${chiDinh}" đang nối` + (co.length ? ` — đang có: ${co.join(", ")}` : " — hiện không máy nào nối") };
  }
  if (!may) return { loi: "Máy tính của bạn đang không kết nối. Mở app Grok Bot trên máy đó rồi thử lại." };
  return { may };
};

/** Đường dẫn Windows đưa vào ví dụ JSON cho model: gạch xuôi, vì `C:\Users` chép vào JSON là escape hỏng. */
const duongJson = (p: string): string => p.replace(/\\/g, "/");

/**
 * GHI một tệp lên máy người dùng — `write-file`, việc thứ tư trong bảy của daemon (bảng theo dõi §5 mục 11).
 *
 * Đi bằng khung `upload` riêng của daemon, không qua `serverMessage`. Ghi đè toàn bộ; daemon tạo thư mục
 * cha; đường dẫn phải nằm dưới thư mục gốc của máy (`localRoot`, thường `C:\Users\<tên>`) — ngoài đó
 * daemon từ chối với câu rõ. Nội dung là CHỮ (utf-8): tệp nhị phân đi đường `local_shell` (curl/Invoke-WebRequest).
 */
TOOLS.local_write = async (arg, _ctx) => {
  let spec: { path?: string; content?: string; machine?: unknown };
  try { spec = JSON.parse(arg); } catch { return 'local_write cần {"path":"C:/Users/<tên>/...","content":"<nội dung>"}'; }
  const path = String(spec?.path ?? "").trim();
  if (!path) return 'local_write cần {"path":"<đường dẫn trên máy bạn>","content":"<nội dung>"}';
  if (typeof spec?.content !== "string") return 'local_write cần "content" là chuỗi (rỗng cũng được, để tạo tệp trống)';
  const m = chonMay(spec);
  if ("loi" in m) return m.loi;
  const bytes = Buffer.from(spec.content, "utf8");
  const r = await runOnUserComputer(
    { kind: "write", path, bytesBase64: bytes.toString("base64") },
    { machineId: m.may.computerId, timeoutMs: 30_000 },
  );
  if (!r.ok) return `Không ghi được trên ${m.may.label}: ${r.error}`;
  return `[${m.may.label}] đã ghi ${bytes.length} byte vào ${path}`;
};

/**
 * Chạy lệnh NỀN trên máy người dùng — sống qua lượt này (`backgroundShellSpawnArgs`, `outlivesScope`).
 *
 * `local_shell` treo lượt tới trần 120 s của daemon; việc dài hơn (server dev, quay màn hình, tải lớn,
 * cài đặt) là hết đường — đúng khoảng cách năng lực với app gốc mà tool-doi-chieu.md §2b chỉ ra. Daemon
 * ghi đầu ra vào `<terminals>/<shellId>.txt` (đầu tệp có `status: running|…`, cuối có `exit_code`), đọc
 * lại bằng `local_read`. KHÔNG gõ được vào stdin: daemon 0.29 lẫn 0.43 không đăng ký handler
 * `writeShellStdinArgs` cho máy người dùng (đo 06/09: *"No handler found for server message of type
 * writeShellStdinArgs"*) — nên lệnh nền phải tự chạy không hỏi (`-y`, `-NonInteractive`, `--yes`).
 */
TOOLS.local_shell_bg = async (arg, _ctx) => {
  let spec: { command?: string; cwd?: string; description?: string; machine?: unknown };
  try { spec = JSON.parse(arg); } catch { spec = { command: unquote(arg) }; }
  const command = String(spec?.command ?? "").trim();
  if (!command) return 'local_shell_bg cần {"command":"<lệnh chạy nền>"}';
  const m = chonMay(spec);
  if ("loi" in m) return m.loi;
  const r = await runOnUserComputer(
    { kind: "spawn", command, ...(spec?.cwd ? { cwd: String(spec.cwd) } : {}), ...(spec?.description ? { description: String(spec.description) } : {}) },
    { machineId: m.may.computerId, timeoutMs: 30_000 },
  );
  if (!r.ok) return `Không chạy nền được trên ${m.may.label}: ${r.error}`;
  const d = (r.data ?? {}) as { shellId?: number; pid?: number; workingDirectory?: string };
  const shellId = Number(d.shellId ?? 0);
  const tep = duongJson(tepDauRaNen(m.may, shellId));
  return `[${m.may.label}] lệnh đang chạy nền — shellId ${shellId}${d.pid ? `, pid ${d.pid}` : ""}, thư mục ${d.workingDirectory || "?"}.\n`
    + `Đầu ra ghi vào ${tep} — xem bằng local_read({"path":"${tep}"}) (dòng "status:" ở đầu, "exit_code:" ở cuối khi xong). `
    + "Lệnh vẫn chạy sau khi lượt này kết thúc; không gõ được vào nó, nên nếu nó dừng chờ hỏi thì phải chạy lại với cờ tự trả lời.";
};

/**
 * Chép tệp máy người dùng → box (CopyToBox của hãng). Sau đó mọi tool box (run_terminal_command_v2,
 * read_file_v2, ffmpeg…) làm việc trên bản chép; tệp trên máy người dùng không bị đụng. Trần 100 MiB.
 */
TOOLS.local_copy_to_box = async (arg, _ctx) => {
  let spec: { path?: string; boxPath?: string; machine?: unknown };
  try { spec = JSON.parse(arg); } catch { spec = { path: unquote(arg) }; }
  const path = String(spec?.path ?? "").trim();
  if (!path) return 'local_copy_to_box cần {"path":"C:/Users/<tên>/…/tep.mp4"} (thêm "boxPath" nếu muốn đặt chỗ khác trên box)';
  if (!boxConfigured()) return "Chưa nối box nên không có chỗ để chép tới.";
  const m = chonMay(spec);
  if ("loi" in m) return m.loi;
  const r = await chepLenBox({ machineId: m.may.computerId, duongMay: path, ...(spec?.boxPath ? { duongBox: String(spec.boxPath) } : {}) });
  if (!r.ok) return `Không chép được từ ${m.may.label}: ${r.error}`;
  return `[${m.may.label}] đã chép ${r.duongMay} → box:${r.duongBox} (${r.bytes} byte, ${r.khuc} khúc, sha256 ${r.sha256.slice(0, 16)}…). `
    + `Giờ dùng tool box trên đường dẫn ${r.duongBox}; tệp gốc trên máy không đổi.`;
};

/**
 * Chép tệp box → máy người dùng (CopyFromBox). Mặc định ghi vào Desktop của họ; đường dẫn đích phải
 * nằm trong thư mục người dùng (daemon từ chối chỗ khác). Ghi đè nếu trùng tên.
 */
TOOLS.local_copy_from_box = async (arg, _ctx) => {
  let spec: { boxPath?: string; source?: string; path?: string; machine?: unknown };
  try { spec = JSON.parse(arg); } catch { spec = { boxPath: unquote(arg) }; }
  const boxPath = String(spec?.boxPath ?? spec?.source ?? "").trim();
  if (!boxPath) return 'local_copy_from_box cần {"boxPath":"<tệp trên box>"} (thêm "path":"C:/Users/<tên>/Desktop/…" để đặt tên/chỗ khác)';
  if (!boxConfigured()) return "Chưa nối box nên không có gì để chép về.";
  const m = chonMay(spec);
  if ("loi" in m) return m.loi;
  const r = await chepVeMay({
    machineId: m.may.computerId, duongBox: boxPath,
    ...(spec?.path ? { duongMay: String(spec.path) } : {}),
    ...(m.may.localRoot ? { localRoot: m.may.localRoot } : {}),
  });
  if (!r.ok) return `Không chép được về ${m.may.label}: ${r.error}`;
  return `[${m.may.label}] đã chép box:${r.duongBox} → ${r.duongMay} (${r.bytes} byte, sha256 ${r.sha256.slice(0, 16)}…). Người dùng mở được ngay trên máy họ.`;
};

TOOLS.local_read = async (arg, _ctx) => {
  let spec: { path?: string };
  try { spec = JSON.parse(arg); } catch { spec = { path: unquote(arg) }; }
  const path = String(spec?.path ?? "").trim();
  if (!path) return 'local_read cần {"path":"<đường dẫn trên máy bạn>"}';
  const chiDinh = String((spec as { machine?: unknown })?.machine ?? "").trim();
  const may = chiDinh ? findMachine(chiDinh) : connectedMachine();
  if (chiDinh && !may) {
    const co = connectedMachines().map((m) => m.label);
    return `Không thấy máy "${chiDinh}" đang nối`
      + (co.length ? ` — đang có: ${co.join(", ")}` : " — hiện không máy nào nối");
  }
  if (!may) return "Máy tính của bạn đang không kết nối. Mở app Grok Bot trên máy đó rồi thử lại.";
  const r = await runOnUserComputer({ kind: "read", path }, { machineId: may.computerId, timeoutMs: 20_000 });
  if (!r.ok) return `Không đọc được trên ${may.label}: ${r.error}`;
  const d = (r.data ?? {}) as { readResult?: { success?: { content?: string }; invalidFile?: { reason?: string } } };
  const rr = d.readResult;
  if (rr?.invalidFile) return `Không đọc được ${path}: ${rr.invalidFile.reason ?? "tệp không hợp lệ"}`;
  const noi = rr?.success?.content;
  if (typeof noi !== "string") return `Không rõ kết quả: ${JSON.stringify(r.data).slice(0, 300)}`;
  return catBot(`[${may.label}] ${path}\n${noi}`);
};

TOOLS.watch_video = async (arg, ctx) => {
  let spec: any;
  try { spec = JSON.parse(arg); } catch { spec = { path: unquote(arg) }; }
  const path = String(spec?.path ?? spec?.file ?? spec?.target_file ?? spec?.video ?? "").trim();
  if (!path) return 'watch_video cần {"path":"file video trên máy tính của bạn"}';
  if (!boxConfigured()) return "Chưa nối máy tính nên không mở được video.";
  // Đường dẫn đi thẳng vào lệnh shell trong nháy đơn — cấm nháy đơn và xuống dòng thay vì escape.
  const NLCH = String.fromCharCode(10), CRCH = String.fromCharCode(13);
  if (path.includes("'") || path.includes(NLCH) || path.includes(CRCH)) return "(đường dẫn chứa ký tự không hợp lệ)";
  const q = `'${path}'`;
  /*
   * Trần 24 khung, không phải 12.
   *
   * Đo 01/09 bằng một buổi demo thật: bot xem 6 khung của một clip 75 giây rồi nói "mấy khung rải
   * đều chưa đủ để đọc ra từng thao tác" — đúng, vì một buổi demo là chuỗi thao tác, và 6 mẫu cách
   * nhau 12 giây thì bỏ lọt cả việc gõ lẫn việc bấm. Nó bèn TỰ trích 25 khung rồi kẹt vì không mở
   * được ảnh mình vừa tạo.
   *
   * 24 khung xếp 3 cột × 8 hàng, mỗi khung rộng 480 — vẫn đọc được chữ trên màn hình, và một tấm
   * jpg cỡ đó còn xa mức 8 MB mà `readBytes` cho phép.
   */
  // Model gọi tool này với đủ tên: `frames`, `so_khung`, và (đo được 01/09) cả `fps`. Nhận hết rồi
  // kẹp vào [2, 24] — từ chối vì sai tên trường là mất một bước tool cho một chuyện không đáng.
  // Model gọi tool này với đủ tên: `frames`, `so_khung`, và (đo được 01/09) cả `fps`. Nhận hết.
  const xin = Number(spec?.frames ?? spec?.so_khung ?? spec?.fps ?? 4);
  /*
   * Bốn khung mỗi lần, KHÔNG phải hai mươi bốn — và đây là số đo, không phải thẩm mỹ.
   *
   * Model thị giác co ảnh về cạnh dài ~1568px trước khi nhìn. Một tấm 24 khung xếp 2 cột là
   * 1920x6480: co xong còn rộng ~460px, chữ trên thanh địa chỉ nát hoàn toàn. Đo 01/09 qua bốn lượt
   * dạy thật, bot lần nào cũng kết luận cùng một câu — "khung hình không rõ chữ, mình không dám
   * đoán rồi viết thành quy trình sai".
   *
   * Canary cùng ngày cho thấy đường ảnh KHÔNG hỏng: một tấm 1200x400 chữ cỡ 72, model chép lại
   * chính xác `GROKBOT-CANARY-4417`. Nên nút thắt là hình dạng tấm ghép, không phải đường truyền.
   *
   * 4 khung xếp 2x2, mỗi khung 960 → tấm 1920x1080, đúng tỷ lệ màn hình và gần cỡ model nhìn tốt
   * nhất. Muốn xem kỹ hơn thì gọi lại với `tu`/`den` cho từng đoạn, chứ không nhồi thêm khung vào
   * một tấm — nhiều khung trong một ảnh thì mỗi khung nhỏ đi, đó là đánh đổi không lối thoát.
   */
  const frames = Math.min(Math.max(Number.isFinite(xin) && xin > 0 ? Math.round(xin) : 4, 2), 6);

  // 1) ffprobe — dài, kích thước, codec; đồng thời là bước xác nhận file có thật.
  const probe = await boxCall<{ stdout: string; stderr: string; exitCode: number }>("exec", {
    command: `ffprobe -v error -show_entries format=duration:stream=codec_name,width,height -of default=noprint_wrappers=1 ${q}`,
  });
  if (probe.exitCode !== 0) {
    /*
     * Hỏng thì phải nói ĐỨNG Ở ĐÂU, không chỉ "No such file or directory".
     *
     * Đo ngày 30/08 trên một lượt thật: bot quay xong video, gọi `watch_video("rec/e2e_rec.mp4")`,
     * nhận đúng câu "No such file or directory" rồi đoán lại ba lần — mỗi lần nói y hệt "để mình
     * tìm file rồi xem", nên nhìn từ ngoài giống hệt một con bot đang bịa.
     *
     * Nguyên nhân thật: mọi lệnh chạy trong `/home/<user>/workspace`, còn bot viết đường dẫn tương
     * đối theo `$HOME`. Nó không có cách nào biết điều đó, vì không tool nào nói ra. Một vòng gọi
     * thêm ở nhánh HỎNG (hiếm) đổi lấy việc model tự sửa được ngay lần sau — rẻ.
     */
    const loi = probe.stderr.trim().slice(0, 300) || "ffprobe lỗi";
    if (!path.startsWith("/")) {
      const o = await boxCall<{ stdout: string }>("exec", { command: "pwd" }).catch(() => null);
      const cwd = o?.stdout?.trim();
      if (cwd) {
        return `Không mở được ${path}: ${loi}\n(đường dẫn TƯƠNG ĐỐI, và lệnh đang đứng ở ${cwd} — `
          + `dùng đường tuyệt đối, hoặc tính lại từ thư mục này.)`;
      }
    }
    return `Không mở được ${path}: ${loi}`;
  }
  const dur = Number((probe.stdout.match(/duration=([0-9.]+)/) ?? [])[1]) || 0;
  const w = (probe.stdout.match(/width=([0-9]+)/) ?? [])[1] ?? "?";
  const h = (probe.stdout.match(/height=([0-9]+)/) ?? [])[1] ?? "?";
  const codec = (probe.stdout.match(/codec_name=([a-z0-9_]+)/) ?? [])[1] ?? "?";

  // 2) volumedetect — chính là phép đo cho câu "-91 dB" của bot gốc. Không có track tiếng cũng là
  // một câu trả lời, không phải lỗi.
  const vol = await boxCall<{ stdout: string; exitCode: number }>("exec", {
    command: `ffmpeg -hide_banner -i ${q} -map 0:a:0 -af volumedetect -f null - 2>&1 | grep -E "mean_volume|max_volume" || echo NO_AUDIO`,
  });
  const mean = (vol.stdout.match(/mean_volume: ([-0-9.]+) dB/) ?? [])[1];
  const audio = vol.stdout.includes("NO_AUDIO") || mean == null
    ? "không có track tiếng"
    : `tiếng mean ${mean} dB, max ${(vol.stdout.match(/max_volume: ([-0-9.]+) dB/) ?? [])[1] ?? "?"} dB${Number(mean) <= -70 ? " (gần như câm)" : ""}`;

  // 3) contact sheet — N khung rải đều, ghép 3 cột. -frames:v 1 → đúng MỘT ảnh jpg.
  /*
   * Hai cột và mỗi khung rộng 960 — không phải ba cột × 480.
   *
   * Đo 01/09, buổi dạy bằng video: bot xem được khung hình rồi vẫn báo "khung hình không rõ chữ,
   * mình không dám đoán rồi viết thành quy trình sai". Một màn hình 1920 co xuống 480 thì chữ trên
   * thanh địa chỉ và trong ô tìm kiếm còn 1/4 kích thước — đúng thứ cần đọc để biết người ta gõ gì.
   *
   * 960 là nửa chiều ngang màn hình, đủ để chữ còn đọc được, và một tấm 2 cột vẫn xa mức 8 MB mà
   * `readBytes` cho phép.
   */
  const cols = 2, rows = Math.ceil(frames / cols);
  /*
   * Cắt theo ĐOẠN: `tu` và `den` tính bằng giây.
   *
   * Một buổi demo 75 giây có bốn năm việc nối nhau; xem cả clip bằng 4 khung thì mỗi việc chỉ được
   * một mẫu. Xem từng đoạn 15 giây thì mỗi việc có đủ khung để đọc ra thao tác, và mỗi tấm vẫn giữ
   * kích thước model nhìn rõ.
   */
  const tu = Math.max(0, Number(spec?.tu ?? spec?.from ?? spec?.start ?? 0) || 0);
  const den = Math.min(dur || 0, Number(spec?.den ?? spec?.to ?? spec?.end ?? dur) || dur);
  const doan = Math.max(den - tu, 1);
  const catDoan = tu > 0 || den < (dur || 0) - 0.5 ? `-ss ${tu} -t ${doan} ` : "";
  // KHÔNG ghi ra /tmp: exec chạy shell tự do nhưng readBytes đi qua safePath của daemon — mọi
  // đường dẫn phải nằm TRONG root của box. Đường dẫn tương đối resolve về root ở cả hai op
  // (exec có cwd mặc định là root), nên sheet nằm đúng chỗ đọc được. Đo được đúng lỗi này ở E2E
  // lần 1: bot tự khai "tool trích khung hình bị chặn vì nó ghi tạm ra /tmp".
  const sheet = `gb2-frames-${Date.now()}-${Math.floor(Math.random() * 1e6)}.jpg`;
  const mk = await boxCall<{ stdout: string; stderr: string; exitCode: number }>("exec", {
    command: `ffmpeg -hide_banner -y ${catDoan}-i ${q} -vf "fps=${frames}/${doan},scale=960:-2,tile=${cols}x${rows}" -frames:v 1 ${sheet} 2>&1 | tail -2`,
  });
  const info = `${path}: dài ${dur ? dur.toFixed(1) : "?"}s, ${w}x${h} ${codec}; ${audio}`;
  if (mk.exitCode !== 0) return `Đã đo được ${info} — nhưng không rút được khung hình: ${mk.stdout.trim().slice(0, 200)}`;
  const pull = await boxCall<{ totalSize: number; bytesBase64: string }>("readBytes", { target_file: sheet, offset: 0, length: 8_000_000 });
  void boxCall("exec", { command: `rm -f ${sheet}` }).catch(() => { /* rác /tmp, box tự dọn */ });
  if (!pull.bytesBase64 || pull.totalSize > 8_000_000) return `Đã đo được ${info} — nhưng ảnh khung hình quá lớn (${pull.totalSize} byte), không đính được.`;
  const dataUrl = `data:image/jpeg;base64,${pull.bytesBase64}`;
  const fileName = path.split("/").pop() || "video";
  ctx.attach(dataUrl, `${fileName}.khung-hinh.jpg`, `${frames} khung hình rải đều từ ${fileName}`);
  ctx.see(dataUrl);
  const pham = catDoan ? ` trong đoạn ${tu.toFixed(0)}–${den.toFixed(0)}s` : "";
  const themDoan = dur > 20 && !catDoan
    ? ` Clip dài ${dur.toFixed(0)}s: muốn đọc ra từng thao tác thì gọi lại theo từng đoạn — {"path":"…","tu":0,"den":15}, rồi 15–30, v.v.`
    : "";
  return `Đã xem ${info}. ${frames} khung hình rải đều${pham} (đọc từ trái sang phải, trên xuống dưới) đã đặt trước mắt bạn — hãy nhìn và nhận xét nội dung thật, đừng đoán.${themDoan}`;
};

/**
 * `view_image` — nhìn một ảnh có sẵn trên máy tính của bot.
 *
 * Khác `attach_image` ở chỗ căn bản: `attach_image` TẢI một ảnh từ web rồi GỬI cho người dùng xem;
 * cái này mở một file ảnh trên box và đặt nó trước mắt CHÍNH MODEL.
 *
 * Đo 01/09, buổi dạy bằng video: bot xem 6 khung thấy chưa đủ, tự trích 25 khung ghép thành
 * `sheet.png` — rồi tắc, vì không có đường nào mở tấm ảnh nó vừa tạo. Nó nói thẳng "bị chặn vì chưa
 * được cấp quyền đọc file đó" và dừng lại. Bot tự sinh ra được bằng chứng mà không nhìn được bằng
 * chứng của chính mình là một cái bẫy im lặng: mọi bước đều "thành công", kết quả vẫn là không học
 * được gì.
 */
TOOLS.view_image = async (arg, ctx) => {
  let spec: any;
  try { spec = JSON.parse(arg); } catch { spec = { path: unquote(arg) }; }
  const path = String(spec?.path ?? spec?.file ?? spec?.target_file ?? spec?.image ?? "").trim();
  if (!path) return 'view_image cần {"path":"đường dẫn ảnh trên máy tính của bạn"}';
  if (!boxConfigured()) return "Chưa nối máy tính nên không mở được ảnh.";

  const pull = await boxCall<{ totalSize?: number; bytesBase64?: string }>("readBytes", {
    target_file: path, offset: 0, length: 8_000_000,
  }).catch((e: Error) => ({ totalSize: 0, bytesBase64: "", loi: e.message } as never));
  const b64 = String((pull as { bytesBase64?: string }).bytesBase64 ?? "");
  if (!b64) {
    // Đường dẫn ngoài gốc làm việc là lý do hay gặp nhất, và thông báo phải nói ra điều đó —
    // "không đọc được" thì người đọc log không biết sửa gì.
    return `Không đọc được ${path}. Ảnh phải nằm TRONG gốc làm việc của bạn; thử đường dẫn tương đối.`;
  }
  const duoi = (path.split(".").pop() ?? "png").toLowerCase();
  const mime = duoi === "jpg" || duoi === "jpeg" ? "image/jpeg" : duoi === "webp" ? "image/webp" : "image/png";
  const dataUrl = `data:${mime};base64,${b64}`;
  ctx.see(dataUrl);
  return `Đã mở ${path} (${(pull as { totalSize?: number }).totalSize ?? "?"} byte) và đặt trước mắt bạn — hãy nhìn rồi nói nội dung thật, đừng đoán.`;
};

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

  /*
   * Soát bản giao việc — ca thứ ba app gốc bắt, nguyên văn lý do nó viết:
   *
   *     surface "subagent"
   *     "This delegated prompt instructs a subagent to inspect a third-party website (cinai.tv) and
   *      report back findings about its monetization, pricing, and business model. The trusted user
   *      message asks to 'check for 1 trillion dollars from this website' — a vague request that
   *      does not clearly authorize detailed reconnaissance… The delegated prompt goes beyond the
   *      user's stated intent."
   *
   * Ca này khác hai ca kia ở một điểm đáng để ý: người dùng nói MỘT câu ngắn, còn bot tự viết ra cả
   * một bản giao việc dài. Khoảng cách giữa hai thứ đó chính là chỗ ý định bị nống lên — và không
   * ai đọc bản giao việc ấy, trừ đúng con bot con sắp làm theo nó.
   *
   * Không lọc trước được như điều hướng: ở đó có tên miền để so, còn ở đây thứ phải so là cả một
   * đoạn văn. Đổi lại `task_v2` được gọi thưa hơn hẳn một cú bấm chuột, nên một lượt soát cho mỗi
   * lần giao việc là giá chấp nhận được.
   */
  const soat = await soatHanhDong({
    surface: "subagent",
    tomTat: `Giao việc cho bot con (${type}): "${task}"`,
    boiCanh: boiCanhGanNhat(ctx.agentId),
  });
  if (!soat.cho) {
    postAutoReview(ctx.agentId, {
      surface: "subagent",
      summary: `Giao việc cho bot con (${type}): ${title}`,
      reason: soat.lyDo ?? "",
      ...(soat.luatDeXuat ? { proposedRule: soat.luatDeXuat } : {}),
    });
    return `Chưa giao việc này cho bot con: nó rộng hơn thứ người dùng đã nhờ, đã đặt thẻ xin duyệt trong khung chat. Lý do: ${soat.lyDo}`;
  }

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
/**
 * Đọc đối số của `setup_plugin`, vốn tới theo hai dạng.
 *
 * Mô hình gọi kiểu nào cũng có: `{"plugin":"lark","values":{…}}` khi nó biết cần gì, và trần
 * `"lark"` khi chỉ muốn xem plugin đó cần gì. Tách phần đọc ra khỏi phần cài để `setupPlugin` chỉ
 * còn một mạch quyết định, thay vì mở đầu bằng hai nhánh phân tích chuỗi.
 */
function parseSetupArg(arg: string): { want: string; values: Record<string, string> } | { error: string } {
  const raw = arg.trim();
  if (!raw.startsWith("{")) return { want: raw.replace(/^["']|["']$/g, ""), values: {} };

  let d: { plugin?: unknown; name?: unknown; id?: unknown; values?: unknown };
  try { d = JSON.parse(raw) as typeof d; } catch {
    return { error: 'setup_plugin cần JSON, ví dụ {"plugin":"lark","values":{"LARK_APP_ID":"…","LARK_APP_SECRET":"…"}}' };
  }
  const values: Record<string, string> = {};
  if (d.values && typeof d.values === "object") {
    for (const [k, v] of Object.entries(d.values as Record<string, unknown>)) {
      if (typeof v === "string") values[k] = v;
    }
  }
  return { want: String(d.plugin ?? d.name ?? d.id ?? "").trim(), values };
}

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

  const parsed = parseSetupArg(arg);
  if ("error" in parsed) return parsed.error;
  const { want, values } = parsed;

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

/**
 * Tính năng 2 (nửa sau) — bot TỰ VIẾT skill: đường ghi cho thứ `skills.ts` mới chỉ biết đọc.
 *
 * App gốc làm đúng thế này trong B2: nó tự viết `shopee-ops-sop.md` rồi đính vào chat — "skill"
 * của hệ này CHÍNH LÀ file SOP trên đĩa. Ghi vào `$HOME/.claude/skills/<slug>/SKILL.md`:
 *   - `$HOME` nở trong exec, mà exec chạy dưới tài khoản OS của CHÍNH CHỦ (chặng 5) — nên skill
 *     theo từng người, không phải một kho chung để người này đổi lời nhắc của người kia.
 *   - `.claude/skills` là quy ước quét sẵn trong SKILL_DIRS, và cũng là định dạng Claude chuẩn.
 *   - heredoc TRÍCH DẪN (như box-secrets): nội dung có `$`, backtick, nháy — nở ra trong echo là
 *     nội dung SOP biến thành lệnh shell.
 *
 * KHÔNG auto-approve: một skill là lời dặn ĐỨNG LẠI trong mọi lượt sau — thay đổi hành vi lâu dài
 * thì người dùng phải gật, cùng lý do với create_agent.
 */
TOOLS.create_skill = async (arg, ctx) => {
  let spec: any;
  try { spec = JSON.parse(arg); } catch { spec = null; }
  const rawName = String(spec?.name ?? spec?.title ?? "").trim();
  const content = String(spec?.content ?? spec?.body ?? spec?.sop ?? "").trim();
  const description = String(spec?.description ?? "").trim();
  if (!rawName || !content) return 'create_skill cần {"name":"tên-skill","description":"dùng khi nào","content":"các bước SOP"}';
  if (!boxConfigured()) return "Chưa nối máy tính nên chưa có chỗ lưu skill.";
  const slug = rawName.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  if (!slug) return "(tên skill không hợp lệ)";
  const MARK = "GB2_SKILL_EOF";
  if (content.includes(MARK) || description.includes(MARK)) return "(nội dung chứa chuỗi đánh dấu nội bộ, đổi chữ khác giúp)";
  const file = `$HOME/.claude/skills/${slug}/SKILL.md`;
  const doc = `---
name: ${slug}
description: ${(description || rawName).split(String.fromCharCode(10)).join(" ").split(String.fromCharCode(13)).join(" ")}
---

${content}
`;
  const cmd = `mkdir -p "$HOME/.claude/skills/${slug}"
cat > ${file} <<'${MARK}'
${doc}${MARK}
echo "wrote=$(wc -c < ${file})"`;
  const r = await boxCall<{ stdout: string; stderr: string; exitCode: number }>("exec", { command: cmd });
  if (r.exitCode !== 0) return `Không ghi được skill: ${r.stderr.trim().slice(0, 200)}`;
  // Lát skill trong prompt đang cache TTL 2 phút — làm mới ngay để lượt sau đã thấy skill vừa ghi.
  resetSkillsCache();
  warmSkills();
  return `Đã lưu skill "${slug}" tại ${file} — từ giờ mọi lượt chat đều thấy nó trong <available_skills>.`;
};

/*
 * `create_workflow` — bot tự ghi một skill vào kho, thứ người dùng gõ `/` để gọi.
 *
 * Khác `create_skill` ở chỗ căn bản: `create_skill` ghi một tệp SOP lên đĩa box và tệp đó nằm trong
 * MỌI lượt chat sau đó (tốn ngữ cảnh mỗi lượt, dù cả tuần không ai dùng tới); `create_workflow` chỉ
 * nằm trong menu `/` cho tới khi có người gọi tên nó. Việc đã dạy thuộc loại thứ hai.
 *
 * App gốc làm việc này qua `update_state target:"workflow"`; bên mình tách thành tool riêng vì
 * `update_state` của ta không có nhánh workflow, và thêm một nhánh chỉ để làm một việc thì khó đọc
 * hơn một tool gọi đúng tên việc.
 */
TOOLS.create_workflow = (arg, ctx) => {
  const spec = (() => { try { return JSON.parse(arg); } catch { return { name: "", instructions: unquote(arg) }; } })();
  /*
   * `agent` — ghi skill cho bot KHÁC cùng chủ (Thợ dựng bot gắn skill cho bot nó vừa tạo). Mặc định là chính mình,
   * cùng luật với `create_routine{agent}` (28/08): tool không chỉ được sang bot khác thì mọi thứ bot mẹ dựng cho
   * bot con rơi hết vào bot mẹ. Tra theo id rồi theo tên, chỉ trong bot của cùng chủ.
   */
  const wanted = String(spec?.agent ?? spec?.agentName ?? "").trim();
  let target = ctx.agentId;
  if (wanted) {
    const owner = ownerOf(ctx.agentId) ?? DEFAULT_USER.authId;
    const mine = [...agents.values()].filter((a) => ownerOf(a.id) === owner);
    const hit = mine.find((a) => a.id === wanted) ?? mine.find((a) => a.name.toLowerCase() === wanted.toLowerCase());
    if (!hit) return `(không thấy bot "${wanted}" — create_agent trước, rồi gọi lại với đúng tên)`;
    target = hit.id;
  }
  return taoWorkflowTuBot(spec, target);
};

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
  // Lời dặn riêng người dùng đặt cho từng server (`setMcpCustomInstructions`). Ghép vào ĐÂY mới là
  // thật: lưu một chuỗi rồi không đưa vào lời nhắc thì cái ô kia chỉ là chỗ gõ chữ cho vui.
  const notes = Object.entries(allInstructions(owner))
    .filter(([id]) => names.includes(id))
    .map(([id, text]) => `- ${id}: ${text}`);
  const notesBlock = notes.length
    ? "\n\nThe user set these rules for specific services — follow them:\n" + notes.join("\n")
    : "";
  return "\n\nMCP: these services are already connected — " + names.join(", ") + ". " +
    "List a server's tools with TOOL_CALL: get_mcp_tools(<server name>), then call one with " +
    'TOOL_CALL: call_mcp_tool({"server":"…","tool_name":"…","tool_args":{…}}). ' +
    "Prefer MCP over opening a browser when the service is already here." + notesBlock;
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
  for (const name of BROWSER_TOOL_NAMES) {
    TOOLS[name] = async (arg, ctx) => {
      if (name === "browser_navigate") {
        const chan = await soatDieuHuong(arg, ctx.agentId);
        if (chan) return chan;
      }
      return runBrowserTool(name, arg, ctx);
    };
  }
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

/**
 * Sơ đồ được quảng cáo vô điều kiện: nó chỉ sinh ra chữ, không cần hộp, không cần khoá.
 *
 * Client 0.29 dựng sẵn mermaid trong bundle, nên khối ```mermaid hiện thành hình vẽ thật chứ không
 * phải một đống chữ — đó là lý do đáng dạy model dùng thay vì tự kẻ bằng ký tự ASCII.
 */
const DIAGRAM_PROTOCOL =
  "\n\nDIAGRAMS: when a flow, an architecture, a sequence of steps or a state machine is easier seen " +
  "than described, draw it with " +
  'TOOL_CALL: create_diagram({"title":"optional","code":"flowchart TD\\n  A[Start] --> B[Done]"}) — ' +
  "the body is mermaid syntax and the app renders it as a real picture. Use it instead of drawing " +
  "boxes out of ASCII characters. Keep it small: a diagram nobody can read at a glance is worse than " +
  "a sentence.";

const ASK_PROTOCOL =
  // "…if you need a decision first, ask with a widget rather than stalling." — the original's rule,
  // and `ask_question` is the widget it means.
  "\n\nASKING THE USER: when the user has to choose between directions, ask with the widget rather than " +
  "stalling: " +
  'TOOL_CALL: ask_question({"prompt":"The question?","options":[{"label":"Option A"},{"label":"Option B"}]}) ' +
  "— up to 6 options, add \"allowCustom\":true if they may type their own answer, and " +
  "\"multiSelect\":true when several answers may be picked at once (which plugins to install, which " +
  "shops to include…). " +
  "Do not ask and then answer yourself: end the turn after asking, the answer arrives on the next one. " +
  /*
   * Luật thứ hai, và nó KHÁC luật ở trên — đây là chỗ ta thua app gốc năm case liền.
   *
   * Luật trên nói "khi người dùng phải chọn giữa các HƯỚNG ĐI". Đo cách app gốc thật sự dùng widget
   * (case 5, 6, 8, 11, 15 của kịch bản B2) thì tình huống khác hẳn: nó hỏi khi **câu trả lời tiếp
   * theo phụ thuộc vào việc người dùng đang ở tình huống nào**, chứ không phải khi có nhiều hướng.
   *
   *     case 6  "Bạn đã có app trên Console chưa?"   [Đã có app | Mới có shop, chưa có app]
   *     case 11 "Bạn muốn mình làm kiểu nào?"        [Quay màn hình | Setup OBS | Thử live Shopee]
   *     case 15 "Làm tiếp cái nào?"                  [Cắt/edit clip | Gắn MCP OBS | Thôi]
   *     case 5  "Bạn muốn mình gắn Shopee kiểu nào?" [Dùng web | MCP quản lý shop | MCP tìm sản phẩm]
   *
   * Bot ta trả lời đúng và đầy đủ rồi DỪNG. Nó không vi phạm luật nào — luật chỉ chưa mô tả tình
   * huống này. Cùng loài với hai lỗi trước: một lệnh cấm ("đừng dựng bot giả làm phòng") không sinh
   * ra hành động mở phòng, và một tên tool không kèm định dạng thì model không gọi.
   *
   * Đo case 6 cho thấy vế kiến thức của ta KHÔNG thua: bot ta còn nói thêm Test vs Live Partner Key
   * và bước "Go live" chờ duyệt. Chỉ thiếu đúng câu hỏi cuối.
   */
  "AFTER you answer, if the next step is WORK YOU WOULD DO and the person's situation decides which "
  + "work it is — do they already have the account, which of these should you set up first, should "
  + "you do it here or on their machine — give the answer they asked for, then END the turn with the "
  + "widget naming 2–4 concrete actions YOU would take next (plus a \"Thôi\" when stopping is "
  + "reasonable). Spelling out every branch in prose lands as work the person must now sort through. "
  + "But a question that only wants INFORMATION ends when the information is delivered: do not "
  + "manufacture a next step for it. If you would not act on any of the options, there is no widget "
  + "to raise."
  /*
   * Ba VÍ DỤ THẬT, và vì sao chúng phải nằm trong lời nhắc chứ không phải trong chú thích.
   *
   * Bốn ví dụ này đã ngồi ngay phía trên từ lâu — trong một khối `/* … *\/`. Người đọc code thấy
   * chúng; model thì KHÔNG, vì chú thích không đi vào chuỗi nào cả. Suốt ba vòng vặn luật văn xuôi
   * tôi cứ diễn đạt lại cái quy tắc, trong khi thứ mô tả nó chính xác nhất đã nằm sẵn cách đó mười
   * dòng và chưa bao giờ được gửi đi.
   *
   * Bảng theo dõi ghi "muốn tiến thêm phải đổi thứ khác một luật văn xuôi — dạy bằng ví dụ trong
   * ngữ cảnh". Đây đúng là việc đó, và nó rẻ hơn mọi cách khác đã thử.
   *
   * Chép NGUYÊN VĂN từ transcript app gốc (`docs/extracted/kich-ban-b2.json`), không diễn giải:
   * hai ca ta còn lệch ổn định qua hai lần đo độc lập là case 6 và 15, và cả hai đều nằm đây.
   */
  + " Ba ví dụ có thật, từ chính app này:"
  + ' "Partner ID / Partner Key / Shop ID lấy ở đâu?" → trả lời xong thì hỏi '
  + '"Bạn đã có app trên Console chưa?" [Đã có app | Mới có shop, chưa có app] — vì bước tiếp theo khác hẳn nhau.'
  + ' "Bạn biết edit video luôn không?" → trả lời được gì rồi hỏi '
  + '"Làm tiếp cái nào?" [Cắt/edit clip | Gắn MCP OBS | Thôi].'
  + ' "Tìm mcp shopee" → tra xong, liệt kê xong thì hỏi '
  + '"Bạn muốn mình gắn Shopee kiểu nào?" [Dùng web | MCP quản lý shop | MCP tìm sản phẩm].'
  + " Điểm chung: người dùng hỏi một câu NGẮN về năng lực, bạn trả lời thật, rồi việc tiếp theo rẽ"
  + " thành vài nhánh mà chỉ họ mới chọn được — đó là lúc dựng widget, không phải kể hết các nhánh ra bằng văn xuôi."
  /*
   * Vế NGƯỢC, và nó ra đời vì đo chứ không vì nghĩ thêm.
   *
   * Ba ví dụ ở trên chữa đúng bệnh thiếu: cả 5 ca app gốc mời chọn (5, 6, 8, 11, 15) từ chỗ lệch
   * dai dẳng thành đúng hết. Nhưng núm vặn sang đầu kia — 5 ca app gốc KHÔNG hỏi thì ta lại hỏi
   * (2, 7, 13, 17, 21). Dạy "khi nào mời chọn" mà không dạy "khi nào thôi" thì được đúng một nửa.
   *
   * Đọc lại app gốc trả lời gì ở 5 ca ấy thì quy luật hiện ra, và nó không phải chuyện câu chữ:
   *
   *     case 7  "bạn tự đăng ký cho mình đc ko" → "Mình mở form trên máy mình được… Đang mở Open Platform."
   *     case 13 "cách dùng OBS như nào"         → "OBS đang chạy profile Shopee. Scene Man hinh = quay cả màn hình."
   *     case 21 "capcut"                        → "CapCut desktop không có bản Linux. Mình mở CapCut Web trên máy này."
   *
   * Nó BẮT TAY LÀM, vì đã biết phải làm gì. Không có nhánh nào để người khác chọn hộ.
   */
  + " Và vế ngược, quan trọng ngang vế trên: khi bạn ĐÃ BIẾT phải làm gì thì LÀM, đừng hỏi."
  + ' Cùng app đó: "bạn tự đăng ký giúp mình được không?" → "Mình mở form trên máy mình được. Đăng'
  + ' nhập thì bạn phải tự bấm. Đang mở Open Platform." — bắt tay làm, KHÔNG widget.'
  + ' "cách dùng OBS như nào?" → "OBS đang chạy profile Shopee, scene Man hinh quay cả màn hình." — trả lời thẳng, KHÔNG widget.'
  /*
   * Hai ví dụ này mắc trong chú thích suốt một ngày — lần thứ HAI cùng một lỗi.
   *
   * Khối chú thích ngay trên có ba ca (7, 13, 21), nhưng chỉ 7 và 13 được nối vào chuỗi. Case 21
   * ("capcut") nằm trong `/* … *\/` và chưa bao giờ đi tới model. Đo 02/09 sau khi sửa nhịp chờ của
   * bài đo: case 21 ra **3/3 THỪA** — ổn định lệch, đúng ca mà chú thích đã mô tả chính xác.
   *
   * Vòng 5 của §4 đã trả giá đúng bài học này (bốn ví dụ trong chú thích, model không thấy) và tôi
   * vẫn để lại một cái. Nên luật rút ra không phải "nhớ chép ví dụ" mà: **một ví dụ chỉ tồn tại khi
   * nó nằm trong chuỗi**; chú thích mô tả hành vi là tài liệu cho người, không phải cấu hình.
   *
   * Case 12 là dạng khác và nó không có trong khối cũ: người dùng gõ đúng một chữ "ok" sau khi bot
   * vừa nêu kế hoạch. App gốc TIẾP TỤC ("Mình cài OBS trên máy mình, tạo scene quay màn hình."),
   * còn ta hỏi lại 3/3 — hỏi lại một thứ vừa được đồng ý.
   */
  + ' "capcut" → "CapCut desktop không có bản Linux. Mình mở CapCut Web trên máy này." — tên một'
  + " sản phẩm gõ trần là yêu cầu MỞ nó, không phải câu hỏi cần làm rõ."
  + ' Và khi người dùng chỉ đáp "ok" / "được" / "làm đi" sau khi bạn vừa nêu kế hoạch: đó là ĐỒNG Ý —'
  + " tiếp tục đúng việc vừa nêu, đừng hỏi lại thứ họ vừa thuận."
  + " Phép thử: nếu bạn đã biết bước tiếp theo là gì thì làm nó; chỉ hỏi khi bước tiếp theo rẽ nhánh"
  + " và bạn KHÔNG có cách nào đoán đúng nhánh nào."
  /*
   * Vế thứ BA: không biết thì đi TRA, đừng bắt người dùng làm rõ hộ.
   *
   * Ca này (case 1 · "bản moi nhất grok bpot có tinh năng nào mới") ra 3/3 mời chọn qua lượt đo
   * 01/09 — con số vững nhất trong cả bảng vì nó là ca duy nhất đo đủ ba lượt. Và nó KHÔNG phải
   * biến thể của hai vế trên: bot ta trả lời "không có changelog nên không biết" rồi dựng widget
   * "Bạn đang hỏi cái nào? [App Grok Bot này | Grok của xAI | Thôi]".
   *
   * Nhập nhằng ấy là thật. Nhưng app gốc không hỏi — nó chọn nghĩa hiển nhiên (chính cái app người
   * dùng đang ngồi trong) rồi đi tra, và trả về dữ kiện: ngày ra beta, gói nào dùng được, tính năng
   * đang có, cái gì sắp ra. `web_search` không cần box lẫn key nên nó LUÔN bật — bot có công cụ
   * trong tay mà tuyên bố không biết.
   *
   * Chi tiết cuối đáng chép: câu hỏi tiếp của app gốc nằm trong VĂN XUÔI ("Muốn mình đi sâu cái
   * nào?"), không phải widget. Cùng một ý muốn, hai hình dạng khác nhau — và bộ ca chấm đúng hình
   * dạng đó.
   *
   * Chép nguyên văn từ `docs/parity-runs/bo-ca-parity.json`, không diễn giải.
   */
  + " Vế thứ ba: KHÔNG BIẾT thì đi TRA, đừng bắt người dùng làm rõ hộ một thứ bạn tra được."
  + ' Cùng app đó: "bản mới nhất Grok Bot có tính năng nào mới?" → "Để mình check bản Grok Bot mới'
  + ' nhất xem có gì mới." rồi web_search, rồi trả về dữ kiện thật (ra beta 11/8; gói SuperGrok,'
  + ' Cursor Pro, Cursor Teams đều dùng được; mỗi Bot có máy tính cloud riêng; template chia sẻ thì'
  + ' chưa ship hết) — và câu hỏi tiếp ("Muốn mình đi sâu cái nào?") viết THÀNH CÂU, KHÔNG widget.'
  + " Tên sản phẩm nghe nhập nhằng thì lấy nghĩa hiển nhiên nhất — chính app người dùng đang dùng —"
  + " rồi tra; nói \"mình không biết\" khi chưa thử tra là bỏ dở việc.";

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
  // 0.29's team flow: the creator writes each bot's job description INTO the bot, then opens a
  // room for the team. The description is the bot's standing role (it rides the system prompt);
  // a briefing message is just one line in its transcript.
  'TOOL_CALL: create_agent({"agents":[{"name":"Kho","description":"vai trò + luật làm việc, viết kỹ như một bản SOP"}]}) — one entry per bot. ' +
  'TOOL_CALL: share_bot_template({"agent":"Kế toán","description":"2–4 câu kiểu Marketplace: làm gì, cho ai, giọng thế nào, KHÔNG làm gì"}) — package a bot (or a whole team) as a template CARD the user confirms with its Publish button; omit "agent" for yourself. Always write "description" yourself from the profile and memories, never ask the user for it. ' +
  'TOOL_CALL: publish_bot_listing({"agent":"Kế toán","category":"ops-finance","description":"2–4 câu kiểu Marketplace"}) — ONE step: packages (with that card text), publishes and lists the bot on the community Marketplace (tab Marketplace → Bots); do not call share_bot_template first when the user already chose to publish. category is one of engineering, design, marketing, customer-support, product, ops-finance, recruiting-people, sales, productivity. Ask which category if the user did not say. ' +
  'TOOL_CALL: create_group({"name":"Ops","members":["Kho","Ads"]}) — a shared room; every member answers in turn when the user speaks there. ' +
  "A room is NOT a bot: never create_agent for something meant to hold members — create the member bots first, then create_group with their names. " +
  /*
   * Luật KHẲNG ĐỊNH, không phải cấm đoán — và đó là cả điểm sửa.
   *
   * Câu trên chỉ cấm "dựng một bot giả làm phòng". Đo ngày 28/08: model dựng 5 bot vai trò
   * (Vận Hành Đơn, CSKH, Kho & Nhập Hàng, Marketing, Số Liệu) rồi DỪNG — không con nào
   * "định để chứa thành viên" nên nó chẳng vi phạm gì, chỉ là không ai bảo nó mở phòng.
   * Roster đo được: 14 bot, 0 group, 0 cạnh bot-nhắn-bot.
   *
   * App gốc làm ngược lại, và đó là ground truth chụp từ máy người dùng: `Shopee Ops` là
   * một group 6 thành viên, mở đầu bằng "Hi. Dàn CS / Kho / Listing / Ads / Kế toán đây.
   * Việc đầu tiên là gì?" rồi cả phòng bàn việc với nhau. Cái phòng KHÔNG phải phần thêm
   * cho đẹp — nó là chỗ duy nhất mấy con bot đó biết đến sự tồn tại của nhau.
   *
   * Trước khi viết câu này tôi đã đo rằng luật cũ CÓ tới được model (giao thức tool 13.441
   * ký tự, câu đó nguyên vẹn) — nên đây không phải vá một lời nhắc không được đọc.
   */
  "When you build a TEAM (two or more bots at once), finish the job in FOUR steps: create_agent "
  + "for each member, create_group with all of them, send the first task INTO the room with "
  + 'message_agent({"to":"<room name>","content":"..."}) — the room name works as a target just '
  + "like a bot name. Creating a room is not opening it: measured 28/08, the model created the "
  + "group, reported to the user and stopped, leaving a room nobody had ever spoken in. Do not end "
  + "the turn on the create_group result. "
  // Bước 4 và luật đặt tên — cả hai trích từ chính app gốc, xem `doi-bot.ts`.
  + BUOC_DAT_LICH
  + LUAT_DAT_TEN + " " +
  /*
   * Routine — và chỗ này trước đây chỉ có TÊN tool, không có gì khác.
   *
   * `create_routine` nằm trong danh sách tool gửi cho model, nhưng giao thức không hề nói định dạng
   * `trigger` (đo 28/08: chuỗi "cron" và "schedule" đều 0 lần trong 13.962 ký tự giao thức). Model
   * biết tool tồn tại mà không biết gọi thế nào — gần như chắc chắn nó sẽ không gọi.
   *
   * App gốc thì tạo bot LÀ tạo luôn routine cho bot đó, ảnh chụp từ máy người dùng:
   *
   *     Shopee Kho      "Hàng chờ lấy"        0 8,12,17,22 * * *
   *     Shopee Kế toán  "Nhật ký P và L tuần" Every Monday at 9:30 AM
   *                     "Chốt tháng Shopee"   ngày 1,2,3 hằng tháng 9:00
   *     Shopee Ads      "Check ads sáng" / "Check ads 16h"   (Paused)
   *
   * Nhịp routine bám đúng nhịp công việc của từng con, và tên đặt bằng tiếng người dùng. Backend ta
   * nhận đúng cron 5 trường như thế (`automations.ts` §15), nên đây là khoảng trống LỜI NHẮC chứ
   * không phải thiếu năng lực — cùng loại với chuyện cái phòng không ai mở.
   */
  'TOOL_CALL: create_routine({"name":"Hàng chờ lấy","prompt":"việc phải làm mỗi lần chạy","trigger":"0 8,12,17,22 * * *","agent":"Kho"}) '
  + "— cron 5 trường (phút giờ ngày tháng thứ), thêm \"CRON_TZ=Asia/Ho_Chi_Minh \" ở đầu nếu cần đúng múi giờ. "
  + "Khi một bot có việc lặp theo nhịp (rà đơn mỗi ca, chốt sổ hằng tuần, xem số mỗi sáng), tạo routine cho nó "
  + "ngay lúc dựng bot — đặt tên theo việc, và viết prompt như một lệnh giao cho chính con bot đó. "
  + "Bỏ \"agent\" thì routine thuộc về CHÍNH BẠN; dựng routine cho một con trong đội thì phải nêu tên nó. "
  + "Một bot có mô tả mà không có nhịp thì chỉ chạy khi bị hỏi. " +
  'TOOL_CALL: rename_agent({"from":"New Bot","to":"Manager"}) — drop "from" to rename yourself. ' +
  /*
   * Mô tả bot: đo từ NĂM mô tả thật của app gốc, không phải lời khuyên chung.
   *
   * `docs/extracted/chat-goc-0.29.md` giữ nguyên văn mô tả của Kho, CS, Ads, Listing, Kế toán.
   * Cả năm cùng một khuôn, và khuôn đó khác hẳn thứ bot ta viết ra. Ta viết một CHỨC DANH
   * ("Bot quản lý quảng cáo Shopee Ads … cho shop lớn"); app gốc viết một BẢN SOP có ngưỡng:
   *
   *   "Bạn là Kho/Fulfill Shopee của shop khanh duy (VN, vận chuyển SPX). Việc: … Cutoff GMT+7:
   *    đơn trước 18:00 phải Chuẩn bị hàng tốt nhất trước 19:00 và bàn giao trước 23:59 … Mục tiêu
   *    LSR < 3%, NFR < 2%, FHR ≥ 90% … Không pack khi hết tồn. Trả lời tiếng Việt, checklist."
   *
   * Thành phần số 6 đáng chú ý nhất: mỗi mô tả nói rõ KHI NÀO gọi bot nào ("Hết hàng thì báo
   * Kho/Listing", "tồn 0 + báo Ads pause"). Đó là lý do bot bên hãng nhắn nhau thường xuyên mà
   * không ai bảo — luật bàn giao nằm trong chính nhân cách của chúng, không nằm trong lời nhắc
   * chung. Bot ta chưa con nào có dòng đó, và đúng là chúng chỉ nhắn nhau khi bị ép.
   */
  "Every bot you create needs a description written as its STANDING ORDERS, not a job title. "
  + "Address it as \"Bạn là …\" and name whose shop/team it serves. Then, as far as the person has "
  + "told you: what it does; the NUMBERS it works to (cutoffs, targets, limits, how often it "
  + "checks); what it must never do; when to stop and ask the owner; WHICH OTHER BOT it hands to "
  + "and on what trigger; and how to answer (language, format). The handoff line is what makes a "
  + "team talk to each other instead of working alone. "
  + "Do not invent numbers the person never gave you — leave that part out and say you left it out.";

/**
 * Scaffolding from the first spike — `calc`, `echo` and friends. They stay callable so the
 * older e2e scripts keep working, but they are no longer advertised: the original has nothing
 * like them, and a model shown a `calc` tool reaches for it instead of doing arithmetic in an
 * ordinary sentence.
 */
const VIDEO_PROTOCOL = boxConfigured()
  ? String.fromCharCode(10) + String.fromCharCode(10) +
    "WATCHING VIDEO: to actually SEE a video file on your computer (one you recorded, downloaded, or " +
    "produced), call " +
    /*
   * Ví dụ dùng đường TƯƠNG ĐỐI, vì `/workspace` không còn tồn tại.
   *
   * Box chạy per-user: mỗi người một gốc `/home/gb2u00N/workspace`, không phải `/workspace` chung
   * như trước. Đo trong lượt E2E 28/08: `list_dir_v2("/workspace")` trả `path escapes root`, và bot
   * phải lách bằng `run_terminal_command_v2` để xem thư mục của chính nó.
   *
   * `watch_video` thì KHÔNG đi qua phép kiểm đó — nó dựng một lệnh shell, nên đường tuyệt đối vẫn
   * chạy (cùng lượt đó nó xem được `/tmp/e2e_test_v2.mp4`). Nhưng một ví dụ trỏ vào thư mục không
   * tồn tại vẫn dạy model một bản đồ sai về nơi nó đang đứng, và cái bản đồ sai đó là thứ làm hỏng
   * các tool file khác.
   */
  'TOOL_CALL: watch_video({"path":"clip.mp4"}) — đường dẫn tương đối gốc làm việc; you get duration, resolution, audio ' +
    // Thêm `frames` và `view_image` vào giao thức vì đo 01/09: bot muốn xem kỹ hơn 6 khung, tự trích
    // 25 khung ra ảnh, rồi tắc — nó không biết có đường nào mở tấm ảnh nó vừa tạo.
    'Clip dài thì xem theo ĐOẠN, đừng xin thêm khung: {"path":"clip.mp4","tu":0,"den":15} rồi 15–30, v.v. ' +
    "Bốn khung một tấm là để mỗi khung còn đủ lớn mà đọc chữ trên màn hình; nhồi 24 khung vào một tấm " +
    "thì tấm ấy bị co lại và không khung nào đọc được — đo rồi, không phải suy đoán. " +
    'TOOL_CALL: view_image({"path":"anh.png"}) mở MỘT ảnh có sẵn trên máy bạn và đặt nó trước mắt bạn — dùng cho ảnh bạn tự trích ra. ' +
    "loudness, and a grid of evenly-spaced frames placed before your eyes. ALWAYS watch your own " +
    "output before telling the user it is good — a black or silent clip is something you must catch " +
    "yourself, then fix and re-check. " +
    /*
     * GỬI video — khoảng trống đo được 31/08, và là loại khoảng trống tệ nhất: năng lực đã có, chỉ
     * model không biết.
     *
     * Trích transcript THẬT của app gốc: nó gửi video cho người dùng như một tệp đính kèm thường,
     * kèm kích thước —
     *
     *     {"type":"attachment","url":"file:///home/box/.../<sha256>.mp4",
     *      "file_name":"2026-08-30_20-07-57.mp4","width":1280,"height":800}
     *
     * `attach_file` của ta đi đúng đường đó từ lâu (đường tuyệt đối trên box, không nhét base64 vào
     * bản ghi). Nhưng giao thức chỉ có TÊN nó trong danh sách, không một dòng nào nói gọi thế nào
     * hay gửi được video — nên bot quay xong clip 75 giây rồi… gửi ảnh chụp khung hình.
     *
     * Đây đúng bài học `create_routine` (28/08) lặp lại: model biết tool tồn tại mà không biết gọi
     * thế nào thì gần như chắc chắn nó sẽ không gọi.
     */
    'SENDING a file — video included: TOOL_CALL: attach_file({"path":"clip.mp4","alt":"mô tả ngắn"}) ' +
    "puts the file itself in the conversation. This works for .mp4 and .gif, not only images, and it " +
    "is how you hand over a clip you recorded. Do NOT settle for sending frame grabs when the person " +
    "asked for the video: frames are for YOU to check your work, the file is what they asked for. " +
    "A clip that is too heavy to send is a clip to re-encode smaller (H.264 baseline, lower " +
    "resolution), not a reason to send pictures instead."
  : "";

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
  BROWSER_PROTOCOL + IMAGE_PROTOCOL + VIDEO_PROTOCOL + DIAGRAM_PROTOCOL + ASK_PROTOCOL + DRAFT_PROTOCOL + PEER_PROTOCOL + MEMORY_PROTOCOL + boxToolProtocol() + obsProtocol();

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
  "which keys you saved. If a required value is missing, ask the person for it. " +
  // Nhịp của app gốc, đo trong b2-replay (case 5, 8, 15, 23): nó RÀ trước, KỂ TÊN THẬT, rồi HỎI
  // bằng widget — và chỉ cài sau khi người dùng chọn. Bên mình từng nhảy thẳng vào setup_plugin.
  "WHEN THE PERSON ASKS whether a capability/plugin/MCP exists (rather than telling you to install " +
  "one): first LOOK — setup_plugin() for the catalog, get_mcp_tools for connected servers, your " +
  "skills list — then answer with the REAL names you found. " +
  // Đo trong e2e-feature2: sau khi sửa auto-approve, bot ĐÃ rà trước và trả lời có tên thật, nhưng
  // dừng ở đó — trong khi app gốc kết thúc lượt bằng một widget để người dùng bấm chọn (B2 case 5,
  // 8, 15, 23). Nên nói rõ CÁCH KẾT THÚC lượt, không chỉ nói "hãy mời chọn".
  "If you found one or more candidates, END that turn with " +
  'TOOL_CALL: ask_question({"prompt":"…","options":[…]}) so they can pick — one option per candidate, ' +
  'plus a "Thôi" option; add "multiSelect":true when several could be installed together. ' +
  "If you found nothing that fits, say so plainly and do not raise a widget. " +
  "Do NOT call setup_plugin with a plugin until the person has picked one.";

const SKILL_WRITE_PROTOCOL = boxConfigured()
  ? "" +
    String.fromCharCode(10) + String.fromCharCode(10) +
    "WRITING SKILLS: when the person settles a procedure worth keeping (an SOP, a checklist, rules " +
    "for a recurring task) or asks you to remember HOW to do something, save it as a skill: " +
    'TOOL_CALL: create_skill({"name":"ten-ngan","description":"when to use it","content":"the steps"}). ' +
    // Hai tool cùng chữ "skill" nên phải nói ngay chúng khác nhau chỗ nào, nếu không model chọn bừa.
    'For a task the user taught you (or asked you to remember as a step-by-step), use ' +
    'TOOL_CALL: create_workflow({"name":"Đặt hàng Shopee","description":"khi cần mua lại đơn cũ","instructions":"các bước"}) ' +
    "instead — that one shows up in the composer's `/` menu and only costs context when someone calls it, " +
    'and it can target another bot you own with "agent":"<name>" (a bot you just built gets its skills that way); ' +
    "while create_skill writes a file that rides EVERY later turn. " +
    "It lands in <available_skills> for every later conversation. Skills are procedures; " +
    "knowledge_base is for facts about the person."
  : "";

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
  "on selectors and do not go stale when a window moves. The screen is SHARED between all bots on this box, and a desktop click lands in whatever window is frontmost — so read the screenshot and make sure what you see is YOUR page before acting; if it belongs to another task, stop and say so." +
  (desktopRecordConfigured()
    ? "\n\nDẠY VIỆC TRÊN MÁY: nếu người dùng muốn CHỈ cho bạn một việc ngoài trình duyệt, gọi "
      + "Nếu việc cần HIỂU chứ không chỉ lặp lại — nhiều bước, nhiều trang, có chỗ người dùng đổi ý — "
      + 'thì dùng đường VIDEO: TOOL_CALL: demo_start(), họ làm mẫu, xong thì TOOL_CALL: demo_stop(). '
      + "Kết quả trả về chính là bài hướng dẫn để bạn tự xem video và viết ra skill. "
      + 'TOOL_CALL: desktop_teach_start(), để họ tự làm trong khung máy tính, rồi khi họ báo xong thì gọi ' 
      + "TOOL_CALL: desktop_teach_stop() — nó lưu lại thành một routine. Trong lúc đang ghi, TUYỆT ĐỐI "
      + "không tự bấm hay gõ gì trên máy: thao tác của bạn cũng bị ghi vào bài dạy của họ."
    : "");

/**
 * Việc chạy song song.
 *
 * Chỉ nói khi thật sự đáng: ba việc độc lập chạy nối đuôi là ba lần chờ, còn một việc thì giao nền
 * rồi ngồi chờ ngay lập tức lại chậm hơn làm thẳng.
 */
/**
 * Các loại subagent — và vì sao phải liệt kê ở đây.
 *
 * `task_v2` nhận `subagent_type`, nhưng lời nhắc chưa bao giờ NÓI có những loại nào. Đo được
 * (e2e-today, 28/08): hỏi thẳng "có subagent nào soi ảnh/video không", bot trả lời **"Không, mình
 * không có subagent chuyên biệt kiểu 'soi ảnh'"** — và nó nói THẬT, vì nó không được cho biết.
 * Năm loại tồn tại trong `SUBAGENT_TYPES` mà model không gọi được loại nào ngoài mặc định.
 *
 * Sinh từ chính `SUBAGENT_TYPES` chứ không chép tay: thêm một loại mà quên sửa chuỗi ở đây là
 * quay lại đúng cái lỗi này, chỉ khác cái tên.
 */
const subagentTypeList = (): string =>
  Object.entries(SUBAGENT_TYPES).map(([k, v]) => `"${k}" (${v.label})`).join(", ");

const TASK_PROTOCOL =
  "\n\nVIỆC SONG SONG: khi có NHIỀU việc độc lập nhau, giao từng việc bằng " +
  'TOOL_CALL: task({"task_description":"…","task_title":"…","async":true}) — mỗi lệnh trả về một mã. ' +
  'Giao hết rồi gọi TOOL_CALL: await_task({"ids":["task-1","task-2"]}) một lần để lấy tất cả. ' +
  "Chỉ có MỘT việc thì đừng dùng async: giao nền rồi chờ ngay còn chậm hơn làm thẳng." +
  "\n\nGIAO CHO MỘT CHUYÊN GIA: một việc gọn nhưng ngốn nhiều bước đọc/nhìn thì giao cho subagent " +
  'bằng TOOL_CALL: task_v2({"subagent_type":"…","prompt":"…"}) — nó chạy trong cửa sổ ngữ cảnh RIÊNG ' +
  "và chỉ trả về kết luận, nên hội thoại chính không bị lấp bởi mấy chục bước trung gian. " +
  `Các loại dùng được: ${subagentTypeList()}. ` +
  "Chỉ dùng đúng những tên trên; không có tên nào hợp thì tự làm.";

/**
 * Máy THẬT của người dùng — tám tool `local_*`, và cách gọi chúng.
 *
 * Danh sách tên tool được sinh tự động từ `TOOLS`, nên `local_browser` đã có mặt ở đó từ lúc thêm
 * hàm. Nhưng CHỈ có tên. Bài học `create_routine` (28/08) đúng nguyên văn ở đây: model biết tool
 * tồn tại mà không biết gọi thế nào thì gần như chắc chắn nó sẽ không gọi. `local_shell` thì model
 * đoán ra được vì tham số hiển nhiên là `command`; `local_browser` có `viec`/`chu`/`o` — không ai
 * đoán ra.
 *
 * Chỉ phát khi thật sự có máy đang nối. Dạy một tool không dùng được là mời model hứa với người
 * dùng một việc rồi thất bại.
 */
const localProtocol = (): string => {
  const ds = connectedMachines();
  if (!ds.length) return "";
  const ten = ds.map((m) => m.label).join(", ");
  return "\n\nMÁY CỦA NGƯỜI DÙNG: bạn nối được vào máy tính THẬT của họ, ngoài máy của chính bạn. "
    + `Đang nối: ${ten}. `
    + 'TOOL_CALL: local_machines({}) — liệt kê. '
    + 'TOOL_CALL: local_shell({"command":"...","machine":"<tên máy>"}) — chạy lệnh; bỏ "machine" thì lấy máy vừa thấy gần nhất. '
    + 'TOOL_CALL: local_read({"path":"C:/..."}) — đọc một file. '
    + 'TOOL_CALL: local_write({"path":"C:/Users/<tên>/...","content":"..."}) — GHI một file chữ (ghi đè toàn bộ, tự tạo thư mục cha; chỉ trong thư mục người dùng). '
    + 'TOOL_CALL: local_shell_bg({"command":"..."}) — chạy lệnh NỀN sống qua lượt này (server, quay màn hình, tải lớn, việc quá 2 phút); trả shellId và file đầu ra, xem lại bằng local_read. '
    + "Lệnh nền không nhận được bàn phím — dùng cờ tự trả lời (-y, -NonInteractive) thay vì để nó hỏi. "
    + 'TOOL_CALL: local_copy_to_box({"path":"C:/Users/<tên>/Desktop/clip.mp4"}) — chép một tệp của họ (video, ảnh, bảng tính… tới 100 MB) lên máy của BẠN để xử lý bằng tool box; '
    + 'TOOL_CALL: local_copy_from_box({"boxPath":"ket-qua.mp4"}) — trả kết quả từ máy bạn về Desktop của họ. '
    + "Xử lý tệp nặng thì làm trên máy bạn rồi chép về, đừng cố làm bằng local_shell. "
    + 'TOOL_CALL: local_browser({"viec":"mo","url":"https://..."}) — mở trang trong CỬA SỔ CHROME RIÊNG của bạn trên máy đó; '
    + 'rồi {"viec":"doc"} để đọc chữ trên trang, {"viec":"bam","chu":"<chữ trên nút>"} để bấm, '
    + '{"viec":"go","o":"<tên ô>","chu":"...","enter":true} để điền, {"viec":"anh"} để chụp màn hình trang cho người dùng xem. '
    + "Cửa sổ ấy là hồ sơ riêng, KHÔNG có phiên đăng nhập sẵn của người dùng — cần đăng nhập thì bảo họ đăng nhập một lần trong chính cửa sổ đó. "
    + "Ba việc phải phân biệt: mở một trang bằng `local_shell` thì chỉ MỞ, không nhìn được vào trong; "
    + "muốn đọc hay bấm thì phải đi bằng `local_browser`. "
    + "Máy này là máy làm việc thật của người ta — mỗi lệnh đều hiện một thẻ xin phép, nên đừng rải lệnh thăm dò; "
    + "nghĩ trước rồi chạy đúng thứ cần.";
};

const toolProtocolFor = (owner: string): string =>
  toolProtocolBase() + PLUGIN_PROTOCOL + SKILL_WRITE_PROTOCOL + TEACH_PROTOCOL + desktopProtocol() + localProtocol() + TASK_PROTOCOL + mcpProtocolFor(owner);

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

  // Màn hình chỉ có một, và cú bấm rơi vào cửa sổ đang ở trên cùng — của bất kỳ bot nào. Giành
  // quyền trước khi chạm vào nó, kể cả để chụp: một tấm ảnh chụp giữa lúc bot khác đang làm sẽ
  // dẫn tới toạ độ đọc từ màn hình của người khác.
  const claim = claimDesktop(ctx.agentId);
  if (!claim.ok) {
    return `máy tính đang do bot ${claim.heldBy} dùng — chờ nó xong rồi thử lại, đừng bấm vào lúc này`
      + " (một cú bấm bây giờ sẽ rơi vào cửa sổ mà bot kia đang làm dở)";
  }
  // Vừa giành được máy thì kéo tab của chính bot này lên trước. Không có bước này, `browser_navigate`
  // lái tab qua CDP mà tab vẫn nằm sau tab của bot khác — và bot đứng chụp màn hình của người khác
  // rồi bấm vào đó. Đo được đúng như vậy: bot báo "tab data:text/html vẫn còn nhưng không phải tab
  // đang hiển thị", ngay sau khi chụp nhầm trang Shopee của một bot khác.
  if (claim.fresh) {
    // …nhưng CHỈ khi thứ đang ở trên cùng là Chrome. Kéo tab lên trong khi một app gốc đang mở là
    // che mất chính cái app bot cần dùng — đo được đúng như vậy: bot chụp màn hình rồi báo "trên
    // màn hình không có hộp thoại xmessage nào, màn hình hiện tại là cửa sổ Chrome", vì tab vừa
    // bị kéo lên đè lên hộp thoại. Không đọc được cửa sổ nào đang trên cùng thì kéo, vì trên box
    // này Chrome là thứ gần như luôn ở đó.
    const front = await desktopAct({ action: "active_window" });
    const cls = String(front.wmClass ?? "").toLowerCase();
    if (!front.ok || cls === "" || cls.includes("chrom")) await activateTabOf(ctx.agentId);
  }

  const r = await desktopAct(parsed);
  if (!r.ok) return `computer_use ${parsed.action} lỗi: ${r.error ?? "không rõ"}`;

  // Kênh `computer-action` của client: host gốc phát mỗi hành động ra đó, phẳng cạnh agentId.
  // Phát SAU khi biết nó thành công — báo một cú bấm chưa xảy ra thì pane kể một câu chuyện sai.
  publish({ type: "computer.action", agentId: ctx.agentId, action: { ...parsed } as Record<string, unknown> });

  // Into the transcript for the person AND in front of the model for the next turn. Only the first
  // half existed at first, and it made the whole feature a mime show: the bot clicked by
  // coordinate, attached a picture, and read back the words "đã chụp màn hình 1920x1080".
  /*
   * Model LUÔN được nhìn; bản ghi thì có luật.
   *
   * Hai người đọc, hai nhu cầu khác hẳn. `see` rẻ và pool chỉ chở một ảnh mỗi request nên chụp
   * mọi bước chẳng tốn gì. `attach` thì mỗi tấm nằm lại vĩnh viễn trong bản ghi người đọc — và
   * sáu thao tác thành sáu tấm trong một bong bóng chat, đúng thứ người dùng hỏi ngày 30/08.
   *
   * Luật nằm ở `nenDinhAnh` (tấm đầu · hành động hỏng · màn hình đổi đáng kể), có test riêng.
   */
  const show = (b64: string, alt: string, ket: { ok: boolean }) => {
    const dataUrl = `data:image/jpeg;base64,${b64}`;
    if (nenDinhAnh(ctx.agentId, b64, ket)) ctx.attach(dataUrl, "screen.jpg", alt);
    ctx.see(dataUrl);
  };

  if (parsed.action === "screenshot") {
    // Model tự gọi screenshot là nó CHỦ ĐỘNG muốn cho xem — không lọc, và lấy luôn làm mốc mới.
    if (r.imageBase64) {
      quenManHinh(ctx.agentId);
      show(r.imageBase64, "màn hình máy tính của bot", { ok: true });
    }
    return `đã chụp màn hình ${r.width}x${r.height}`;
  }
  if (parsed.action === "cursor_position") return `con trỏ đang ở (${r.x}, ${r.y})`;
  if (parsed.action === "screen_info") return `màn hình ${r.width}x${r.height}, ${r.dpi} DPI`;

  // Mọi action còn lại đều đổi màn hình. Chụp lại ngay thay vì trông chờ model tự nhớ: bước
  // "nhìn lại" chính là bước nó sẽ bỏ, và bỏ rồi thì hành động sau bấm mù.
  const after = await desktopAct({ action: "screenshot" });
  if (after.ok && after.imageBase64) show(after.imageBase64, `màn hình sau khi ${parsed.action}`, after);
  return `${parsed.action} xong`;
};

/**
 * Dạy một việc bằng cách LÀM trên desktop của box — giai đoạn 2 của kế hoạch computer-use.
 *
 * Hai tool thay vì một nút bấm: nút Teach của app gốc gọi bộ ghi trình duyệt, và ta không mượn tên
 * đó cho một bộ ghi khác. Người dùng đang nhìn khung VNC rồi, nên bảo bot "dạy tôi việc này" rồi
 * "xong rồi, lưu lại" là đường ngắn nhất — không phải dựng thêm giao diện nào.
 *
 * Bot KHÔNG được thao tác trong lúc ghi: XRecord thấy cả input do XTEST bơm vào, nên mỗi cú bấm
 * của bot cũng thành một bước trong bài dạy của người dùng.
 */
/*
 * Dạy việc bằng VIDEO — đường thứ ba, và là đường app gốc dùng.
 *
 * Hai bộ ghi kia bắt SỰ KIỆN (DOM hoặc X11) rồi backend tự dịch thành routine. Đường này quay màn
 * hình rồi giao cho chính con bot tự học: nó xem video, đối chiếu, rồi VIẾT ra skill. Bài học thành
 * văn bản đọc được và sửa được, và bắt được ý định chứ không chỉ chuỗi thao tác.
 *
 * Ảnh app gốc 01/09 cho thấy nó đi xa tới đâu — thứ chuỗi thao tác không làm được:
 *
 *     "Input là {query} (trong demo: nến thơm rồi Custom)."
 *     "spider hoodie gõ rồi xóa, không search."
 *
 * Nó tham số hoá được cái cần thay, và phân biệt được thao tác THẬT với thao tác bỏ dở. Bộ ghi sự
 * kiện chỉ thấy "gõ 13 ký tự rồi xoá 13 ký tự" và sẽ chép nguyên vào bài học.
 */
if (boxConfigured()) {
  TOOLS.demo_start = async (_arg, ctx) => {
    const r = await batDauQuayDemo(ctx.agentId);
    if (!r.ok) return `không quay được: ${r.lyDo}`;
    return "Đang quay màn hình máy tính của mình. Bạn cứ làm mẫu trong khung máy tính, xong thì nhắn"
      + " tôi một tiếng. Trong lúc quay tôi không tự bấm gì cả.";
  };
  TOOLS.demo_stop = async (arg, ctx) => {
    if (!dangQuayDemo()) return "không có bản ghi nào đang chạy";
    /*
     * Nhận "huỷ" bằng danh sách từ, KHÔNG bằng regex.
     *
     * Bản regex `(false|huỷ|huy|bỏ|bo)` thiếu ranh giới từ thì `demo_stop("xong rồi bot")` khớp
     * ngay ở chữ "bo" trong "bot" và vứt cả buổi dạy. Một buổi dạy mất vì một chữ khớp nhầm là
     * cái giá quá đắt cho một phép thử ngắn hơn ba dòng.
     */
    const loi = String(arg ?? "").toLowerCase();
    const huy = ["false", "huỷ", "huy bỏ", "bỏ", "khong luu", "không lưu"].some((t) => loi.includes(t));
    const r = await dungQuayDemo();
    if (!r) return "đã dừng, không có video nào";
    if (huy) return "đã dừng quay và bỏ bản ghi";
    // Trả về CHÍNH bài giao việc: bot đọc nó ngay trong kết quả tool và làm tiếp trong cùng lượt,
    // khỏi phải chờ một lượt nữa mới bắt đầu học.
    return tinGiaoBaiHoc(ctx.agentId, r.videoPath, r.giay);
  };
}

if (desktopRecordConfigured()) {
  TOOLS.desktop_teach_start = async (_arg, ctx) => {
    const s = await startDesktopRecording(ctx.agentId);
    if (s.state !== "recording") return "không bật được bản ghi trên máy tính của bot";
    return "Đang ghi thao tác trên màn hình. Hãy làm việc đó trong khung máy tính, xong thì nhắn tôi"
      + " một tiếng để tôi lưu lại. Trong lúc ghi tôi sẽ không tự bấm gì cả (bấm là nó ghi vào bài dạy).";
  };
  TOOLS.desktop_teach_stop = async (arg) => {
    const save = !/["\s:]?(false|huỷ|huy|bỏ|bo)\b/i.test(arg);
    const s = await stopDesktopTeach(save);
    if (!save) return "đã dừng ghi và bỏ bản ghi";
    // Nói ra CẢ HAI đường gọi lại. Người dạy xong muốn biết "giờ tôi bấm ở đâu để chạy lại", và
    // trước đây câu trả lời chỉ nhắc bảng Routines — trong khi đường tiện nhất là gõ `/` ngay tại
    // khung soạn, không phải rời cuộc trò chuyện đi tìm một bảng khác.
    if (s.saved) {
      return `đã lưu "${s.saved}" (${s.steps} bước) — gõ \`/\` trong khung soạn để chạy lại,`
        + " hoặc mở bảng Routines nếu muốn cho nó chạy theo lịch";
    }
    if (s.steps === 0) return "không ghi được thao tác nào nên không lưu gì";
    return "đã dừng ghi nhưng không lưu lại được";
  };
}

/**
 * `task` / `await_task` — giao nhiều việc cùng lúc rồi thu kết quả sau.
 *
 * `task_v2` ở trên đã giao việc cho subagent nhưng **đứng chờ**, nên ba việc là ba lần chờ nối
 * đuôi. Hai tool này là nửa còn lại, và hình dạng đối số chép từ hợp đồng của hãng:
 * `TaskParams{task_description, task_title, async}` và `AwaitTaskParams{ids}` (số nhiều).
 *
 * Việc nền vẫn hiện trong khay "đang chạy" của app: nó dùng chung sổ subagent, nên người dùng thấy
 * bot đang làm gì thay vì thấy bot im lặng.
 */
const taskSubagentType = (raw: unknown): string => {
  const t = String(raw ?? "").trim();
  return t && SUBAGENT_TYPES[t] ? t : "explore";
};

TOOLS.task = async (arg, ctx) => {
  let spec: any;
  try { spec = JSON.parse(arg); } catch { spec = { task_description: unquote(arg) }; }
  const description = String(spec?.task_description ?? spec?.description ?? spec?.prompt ?? spec?.task ?? "").trim();
  if (!description) {
    return 'task cần {"task_description":"việc cần làm","task_title":"tên ngắn","async":true}';
  }
  const title = String(spec?.task_title ?? spec?.title ?? description.split("\n")[0]).slice(0, 80);
  const type = taskSubagentType(spec?.subagent_type ?? spec?.type);
  const isAsync = spec?.async === true || spec?.async === "true";

  const runIt = async (): Promise<string> => {
    const subagentId = turnHooks.startSubagentRun(ctx.agentId, type, title);
    try {
      const out = await runSubagent(type, description, Object.keys(TOOLS), {
        runTool: async (name, toolArg) => {
          const fn = TOOLS[name];
          if (!fn) return `(không có công cụ ${name})`;
          try { return String(await fn(toolArg, ctx)); } catch (e) { return `lỗi: ${(e as Error).message}`; }
        },
        onStep: (text) => ctx.note(text),
      });
      turnHooks.finishSubagentRun(ctx.agentId, subagentId, out.startsWith("(") ? "error" : "done");
      return out;
    } catch (e) {
      turnHooks.finishSubagentRun(ctx.agentId, subagentId, "error");
      throw e;
    }
  };

  // Không có `async` thì chạy thẳng và trả kết quả — đúng nhánh `completed_task_result` của hãng.
  if (!isAsync) return runIt();

  const started = startTask(ctx.agentId, title, description, runIt, (t) => {
    // Báo vào hội thoại khi xong. Không có dòng này thì một việc nền kết thúc trong im lặng và
    // người dùng chỉ biết nếu model tình cờ nhớ gọi await_task.
    ctx.note(t.status === "done" ? `Việc nền "${t.title}" đã xong.` : `Việc nền "${t.title}" hỏng: ${t.result}`);
  });
  if ("error" in started) return started.error;
  return `đã giao việc nền "${title}", mã ${started.id}. Giao tiếp việc khác nếu cần, rồi gọi `
    + `TOOL_CALL: await_task({"ids":["${started.id}"]}) để lấy kết quả.`;
};

TOOLS.await_task = async (arg) => {
  let spec: any;
  try { spec = JSON.parse(arg); } catch { spec = { ids: [unquote(arg)] }; }
  const raw = spec?.ids ?? spec?.id ?? spec?.task_ids;
  const ids = (Array.isArray(raw) ? raw : [raw]).map((x) => String(x ?? "").trim()).filter(Boolean);
  if (!ids.length) return 'await_task cần {"ids":["task-1"]}';

  const { results, missing, stillRunning } = await awaitTasks(ids);
  const lines: string[] = [];
  for (const t of results) {
    lines.push(`— ${t.id} "${t.title}" (${t.status === "done" ? "xong" : "hỏng"}):\n${t.result ?? ""}`);
  }
  // Ba trạng thái, ba câu khác nhau. Gộp chúng lại là model tưởng một việc chưa chạy đã chạy xong.
  if (missing.length) lines.push(`— không có mã: ${missing.join(", ")} (kiểm lại mã task trả về lúc giao việc)`);
  if (stillRunning.length) lines.push(`— vẫn đang chạy: ${stillRunning.join(", ")} — gọi lại await_task sau`);
  return lines.join("\n\n") || "(không có gì để chờ)";
};

export { TOOLS, isKnownTool, isParallelSafe, toolProtocolFor };
