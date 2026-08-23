import "./style.css";
import * as api from "./api";
import type { AnimatedAvatar, BotMood } from "./avatar";
import { AVATAR_COLORS, AVATAR_EXPRESSIONS, AVATAR_SHAPES, TILE_INK, animateAvatar, botAvatarPng, botAvatarSvg, pickFor } from "./avatar";
import type { NativeAgent, NativeEntry, ComputerStatus, Routine, SidebarSection, Plugin } from "./api";
import { mdToHtml } from "./markdown";

const root = document.querySelector("#app")!;

const state = {
  agents: [] as NativeAgent[],
  selected: "" as string,
  entries: [] as NativeEntry[],
  computer: null as ComputerStatus | null,
  busy: false,
  error: "",
  pending: [] as { path: string; name: string; href: string }[],
  showHidden: false,
  /** Bộ lọc của ô Search trong sidebar; app gốc có ô này nên roster phải lọc được. */
  query: "",
  /** Nhóm sidebar từ /v1/host/sidebar; rỗng ⇒ hiện phẳng như trước. */
  sections: [] as SidebarSection[],
  /**
   * Panel phải đang mở hay không (nút `Close details` của app gốc).
   * Chưa lưu xuống backend — việc đó thuộc B3 (`/v1/host/settings`), nên đóng app là mất.
   */
  paneOpen: true,
  /** Menu tài khoản ở đáy sidebar (app gốc: `Open account menu`). */
  accountOpen: false,
  /** Panel Plugins (X5.4). `plugins: null` = chưa tải lần nào — phân biệt với marketplace rỗng. */
  pluginsOpen: false,
  plugins: null as Plugin[] | null,
  /** Ô Search: app gốc để nó là NÚT, bấm mới thành ô nhập — nên trạng thái này là của họ, không phải của tôi. */
  searchOpen: false,
  /**
   * Nhóm đang gập, theo tên nhóm.
   *
   * Đo được ở app gốc: số đếm bên phải nhãn nhóm CHỈ hiện khi nhóm đang gập (`BOT HTML 1` với
   * `aria-expanded=false`), còn nhóm đang mở thì không có số. Nên số đếm và việc gập là một tính
   * năng, không phải hai.
   */
  collapsed: new Set<string>(),
  /**
   * Bố cục người dùng tự chỉnh, lấy từ `/v1/host/settings` (theo từng tài khoản, kẹp ở backend
   * theo ngưỡng đo được ở app gốc). Mặc định là số đang dùng trước khi có route này.
   */
  ui: { sidebarWidth: 261, sidebarCollapsed: false, paneWidth: 357 },
  /**
   * Panel phải là một STACK điều hướng, không phải một khối tĩnh — đo được ở app gốc:
   * `sand-info-pane__nav-root` + `__back` + `__subpage-title`, bấm `View Bot settings` đẩy vào trang
   * con, `Back to details` pop ra, ra/vào 240ms.
   */
  panePage: "details" as "details" | "settings",
  /** Routine của bot đang chọn (X5.1). Nạp cùng lúc với transcript. */
  routines: [] as Routine[],
  /**
   * Kết quả `/v1/search` (X5.2). `null` = chưa hỏi backend lần nào cho từ khoá hiện tại.
   *
   * Lọc ở FE chỉ so được TÊN; backend so cả nội dung transcript. Nên gõ "hoá đơn" mà bot tên
   * "Kế toán" từng nói về hoá đơn thì chỉ backend tìm ra.
   */
  hits: null as { agentId: string; why: "name" | "transcript" }[] | null,
  /**
   * Nội dung ô nhập.
   *
   * Phải nằm trong state vì nút gửi CHỈ hiện khi có chữ — đọc từ ảnh app gốc: ô trống thì bên phải
   * chỉ có mic. Không giữ ở state thì không biết khi nào cho nút hiện.
   */
  draft: "",
};

/**
 * Nút mic — đọc để nhập, dùng Web Speech API của trình duyệt.
 *
 * App gốc có `Start voice input`. Vẽ một cái nút bấm vào không làm gì thì tệ hơn là không vẽ, nên
 * nút này CHỈ xuất hiện khi trình duyệt thật sự hỗ trợ; Firefox không có thì không có nút.
 *
 * Không gửi tiếng ra ngoài backend của mình: nhận dạng chạy ở phía trình duyệt.
 */
type SpeechCtor = new () => {
  lang: string; continuous: boolean; interimResults: boolean;
  start(): void; stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>>; resultIndex: number }) => void) | null;
  onend: (() => void) | null;
};
const SPEECH: SpeechCtor | undefined =
  (window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor }).SpeechRecognition
  ?? (window as unknown as { webkitSpeechRecognition?: SpeechCtor }).webkitSpeechRecognition;
const SPEECH_OK = Boolean(SPEECH);
let dictation: InstanceType<SpeechCtor> | null = null;

function toggleDictation(btn: HTMLButtonElement): void {
  if (dictation) { dictation.stop(); return; }
  if (!SPEECH) return;
  const box = root.querySelector<HTMLTextAreaElement>("textarea");
  if (!box) return;
  const rec = new SPEECH();
  rec.lang = "vi-VN";
  rec.continuous = true;
  rec.interimResults = false;
  rec.onresult = (ev) => {
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const text = ev.results[i]?.[0]?.transcript ?? "";
      if (text) box.value = `${box.value}${box.value && !box.value.endsWith(" ") ? " " : ""}${text.trim()}`;
    }
  };
  // `onend` bắn cả khi tự hết thời gian, không chỉ khi bấm dừng — nên trạng thái nút reset ở đây.
  rec.onend = () => { dictation = null; btn.classList.remove("on"); };
  dictation = rec;
  btn.classList.add("on");
  rec.start();
}

let closeMenusBound = false;

/**
 * Mọi avatar đang sống trên màn hình.
 *
 * `paint()` dựng lại cả cây DOM, nên phần tử chúng bám vào chết theo mỗi lượt vẽ. Giữ danh sách ở
 * đây để `stop()` hết bản cũ trước khi tạo bản mới; không làm vậy thì mỗi lượt vẽ bỏ lại một loạt
 * engine vẽ vào node đã rời DOM.
 */
let liveAvatars: AnimatedAvatar[] = [];

/** Bot đang làm gì, dịch sang trạng thái của engine. */
function moodOf(a: NativeAgent | undefined): BotMood {
  if (!a) return "idle";
  if (a.presence.isRunning) return "thinking";
  if (a.unread) return "notify";
  return "idle";
}

const el = (html: string) => {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
};

function preview(a: NativeAgent): string {
  if (a.presence.isRunning) return "đang chạy…";
  if (a.lastEntry?.kind === "text") return a.lastEntry.text ?? "";
  if (a.lastEntry?.kind === "attachment") return "ảnh";
  return a.description || "chưa có tin";
}

function optionValue(o: { label: string; value?: string }): string {
  return o.value ?? o.label;
}

function renderWidget(e: NativeEntry): HTMLElement {
  const w = e.widget;
  const answered = e.respondedValue != null && e.respondedValue !== "";
  const card = el(`<article class="widget-card ${answered ? "answered" : "pending"}">
    <header><strong>Câu hỏi</strong><span>${answered ? "đã trả lời" : "chờ bạn"}</span></header>
    <p class="prompt">${escapeHtml(w?.prompt || e.content || "")}</p>
  </article>`);
  if (w?.helpText) card.append(el(`<p class="help">${escapeHtml(w.helpText)}</p>`));
  if (answered) {
    const chosen = w?.options.find((o) => optionValue(o) === e.respondedValue);
    card.append(el(`<p class="picked">đã chọn: ${escapeHtml(chosen?.label ?? e.respondedValue ?? "")}</p>`));
    return card;
  }
  const actions = el(`<div class="actions"></div>`);
  const entryId = e.id;
  for (const o of w?.options ?? []) {
    const btn = el(`<button type="button" class="${o.style === "danger" ? "danger" : o.style === "primary" ? "" : "ghost"}">${escapeHtml(o.label)}</button>`);
    if (o.description) btn.title = o.description;
    const value = optionValue(o);
    btn.onclick = () => void api.respondToWidget(state.selected, entryId, value).then(() => {
      state.error = "";
      return loadTranscript();
    }).catch((err) => {
      state.error = err instanceof Error ? err.message : String(err);
      paint();
    });
    actions.append(btn);
  }
  card.append(actions);
  if (w?.allowCustom) {
    const custom = el(`<form class="custom"><input type="text" placeholder="trả lời khác…" /><button type="submit">gửi</button></form>`);
    custom.onsubmit = (ev) => {
      ev.preventDefault();
      const box = custom.querySelector("input")!;
      const value = box.value.trim();
      if (!value) return;
      void api.respondToWidget(state.selected, entryId, value).then(() => {
        state.error = "";
        return loadTranscript();
      }).catch((err) => {
        state.error = err instanceof Error ? err.message : String(err);
        paint();
      });
    };
    card.append(custom);
  }
  return card;
}

function renderEntry(e: NativeEntry): HTMLElement {
  if (e.kind === "event") {
    /*
     * Sự kiện hệ thống là một CHIP, không phải một dòng chữ xám giữa màn hình — app gốc dùng
     * `sand-kit-system-event__chip`. Và `event` là union hai nhánh trong hợp đồng, nên nhánh
     * `automation-changed` phải đọc được thay vì in ra chữ "automation-changed".
     */
    const ev = e.event;
    const label = ev?.type === "name-changed"
      ? `Đổi tên: ${ev.from} → ${ev.to}`
      : ev?.type === "automation-changed"
        ? `Routine ${ev.action === "created" ? "đã tạo" : ev.action === "deleted" ? "đã xoá" : "đã đổi"}: ${ev.automationName}`
        // Union đã cạn hai nhánh, nên ở đây `ev` chỉ còn `undefined` — đọc `.type` là vô nghĩa.
        : "sự kiện";
    return el(`<div class="event"><span class="chip">${escapeHtml(label)}</span></div>`);
  }
  if (e.kind === "widget") return renderWidget(e);
  if (e.kind === "tool-call") {
    const card = el(`<article class="tool-card ${e.status ?? ""} ${e.needsApproval && e.status === "pending" ? "pending" : ""}">
      <header>
        <strong>${escapeHtml(e.name ?? "tool")}</strong>
        ${e.status === "running"
          ? `<span class="run-dots" aria-label="đang chạy"><i></i><i></i><i></i></span>`
          : `<span class="tag">${escapeHtml(e.status ?? "")}</span>`}
      </header>
      ${(e.summary || e.result) ? `<pre>${escapeHtml(e.summary || e.result || "")}</pre>` : ""}
    </article>`);
    if (e.status === "pending" && e.requestId) {
      const hint = el(`<p class="ask">Công cụ này có thể ghi lên máy. Cho phép một lần?</p>`);
      const actions = el(`<div class="actions"></div>`);
      const allow = el(`<button type="button">Allow</button>`);
      const deny = el(`<button type="button" class="ghost">Deny</button>`);
      const requestId = e.requestId;
      allow.onclick = () => void api.resolvePermission(state.selected, requestId, true).then(loadTranscript);
      deny.onclick = () => void api.resolvePermission(state.selected, requestId, false).then(loadTranscript);
      card.append(hint, actions);
      actions.append(allow, deny);
    }
    return card;
  }
  const who = e.kind === "message" ? "bạn" : (e.author?.name ?? "bot");
  const cls = e.kind === "message" ? "user" : "agent";
  const streaming = e.kind === "agent-message" && e.isStreaming ? " streaming" : "";
  /*
   * Bubble trần: KHÔNG có tên tác giả, KHÔNG có avatar.
   *
   * Hai thứ đó thuộc về *lượt nói* chứ không thuộc về từng tin — app gốc gom các tin liên tiếp
   * cùng một người vào `sand-author-run`, đặt tên một lần ở đầu và avatar một lần ở máng bên
   * trái. Xem `renderRuns()`.
   */
  /*
   * Lúc bot đang nghĩ hoặc đang gọi tool, app gốc hiện BA CHẤM và KHÔNG có bubble quanh chúng —
   * đọc từ ảnh chụp app đang chạy. Bản trước của tôi là một bubble xám kèm con trỏ khối `▍`, tức
   * vẽ ra một bubble rỗng rồi nhấp nháy trong đó: sai cả hình lẫn ý (bubble rỗng ngụ ý "đã có tin",
   * ba chấm ngụ ý "đang tới").
   */
  if (streaming && !(e.content ?? "").trim()) {
    const dots = el(`<div class="thinking" role="status" aria-label="đang trả lời"><i></i><i></i><i></i></div>`);
    return dots;
  }
  const bubble = el(`<div class="bubble ${cls}${streaming}"></div>`);
  const wrap = (node: HTMLElement): HTMLElement => node;
  if (e.attachment?.href) {
    /**
     * Ảnh thì render `<img>`; mọi thứ khác là THẺ FILE.
     *
     * Trước đây mọi đính kèm đều thành `<img src=…>`, nên một file `.md` hiện ra thành icon ảnh
     * vỡ kèm tên file — đúng lỗi thấy trên màn hình. App gốc dùng thẻ có icon + tên + kích thước
     * + nút tải; ở đây dựng lại thẻ đó bằng markup của mình.
     */
    const name = e.attachment.name || "tệp";
    const isImage = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(name);
    if (isImage) {
      const img = document.createElement("img");
      img.className = "att";
      img.alt = name;
      img.src = e.attachment.href;
      // App gốc bọc ảnh trong nút `Open image full screen` — ảnh bấm được, không phải trang trí.
      const view = el(`<button type="button" class="att-open" aria-label="Open image full screen"></button>`);
      view.append(img);
      const href = e.attachment.href;
      view.onclick = (ev) => { ev.stopPropagation(); openLightbox(href, name); };
      bubble.append(view);
    } else {
      const ext = (name.split(".").pop() ?? "").slice(0, 4).toUpperCase();
      const card = el(`<a class="att-file" href="${escapeHtml(e.attachment.href)}" download target="_blank" rel="noreferrer">
        <span class="ext">${escapeHtml(ext || "FILE")}</span>
        <span class="fname">${escapeHtml(name)}</span>
        <span class="dl">↓</span>
      </a>`);
      bubble.append(card);
    }
  }
  if (e.content && !(e.attachment && e.content === e.attachment.name)) {
    if (cls === "agent") {
      /*
       * Bot nói markdown — app gốc render nó thật (đo qua CDP: trong bubble có <p>/<code>/<ul>,
       * code chip đỏ bo 4px). Tin của NGƯỜI DÙNG thì app để text trần, nên nhánh dưới giữ nguyên.
       * `mdToHtml` escape toàn bộ đầu vào trước khi thay thẻ — xem markdown.ts.
       */
      bubble.classList.add("md");
      bubble.insertAdjacentHTML("beforeend", mdToHtml(e.content));
    } else {
      bubble.append(document.createTextNode(e.content));
    }
  }
  bubble.append(reactionStrip(e), messageActions(e));
  return wrap(bubble);
}

/**
 * Reaction — có thật trong app gốc, không phải thứ mình nghĩ ra.
 *
 * Đo ngày 2026-08-22 qua CDP trên app đang chạy: hover một bubble thì hiện `div[role=toolbar]`
 * 76×24 với `aria-label="Message actions for <bot> message at <giờ> (<entryId>)"`, chứa ba nút
 * 24×24: `Add reaction`, `Reply to <bot> message`, `More message actions`.
 *
 * Ở đây làm **một** nút — reaction — vì đó là cái duy nhất backend có đường thật cho nó
 * (`reactToMessage`, một trong 120 lệnh, đã lưu toggle trên entry từ lâu). Reply và More chưa có
 * contract nào bên mình; vẽ ra hai nút bấm vào không làm gì thì tệ hơn là không vẽ.
 *
 * Bộ emoji ĐÚNG của hãng, đo ở X0.2 (`x-ray --menu`): hộp `Add reaction` 246×44 gồm sáu emoji
 * 👍 👎 ❤️ 😂 🎉 😮 cộng một mục `More emoji`. Ghi chú cũ ở đây từng nói "bộ của họ chưa đo được"
 * — sai: chính X0.2 đã đo rồi mà tôi dùng bộ tự chọn, tức có số đo trong tay mà không dùng.
 * `More emoji` bên họ mở picker đầy đủ của hệ; bên mình mở lưới mở rộng — nội dung lưới đó là
 * lựa chọn của mình, phần đo được là sáu emoji đầu và cấu trúc "6 + More".
 */
const REACTIONS = ["👍", "👎", "❤️", "😂", "🎉", "😮"];
const MORE_REACTIONS = ["🙏", "👀", "✅", "🚀", "😢", "😡", "🤔", "💯", "🔥", "🥳", "😴", "🤖"];

/** Tên tám hình. Id trong `bloub` là tiếng Pháp; nhãn hiện ra là tiếng Việt. */
const SHAPE_LABELS: Record<string, string> = {
  cercle: "Tròn", galet: "Cuội", squircle: "Vuông tròn", capsule: "Viên nhộng",
  triangle: "Tam giác", hexagone: "Lục giác", nuage: "Mây", goutte: "Giọt",
};

/**
 * Menu `More message actions` — app gốc chỉ có HAI mục: `Start a thread` và `Copy` (đo ở X0.2,
 * hộp 200×74). Nên đây là toàn bộ menu, không phải một tập con.
 *
 * `Tạo luồng` để `disabled` kèm lý do: luồng con cần một mô hình dữ liệu chưa tồn tại ở đâu —
 * `replyTo`/`threadId` không có trong hợp đồng lẫn backend. Vẽ ra một mục bấm vào không làm gì thì
 * tệ hơn một mục mờ nói rõ vì sao.
 */
function wireMoreMenu(bar: HTMLElement, e: NativeEntry): void {
  const more = bar.querySelector<HTMLElement>(".more-menu")!;
  const copyItem = el(`<button type="button" role="menuitem">Sao chép</button>`);
  copyItem.onclick = async (ev) => {
    ev.stopPropagation();
    more.hidden = true;
    try {
      await navigator.clipboard.writeText(e.content ?? "");
      state.error = "";
    } catch {
      // Clipboard bị chặn (không phải ngữ cảnh an toàn) — nói ra, đừng im lặng nuốt.
      state.error = "trình duyệt không cho ghi clipboard ở đây";
      paint();
    }
  };
  const threadItem = el(`<button type="button" role="menuitem" disabled title="Luồng con chưa dựng: replyTo/threadId chưa có ở hợp đồng lẫn backend">Tạo luồng</button>`);
  more.append(copyItem, threadItem);
  bar.querySelector<HTMLButtonElement>(".more")!.onclick = (ev) => {
    ev.stopPropagation();
    root.querySelectorAll<HTMLElement>(".react-menu, .more-menu").forEach((o) => { if (o !== more) o.hidden = true; });
    more.hidden = !more.hidden;
  };
}

/** Mười sáu biểu cảm, đúng thứ tự bảng của bloub. */
const EXPRESSION_LABELS: Record<string, string> = {
  neutre: "Bình thường", attentif: "Chú ý", surpris: "Ngạc nhiên", excite: "Phấn khích",
  heureux: "Vui", hilare: "Cười", colere: "Tức", triste: "Buồn",
  effraye: "Sợ", mefiant: "Ngờ vực", confus: "Bối rối", curieux: "Tò mò",
  fier: "Tự hào", timide: "Rụt rè", blase: "Chán", somnolent: "Buồn ngủ",
};

function reactionStrip(e: NativeEntry): HTMLElement {
  const strip = el(`<div class="reacts"></div>`);
  const counts = new Map<string, { n: number; mine: boolean }>();
  for (const r of e.reactions ?? []) {
    const cur = counts.get(r.emoji) ?? { n: 0, mine: false };
    counts.set(r.emoji, { n: cur.n + 1, mine: cur.mine || r.by === "me" });
  }
  if (!counts.size) strip.hidden = true;
  for (const [emoji, { n, mine }] of counts) {
    const chip = el(`<button type="button" class="react-chip${mine ? " mine" : ""}" title="${mine ? "bỏ reaction" : "cũng vậy"}">
      <span class="e">${escapeHtml(emoji)}</span><span class="n">${n}</span>
    </button>`);
    chip.onclick = () => void toggleReaction(e.id, emoji);
    strip.append(chip);
  }
  return strip;
}

function messageActions(e: NativeEntry): HTMLElement {
  const at = shortTime(e.timestampMs);
  const who = e.kind === "message" ? "bạn" : (e.author?.name ?? "bot");
  // `role="toolbar"` + nhãn mang theo giờ và id entry, đúng như thanh của app gốc: khi có nhiều
  // bubble giống nhau thì nhãn là thứ duy nhất phân biệt được cái nào đang hover.
  const bar = el(`<div class="msg-actions" role="toolbar" aria-label="Hành động cho tin của ${escapeHtml(who)} lúc ${escapeHtml(at)} (${escapeHtml(e.id)})">
    <button type="button" class="act" aria-label="Add reaction"></button>
    <div class="react-menu" hidden role="menu"></div>
    <button type="button" class="act reply" aria-label="Reply to ${escapeHtml(who)} message" title="Trả lời">↩</button>
    <button type="button" class="act more" aria-label="More message actions" title="Thêm">⋯</button>
    <div class="more-menu" hidden role="menu"></div>
  </div>`);
  const menu = bar.querySelector<HTMLElement>(".react-menu")!;
  const addPick = (host: HTMLElement, emoji: string) => {
    const pick = el(`<button type="button" role="menuitem" aria-label="reaction ${escapeHtml(emoji)}">${escapeHtml(emoji)}</button>`);
    pick.onclick = (ev) => { ev.stopPropagation(); menu.hidden = true; void toggleReaction(e.id, emoji); };
    host.append(pick);
  };
  for (const emoji of REACTIONS) addPick(menu, emoji);
  // `More emoji` — mục thứ bảy đúng như hộp 246×44 của app; bấm mở lưới mở rộng ngay trong menu.
  const moreEmoji = el(`<button type="button" role="menuitem" class="more-emoji" aria-label="More emoji">＋</button>`);
  const grid = el(`<div class="react-grid" hidden></div>`);
  for (const emoji of MORE_REACTIONS) addPick(grid, emoji);
  moreEmoji.onclick = (ev) => { ev.stopPropagation(); grid.hidden = !grid.hidden; };
  menu.append(moreEmoji, grid);
  wireMoreMenu(bar, e);

  /*
   * Trả lời = TRÍCH DẪN vào ô nhập, không phải luồng con.
   *
   * Không có `replyTo` ở backend thì một nút "trả lời" chỉ gắn cờ ở FE là thứ model không bao giờ
   * thấy — tức trang trí. Đưa trích dẫn vào chính nội dung tin thì model đọc được, và không phải
   * bịa ra một mô hình dữ liệu mà backend chưa honour được. Đây KHÔNG phải luồng con, và tài liệu
   * nói rõ như vậy.
   */
  bar.querySelector<HTMLButtonElement>(".reply")!.onclick = (ev) => {
    ev.stopPropagation();
    const quoted = (e.content ?? "").trim().split("\n").slice(0, 3).join(" ").slice(0, 160);
    if (!quoted) return;
    const head = `> ${who}: ${quoted}${(e.content ?? "").length > 160 ? "…" : ""}`;
    state.draft = state.draft.trim() ? `${head}\n\n${state.draft}` : `${head}\n\n`;
    paint();
    const box = root.querySelector<HTMLTextAreaElement>('textarea[name="q"]');
    if (box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
  };

  bar.querySelector<HTMLButtonElement>(".act")!.onclick = (ev) => {
    ev.stopPropagation();
    // Chỉ một menu mở tại một thời điểm.
    root.querySelectorAll<HTMLElement>(".react-menu, .more-menu").forEach((other) => { if (other !== menu) other.hidden = true; });
    menu.hidden = !menu.hidden;
  };
  return bar;
}

async function toggleReaction(entryId: string, emoji: string): Promise<void> {
  try {
    await api.reactToEntry(state.selected, entryId, emoji);
    state.error = "";
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
  }
  await loadTranscript();
}

/**
 * Gom các tin liên tiếp CÙNG một người thành một lượt nói, rồi vẽ.
 *
 * Đo trên app gốc (2026-08-22):
 *   `.sand-author-run`   máng 22px + khoảng 8px + cột nội dung
 *   `.sand-author-run__gutter`  22×22, avatar căn ĐÁY của lượt
 *   `.sand-group-author` tên 12px, thụt vào 6px, chỉ hiện MỘT lần ở đầu lượt
 *
 * Đuôi bubble (`…6px` góc dưới-trái) đi cùng "lượt có hiện tên", không phải "tin cuối lượt":
 * đo 5 bubble thật thì giả thiết "có tên" khớp 5/5, còn "tin cuối lượt" chỉ 2/5. Nói cách khác
 * đuôi đánh dấu **mở đầu** một lượt nói, chứ không phải kết thúc — nên nó nằm ở bubble ĐẦU.
 *
 * Thẻ công cụ / widget / event không thuộc lượt nào: chúng cắt lượt đang mở.
 */
/** Vỏ của một lượt nói: máng avatar bên trái, cột nội dung bên phải, nhãn tên chỉ ở lượt mở khối. */
function openRun(e: NativeEntry, mine: boolean, opensBlock: boolean): HTMLElement {
  const run = el(`<div class="run ${mine ? "mine" : "theirs"}${opensBlock ? " opens" : ""}"></div>`);
  const gutter = el(`<div class="run-gutter"></div>`);
  if (!mine && e.author) gutter.innerHTML = avatarOf({ id: e.author.id, name: e.author.name });
  const col = el(`<div class="run-col"></div>`);
  /*
   * Nhãn tên CHỈ cho lượt của bot. Đo trên app đang chạy (CDP, 2026-08-23): 12 lượt liên tiếp,
   * mọi `sand-group-author` đều mang tên bot, lượt của người dùng không có nhãn nào — chữ "bạn"
   * bên mình trước đây là thứ app gốc không có.
   */
  if (opensBlock && !mine) {
    /*
     * Nhãn tên là NÚT, không phải chữ trang trí — app gốc: `sand-group-author` mang
     * `aria-label="Open Claude's chat"`, bấm là mở chat của bot đó. Trong transcript một-bot thì
     * nó mở lại chính bot đang xem, nhưng hành vi phải giống app chứ không phải giống suy đoán.
     */
    const name = e.author?.name ?? "bot";
    const author = el(`<button type="button" class="run-author" aria-label="Open ${escapeHtml(name)}'s chat">${escapeHtml(name)}</button>`);
    const authorId = e.author?.id;
    if (authorId) author.onclick = () => selectBot(authorId);
    col.append(author);
  }
  run.append(gutter, col);
  run.dataset.entry = e.id;   // id của entry MỞ lượt: đủ để neo, và ổn định khi lượt dài thêm
  return run;
}

/**
 * Vạch thời gian giữa các tin — app gốc hiện "Today 4:47 AM" giữa hai tin cách nhau.
 *
 * Ngưỡng 30 phút chọn theo hành vi quan sát được, không phải đo: app gốc không hiện vạch giữa hai
 * tin liền nhau trong một lượt trò chuyện, nhưng có hiện khi quay lại sau một lúc. Khi mở lại app
 * bằng launcher F2 thì đo `x-ray` để chốt ngưỡng thật.
 */
const GAP_MS = 30 * 60 * 1000;

function stampFor(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `Hôm nay ${time}`;
  const yest = new Date(now.getTime() - 86_400_000);
  if (d.toDateString() === yest.toDateString()) return `Hôm qua ${time}`;
  return `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })} ${time}`;
}

/**
 * Entry đã từng render một lần — để `bubble-in` chỉ chạy cho tin MỚI.
 *
 * `paint()` dựng lại toàn bộ DOM, nên khi streaming (một sự kiện SSE mỗi chunk) mọi bubble đều là
 * node mới và animation vào (opacity từ 0) chạy lại trên CẢ transcript — đó chính là cú "nháy"
 * nhìn thấy được. Tin đã thấy rồi thì render tĩnh; chỉ tin lần đầu xuất hiện mới trượt vào.
 */
const renderedOnce = new Set<string>();
function markSeen(node: HTMLElement, id: string): void {
  if (renderedOnce.has(id)) node.classList.add("still");
  else renderedOnce.add(id);
}

function renderRuns(entries: NativeEntry[]): HTMLElement[] {
  const out: HTMLElement[] = [];
  let lastStampAt = 0;
  let run: HTMLElement | null = null;
  let runKey = "";
  /**
   * Người nói của lượt TRƯỚC, tính xuyên qua thẻ công cụ.
   *
   * Một thẻ công cụ cắt lượt (bubble sau nó không dồn vào lượt trước), nhưng app gốc KHÔNG in lại
   * tên: đo được 3 lượt liên tiếp cùng bot mà chỉ lượt đầu có tên. Và vì đuôi bubble đi cùng nhãn
   * tên (khớp 5/5), lượt tiếp nối cũng không có đuôi. Nên phải nhớ người nói qua cả dấu ngắt.
   */
  let lastSpeaker = "";

  for (const e of entries) {
    if (e.timestampMs && (lastStampAt === 0 || e.timestampMs - lastStampAt > GAP_MS)) {
      out.push(el(`<div class="day-sep"><span>${escapeHtml(stampFor(e.timestampMs))}</span></div>`));
      run = null; runKey = "";   // vạch cắt lượt: tin sau nó mở lượt mới, có nhãn tên
    }
    if (e.timestampMs) lastStampAt = e.timestampMs;
    const isMsg = e.kind === "message" || e.kind === "agent-message";
    if (!isMsg) {
      run = null; runKey = "";
      const solo = renderEntry(e);
      solo.dataset.entry = e.id;   // neo cuộn bám vào đây, xem `captureAnchor`
      markSeen(solo, e.id);
      out.push(solo);
      continue;
    }

    const mine = e.kind === "message";
    const key = mine ? "me" : `bot:${e.author?.id ?? "?"}`;
    if (key !== runKey) {
      const opensBlock = key !== lastSpeaker;
      runKey = key;
      lastSpeaker = key;
      run = openRun(e, mine, opensBlock);
      out.push(run);
    }
    const col = run!.querySelector(".run-col")!;
    const node = renderEntry(e);
    // Đuôi chỉ ở bubble đầu của một lượt MỞ ĐẦU khối — cùng điều kiện với nhãn tên.
    if (run!.classList.contains("opens") && col.querySelectorAll(".bubble").length === 0) {
      node.classList.add("first");
    }
    node.dataset.entry = e.id;
    markSeen(node, e.id);
    /*
     * Giờ theo từng hàng — app gốc: `sand-row-timestamp` 12px màu `rgba(252,252,252,.4)`,
     * `opacity: 0` mặc định, hiện khi hover hàng, đứng ở mép PHẢI của hàng (đo qua CDP).
     * Phía hiện của mình: lượt của mình thì bubble đã ở mép phải nên giờ đứng mép trái — app
     * đặt ở đâu cho lượt của mình chưa đo được, đây là suy đoán có ghi lại.
     */
    const erow = el(`<div class="erow"></div>`);
    erow.append(node);
    if (e.timestampMs) erow.append(el(`<time class="row-time">${escapeHtml(shortTime(e.timestampMs))}</time>`));
    col.append(erow);
  }
  return out;
}

/**
 * Ảnh mở TOÀN MÀN HÌNH — map nút `Open image full screen` của app gốc. Overlay gắn lên `<body>`
 * nên sống qua `paint()`; nền mờ `rgba(0,0,0,.5)` là số đo từ chính `ui-dialog-backdrop` của họ.
 * Esc hoặc bấm bất kỳ đâu để đóng.
 */
function openLightbox(href: string, name: string): void {
  document.getElementById("gb2-lightbox")?.remove();
  const box = document.createElement("div");
  box.id = "gb2-lightbox";
  box.className = "lightbox";
  box.innerHTML = `<img src="${escapeHtml(href)}" alt="${escapeHtml(name)}">`;
  const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") close(); };
  const close = () => { box.remove(); document.removeEventListener("keydown", onKey); };
  box.onclick = close;
  document.addEventListener("keydown", onKey);
  document.body.append(box);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

/**
 * Avatar và nhãn thời gian.
 *
 * App gốc dùng ảnh avatar và một font icon riêng của hãng; cả hai là asset không được copy
 * (docs/extracted/ui-design-spec.md §"Phần thuộc hãng"). Thay bằng initials trên một màu suy
 * ra từ id — cùng bot thì luôn cùng màu, không cần lưu gì thêm.
 */
function initialsOf(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] ?? "").join("").toUpperCase() || "?";
}

/**
 * Ảnh cần tải, và ảnh đã biết là không có.
 *
 * `paint()` là hàm đồng bộ nên nó không tải ảnh được; nó ghi ra đây rồi cuối `paint()` gọi
 * `fetchWantedAvatars()`, tải xong mới vẽ lại. `avatarMissing` là phần chống lặp: nếu route trả
 * 404 mà không nhớ, mỗi lần vẽ lại là thêm một lượt fetch thất bại nữa.
 */
const avatarWanted = new Set<string>();
const avatarMissing = new Set<string>();
let avatarFetching = false;

async function fetchWantedAvatars(): Promise<void> {
  if (avatarFetching || !avatarWanted.size) return;
  avatarFetching = true;
  const keys = [...avatarWanted];
  avatarWanted.clear();
  let got = false;
  for (const k of keys) {
    const at = k.lastIndexOf("@");
    const url = await api.loadAvatar(k.slice(0, at), k.slice(at + 1)).catch(() => null);
    if (url) got = true;
    else avatarMissing.add(k);
  }
  avatarFetching = false;
  if (got) paint();
}

function avatarOf(a: { id: string; name: string }): string {
  const version = state.agents.find((x) => x.id === a.id)?.avatarVersion ?? null;
  if (version) {
    const key = `${a.id}@${version}`;
    const url = api.cachedAvatar(a.id, version);
    if (url) return `<img class="avatar" alt="" src="${escapeHtml(url)}" />`;
    if (!avatarMissing.has(key)) avatarWanted.add(key);
  }
  // Không có ảnh riêng ⇒ mặt bloub suy từ id: cùng bot thì luôn cùng hình/biểu cảm/màu,
  // không lưu gì thêm. `title` giữ lại tên vì mặt bot không nói được bot nào.
  // `data-bot` để sau khi vẽ xong còn tìm lại mà gắn animation — `paint()` trả về chuỗi HTML,
  // không trả về phần tử.
  return `<span class="avatar face" data-bot="${escapeHtml(a.id)}" title="${escapeHtml(a.name)}">${botAvatarSvg(a.id)}</span>`;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

function openAvatarPicker(a: NativeAgent): void {
  const back = el(`<div class="modal-back">
    <div class="modal" role="dialog" aria-modal="true" aria-label="Ảnh của ${escapeHtml(a.name)}">
      <header><strong>Ảnh của ${escapeHtml(a.name)}</strong><button type="button" class="x" aria-label="đóng">×</button></header>
      <div class="preview"></div>
      <p class="pick-label">Hình</p>
      <div class="shapes"></div>
      <p class="pick-label">Biểu cảm</p>
      <div class="faces"></div>
      <p class="pick-label">Màu</p>
      <div class="swatches"></div>
      <p class="hint">Chọn hình và màu rồi bấm Lưu, hoặc nạp ảnh riêng — PNG/JPEG/WebP/GIF, tối đa 256 KB.</p>
      <div class="modal-actions">
        <button type="button" class="primary" data-act="save">Lưu</button>
        <label class="up">Nạp ảnh…<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden /></label>
        <button type="button" class="ghost" data-act="reset">Về mặc định</button>
      </div>
      <p class="modal-err" hidden></p>
    </div>
  </div>`);

  const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") close(); };
  const close = () => { document.removeEventListener("keydown", onKey); back.remove(); };
  document.addEventListener("keydown", onKey);
  back.onclick = (ev) => { if (ev.target === back) close(); };
  back.querySelector<HTMLButtonElement>(".x")!.onclick = close;

  const errBox = back.querySelector<HTMLElement>(".modal-err")!;
  const fail = (e: unknown) => {
    errBox.hidden = false;
    errBox.textContent = e instanceof Error ? e.message : String(e);
  };
  const done = async () => { close(); await refreshRoster(); };

  /*
   * Trạng thái đang xem trước. Bắt đầu từ đúng thứ id của bot suy ra, nên mở bộ chọn ra là thấy
   * cái đang hiện, không phải một mặc định lạ.
   */
  const pick = pickFor(a.id);
  let shapeId: string = AVATAR_SHAPES[pick.shape % AVATAR_SHAPES.length]!;
  let expressionId: string = AVATAR_EXPRESSIONS[pick.expression % AVATAR_EXPRESSIONS.length]!;
  let colorHex: string = AVATAR_COLORS[pick.color % AVATAR_COLORS.length]!;

  const shapes = back.querySelector(".shapes")!;
  const faces = back.querySelector(".faces")!;
  const swatches = back.querySelector(".swatches")!;

  const preview = back.querySelector<HTMLElement>(".preview")!;

  const redraw = () => {
    preview.innerHTML = botAvatarSvg(a.id, { shapeId, expressionId, colorHex });
    /*
     * Ô hình và ô biểu cảm luôn vẽ bằng mực, không theo màu đang chọn — đúng cách bloub làm. Vẽ
     * theo màu đang chọn thì chọn `crème` là cả hai bảng trắng xoá, không còn thấy hình nào.
     */
    shapes.querySelectorAll<HTMLElement>("button").forEach((b) => {
      b.classList.toggle("on", b.dataset.shape === shapeId);
      const art = b.querySelector<HTMLElement>(".art");
      if (art) art.innerHTML = botAvatarSvg(a.id, { shapeId: b.dataset.shape, expressionId, colorHex: TILE_INK });
    });
    faces.querySelectorAll<HTMLElement>("button").forEach((b) => {
      b.classList.toggle("on", b.dataset.expression === expressionId);
      const art = b.querySelector<HTMLElement>(".art");
      if (art) art.innerHTML = botAvatarSvg(a.id, { shapeId, expressionId: b.dataset.expression, colorHex: TILE_INK });
    });
    swatches.querySelectorAll<HTMLElement>("button").forEach((b) => {
      b.classList.toggle("on", b.dataset.color === colorHex);
    });
  };

  /**
   * Bấm hình/màu chỉ đổi XEM TRƯỚC. Ghi chỉ xảy ra khi bấm Lưu.
   *
   * Bản đầu ghi ngay mỗi cú bấm — tiện, nhưng nghĩa là một cú bấm lạc vào bộ chọn là sửa vĩnh viễn
   * avatar của một con bot thật, không hỏi, không hoàn lại được ngoài "Về mặc định". Ngày
   * 2026-08-22 có đúng một avatar bị ghi vào `Marketing Lead` mà không truy được lệnh nào gây ra;
   * dù nguyên nhân là gì, một bộ chọn mà mở ra là có thể ghi thì bản thân nó đã sai. Đóng bộ chọn
   * (X, Escape, bấm ra ngoài) giờ luôn là KHÔNG đổi gì.
   */
  const save = async () => {
    try { await api.putAvatar(a.id, await botAvatarPng(a.id, { shapeId, expressionId, colorHex })); await done(); }
    catch (e) { fail(e); }
  };

  for (const id of AVATAR_SHAPES) {
    const b = el(`<button type="button" class="shape" data-shape="${escapeHtml(id)}" aria-label="hình ${escapeHtml(id)}"><span class="art"></span><span class="lbl">${escapeHtml(SHAPE_LABELS[id] ?? id)}</span></button>`);
    b.onclick = () => { shapeId = id; redraw(); };
    shapes.append(b);
  }
  for (const id of AVATAR_EXPRESSIONS) {
    const b = el(`<button type="button" class="shape" data-expression="${escapeHtml(id)}" aria-label="biểu cảm ${escapeHtml(id)}"><span class="art"></span><span class="lbl">${escapeHtml(EXPRESSION_LABELS[id] ?? id)}</span></button>`);
    b.onclick = () => { expressionId = id; redraw(); };
    faces.append(b);
  }
  for (const hex of AVATAR_COLORS) {
    const b = el(`<button type="button" class="swatch" data-color="${hex}" style="background:${hex}" aria-label="màu ${hex}"></button>`);
    b.onclick = () => { colorHex = hex; redraw(); };
    swatches.append(b);
  }
  redraw();

  back.querySelector<HTMLButtonElement>("[data-act=save]")!.onclick = () => void save();

  back.querySelector<HTMLInputElement>("input[type=file]")!.onchange = async (ev) => {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try { await api.putAvatar(a.id, await readAsDataUrl(file)); await done(); }
    catch (e) { fail(e); }
  };

  back.querySelector<HTMLButtonElement>("[data-act=reset]")!.onclick = async () => {
    try { await api.deleteAvatar(a.id); await done(); }
    catch (e) { fail(e); }
  };

  document.body.append(back);
}

/** Giờ ngắn như app gốc ("10:34 AM"); chỉ hiện khi có mốc thời gian thật. */
function shortTime(ms?: number | null): string {
  if (!ms) return "";
  return new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/**
 * Ba trạng thái, không phải hai.
 *
 * `state: "off"` đến từ hai chỗ trái ngược nhau — chưa cấu hình `GROKBOT2_VNC_URL`, hoặc đã cấu
 * hình mà lúc này không bot nào chiếm màn hình (`session.ts` chỉ bật `running` khi có `beginUse`
 * hoặc có handoff). Trước đây cả hai đều hiện "Chưa có VNC", tức nói sai với người đã cấu hình
 * đúng và đẩy họ đi sửa thứ không hỏng.
 */
function screenPane(c: ComputerStatus | null): string {
  if (c?.vncUrl) return `<iframe title="computer" src="${escapeHtml(c.vncUrl)}"></iframe>`;
  if (c?.screenConfigured) return `<div class="off"><span class="mon">▭</span><br>Màn hình đang tắt.<br><small>Sẽ hiện khi bot dùng tới máy.</small></div>`;
  return `<div class="off">Chưa cấu hình màn hình.<br><small>Gán <code>GROKBOT2_VNC_URL</code> rồi khởi động lại service computer.</small></div>`;
}

/* ── X2: kéo đổi bề rộng, có NGƯỠNG SNAP ─────────────────────────────────────
 *
 * Đo được ở app gốc (`x-ray --drag`), và nó phủ định cách dựng thông thường:
 *
 *   dx=+10 … +120   rows=63   ← kéo mà KHÔNG có gì xảy ra: vùng chết
 *   dx=+240         rows=302  ← nhảy một nhịp
 *   dx=+400         rows=375  ← kẹp
 *
 * Nên rail KHÔNG giãn dần thành panel. Dựng bằng `minSize` của một thư viện panel sẽ ra hành vi
 * giãn dần — sai. Ở đây: đang rail thì phải kéo qua SNAP_IN mới mở; đang mở thì kéo xuống dưới
 * SNAP_OUT là gập về rail. Panel phải cũng vậy, và kéo dưới mức tối thiểu thì nó ĐÓNG hẳn — cũng
 * là hành vi đo được, không phải tôi tự nghĩ.
 */
const RAIL_W = 88;          // rail của app gốc: 88px
const SIDEBAR_MIN = 200;    // dưới mức này thì gập về rail thay vì co tiếp
const SIDEBAR_MAX = 400;
const SNAP_IN = 200;        // đang rail: phải kéo tới đây mới mở (vùng chết ~200px)
const PANE_MIN = 280;
const PANE_MAX = 480;

const applyWidths = (): void => {
  const s = document.documentElement.style;
  s.setProperty("--sidebar-w", `${state.ui.sidebarCollapsed ? RAIL_W : state.ui.sidebarWidth}px`);
  s.setProperty("--panel-w", `${state.ui.paneWidth}px`);
};

/** Ghi bố cục lên backend, gộp nhịp: kéo chuột sinh hàng trăm sự kiện, đừng biến thành hàng trăm PATCH. */
let saveTimer: number | undefined;
const saveUi = (): void => {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    void api.patchHostSettings({
      sidebarWidth: state.ui.sidebarWidth,
      sidebarCollapsed: state.ui.sidebarCollapsed,
      paneWidth: state.ui.paneWidth,
      paneOpen: state.paneOpen,
    }).catch(() => { /* bố cục mất khi mở lại thì chịu; không chặn app vì chuyện đó */ });
  }, 400);
};

/**
 * Nối một thanh chia.
 *
 * Dùng pointer capture: kéo ra ngoài cửa sổ rồi nhả thì vẫn nhận được `pointerup`. Không dùng
 * `paint()` trong lúc kéo — vẽ lại cả cây DOM 60 lần/giây thì tay và hình lệch nhau; chỉ đổi biến
 * CSS, và `paint()` một lần khi nhả.
 */
function wireHandle(node: HTMLElement, kind: "sidebar" | "pane"): void {
  node.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    node.setPointerCapture(ev.pointerId);
    document.body.classList.add("dragging");
    const startX = ev.clientX;
    const from = kind === "sidebar"
      ? (state.ui.sidebarCollapsed ? RAIL_W : state.ui.sidebarWidth)
      : state.ui.paneWidth;

    const move = (e: PointerEvent) => {
      const dx = e.clientX - startX;
      if (kind === "sidebar") {
        if (state.ui.sidebarCollapsed) {
          // vùng chết: chưa qua SNAP_IN thì không đổi gì cả
          if (dx < SNAP_IN) return;
          state.ui.sidebarCollapsed = false;
          state.ui.sidebarWidth = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, RAIL_W + dx));
        } else {
          const w = from + dx;
          if (w < SIDEBAR_MIN) { state.ui.sidebarCollapsed = true; }
          else { state.ui.sidebarCollapsed = false; state.ui.sidebarWidth = Math.min(SIDEBAR_MAX, w); }
        }
      } else {
        // panel phải nằm bên phải nên kéo sang trái là RỘNG thêm
        const w = from - dx;
        if (w < PANE_MIN - 40) { state.paneOpen = false; }
        else { state.paneOpen = true; state.ui.paneWidth = Math.min(PANE_MAX, Math.max(PANE_MIN, w)); }
      }
      applyWidths();
    };
    const up = () => {
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerup", up);
      document.body.classList.remove("dragging");
      saveUi();
      paint();   // một lần, khi đã nhả: rail/panel đóng đổi cả cấu trúc DOM
    };
    node.addEventListener("pointermove", move);
    node.addEventListener("pointerup", up);
  });
}

/* ── X4: transcript giữ được vị trí, và chỉ giữ một cửa sổ trong DOM ──────────
 *
 * Số đo trước khi viết (`pnpm measure:transcript`), vì ADR 0004 nói mục này sẽ kích hoạt việc
 * chuyển sang React:
 *
 *      31 bubble ·    657 node  →  0,84 ms mỗi lần vẽ lại
 *     124 bubble ·  2 628 node  →  4,52 ms
 *     496 bubble · 10 512 node  →  21,8 ms
 *   1 984 bubble · 42 048 node  →  52,0 ms
 *
 * Đọc ra hai điều. Một: ở cỡ đang dùng, "vẽ lại tất cả" KHÔNG phải vấn đề hiệu năng — 0,84ms. Hai:
 * nó thành vấn đề từ khoảng 500 entry (21,8ms > một khung hình 16,7ms). Và React tự nó không chữa
 * cái đó; thứ chữa là **chỉ dựng phần nhìn thấy**, làm được trong mô hình hiện tại.
 *
 * Lỗi thật hôm nay không phải hiệu năng mà là `log.scrollTop = log.scrollHeight` chạy vô điều kiện:
 * mọi lần vẽ lại đều nhảy xuống đáy, đo được 7516 → 14103.
 */
const WINDOW_SIZE = 150;      // số entry giữ trong DOM; cuộn lên đầu thì nới thêm
const NEAR_BOTTOM = 64;       // px — trong khoảng này coi như đang ghim đáy

let shownCount = WINDOW_SIZE;
let lastAgent = "";

/**
 * Trạng thái cuộn phải được CHỤP TRƯỚC khi vẽ, không đọc lại sau.
 *
 * Hai bản trước đều sai vì cùng một lý do, chỉ khác cách sai:
 *   · bản 1 đọc `scrollTop` từ phần tử VỪA được tạo trong lượt vẽ này — luôn là 0, nên phép tính
 *     "có đang ghim đáy không" luôn ra đúng và nó nhảy xuống đáy (7516 → 14103);
 *   · bản 2 giữ đúng một phần tử rồi cắm lại — nhưng `root.replaceChildren()` TÁCH nó khỏi
 *     document, và trình duyệt xoá vị trí cuộn của phần tử bị tách (7516 → 0).
 *
 * Nên vị trí cuộn không thể đọc được sau khi vẽ, dù bằng cách nào. Chụp trước, dùng sau.
 */
let pendingScroll: { top: number; h: number; view: number; key: string; delta: number } | null = null;

function captureScroll(): void {
  const log = root.querySelector<HTMLElement>(".transcript");
  if (!log) { pendingScroll = null; return; }
  const a = captureAnchor(log);
  pendingScroll = { top: log.scrollTop, h: log.scrollHeight, view: log.clientHeight, key: a?.key ?? "", delta: a?.delta ?? 0 };
}

/**
 * Neo theo PHẦN TỬ, không theo khoảng cách tới đáy.
 *
 * Neo theo đáy chỉ đúng khi nội dung mọc thêm ở trên; neo theo đỉnh chỉ đúng khi mọc thêm ở dưới.
 * Transcript có cả hai — nới cửa sổ thì thêm ở trên, tin mới và tin đang stream thì thêm ở dưới.
 * Nhớ một phần tử đang nhìn thấy rồi đặt lại đúng offset của nó thì cả hai trường hợp đều đúng.
 */
const captureAnchor = (log: HTMLElement): { key: string; delta: number } | null => {
  const top = log.scrollTop;
  // `Array.from` chứ không `for…of` thẳng: tsconfig ở đây không bật `downlevelIteration` cho NodeList.
  for (const node of Array.from(log.querySelectorAll<HTMLElement>("[data-entry]"))) {
    if (node.offsetTop + node.offsetHeight > top) {
      return { key: node.dataset.entry ?? "", delta: node.offsetTop - top };
    }
  }
  return null;
};

const restoreAnchor = (log: HTMLElement, a: { key: string; delta: number } | null): boolean => {
  if (!a?.key) return false;
  const node = log.querySelector<HTMLElement>(`[data-entry="${CSS.escape(a.key)}"]`);
  if (!node) return false;
  log.scrollTop = node.offsetTop - a.delta;
  return true;
};

function renderTranscript(log: HTMLElement, selected: NativeAgent | undefined): void {
  const switched = (selected?.id ?? "") !== lastAgent;
  if (switched) { shownCount = WINDOW_SIZE; lastAgent = selected?.id ?? ""; }

  const st = pendingScroll;
  const pinned = switched || !st || st.h - st.top - st.view <= NEAR_BOTTOM;
  const anchor = pinned || !st ? null : { key: st.key, delta: st.delta };

  log.replaceChildren();
  if (!selected) { log.append(el(`<div class="empty">Chưa chọn bot.</div>`)); return; }
  if (!state.entries.length) { log.append(el(`<div class="empty">Bắt đầu một cuộc trò chuyện.</div>`)); return; }

  const total = state.entries.length;
  const from = Math.max(0, total - shownCount);
  if (from > 0) {
    // Phân trang về phía TRƯỚC, đúng ý `beforeSeq`: nới cửa sổ thay vì dựng cả nghìn hàng.
    const more = el(`<button type="button" class="load-more">Xem ${Math.min(WINDOW_SIZE, from)} tin cũ hơn (còn ${from})</button>`);
    more.onclick = () => { shownCount += WINDOW_SIZE; paint(); };
    log.append(more);
  }
  for (const node of renderRuns(state.entries.slice(from))) log.append(node);

  if (pinned) log.scrollTop = log.scrollHeight;
  else if (!restoreAnchor(log, anchor)) log.scrollTop = log.scrollHeight;
}

/**
 * Hỏi `/v1/search`, gộp nhịp 250ms.
 *
 * Không hỏi theo từng ký tự: gõ "marketing" là chín lượt gọi mạng và chín lần vẽ lại. Và kiểm lại
 * từ khoá trước khi nhận kết quả — trả lời của một truy vấn cũ về sau truy vấn mới là cách chắc
 * chắn để danh sách nhấp nháy sai.
 */
let searchTimer: number | undefined;
function queueSearch(q: string): void {
  clearTimeout(searchTimer);
  if (!q) { state.hits = null; return; }
  searchTimer = window.setTimeout(async () => {
    try {
      const { hits } = await api.searchAgents(q);
      if (state.query.trim() !== q) return;   // đã gõ tiếp, kết quả này lỗi thời
      state.hits = hits.map((h) => ({ agentId: h.agentId, why: h.why }));
      paint();
    } catch { /* mất mạng thì giữ lọc theo tên, đừng làm trống danh sách */ }
  }, 250);
}

function paint(): void {
  captureScroll();   // PHẢI là việc đầu tiên: sau `replaceChildren` thì không còn gì để đọc
  const selected = state.agents.find((a) => a.id === state.selected);
  root.replaceChildren(el(`<div class="shell${state.paneOpen ? "" : " no-pane"}">
    <aside class="sidebar${state.ui.sidebarCollapsed ? " rail" : ""}">
      <div class="side-head">
        <button type="button" class="new-icon" data-act="new" aria-label="New" title="bot mới">+</button>
      </div>
      ${state.searchOpen || state.query
        ? `<label class="search"><span class="ico">⌕</span><input type="search" placeholder="Search" value="${escapeHtml(state.query)}" /></label>`
        : `<button type="button" class="search-btn" data-act="search" aria-label="Search"><span class="ico">⌕</span><span class="lbl">Search</span></button>`}
      <div class="roster"></div>
      <div class="side-foot">
        <button type="button" class="foot-row" data-act="plugins" aria-label="Plugins" aria-expanded="${state.pluginsOpen}">
          <span class="ico">⊞</span><span class="lbl">Plugins</span>
        </button>
        ${state.accountOpen ? `<div class="account-menu" role="menu">
          <button type="button" role="menuitem" data-act="new">Bot mới</button>
          <button type="button" role="menuitem" data-act="hidden">${state.showHidden ? "Giấu bot ẩn" : "Hiện bot ẩn"}</button>
          <button type="button" role="menuitem" data-act="del" ${selected ? "" : "disabled"}>Xoá bot đang chọn</button>
          <hr />
          <button type="button" role="menuitem" data-act="logout">Đăng xuất</button>
        </div>` : ""}
        <button type="button" class="foot-row rail-new" data-act="new" aria-label="New" title="bot mới">+</button>
        <button type="button" class="foot-row account" data-act="account" aria-expanded="${state.accountOpen}" aria-label="Open account menu">
          <span class="mono">${escapeHtml(initialsOf(api.currentEmail().split("@")[0] || "tk"))}</span>
          <span class="lbl">${escapeHtml(api.currentEmail() || "tài khoản")}</span>
        </button>
      </div>
    </aside>
    <div class="grip grip-sidebar" role="separator" aria-orientation="vertical" aria-label="Resize sidebar" tabindex="0"></div>
    <section class="chat">
      <div class="chat-head">
        ${selected ? `<button type="button" class="avatar-btn" data-act="settings" aria-label="View Bot settings">${avatarOf(selected)}<span class="pdot${selected.presence.isRunning ? " live" : ""}"></span></button>` : ""}
        ${selected
          ? `<button type="button" class="identity" data-act="settings" aria-label="View Bot settings"><span class="nm">${escapeHtml(selected.name)}</span><span class="chev">›</span></button>`
          : `<span class="identity empty">chọn một bot</span>`}
        <div class="head-actions">
          <!-- App gốc KHÔNG có pill trạng thái ở đây (đo header qua CDP: chỉ nút danh tính + một
               icon-button "Grok Bot's Computer"). Trạng thái nằm ở chấm trên avatar + ba chấm
               trong transcript, nên pill "sẵn sàng" cũ là thứ thừa so với app. -->
          <button type="button" class="icon-btn" data-act="pane" aria-label="${state.paneOpen ? "Close details" : "Open details"}" title="${state.paneOpen ? "Đóng panel" : "Mở panel"}"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="9" rx="1.5"/><path d="M5.5 14h5M8 11.5V14"/></svg></button>
        </div>
      </div>
      ${state.error ? `<div class="err">${escapeHtml(state.error)}</div>` : ""}
      <div class="transcript"></div>
      <form class="composer">
        <div class="pending" hidden></div>
        <label class="attach" title="gửi tệp">+<input type="file" ${selected ? "" : "disabled"} /></label>
        <textarea name="q" rows="1" aria-label="Prompt" placeholder="${selected ? `Nhắn ${escapeHtml(selected.name)}` : "chọn một bot"}" ${selected ? "" : "disabled"}>${escapeHtml(state.draft)}</textarea>
        ${SPEECH_OK ? `<button type="button" class="mic" data-act="mic" aria-label="Start voice input" title="Đọc để nhập" ${selected ? "" : "disabled"}>◉</button>` : ""}
        ${state.draft.trim() && !selected?.presence.isRunning
          ? `<button type="submit" class="send" title="gửi" ${selected && !state.busy ? "" : "disabled"}>↑</button>` : ""}
        ${selected?.presence.isRunning
          ? `<button type="button" class="stop" data-act="stop" title="dừng">■</button>` : ""}
      </form>
    </section>
    <div class="grip grip-pane" role="separator" aria-orientation="vertical" aria-label="Resize details" tabindex="0"></div>
    <aside class="computer">
      <div class="pane-nav" data-page="${state.panePage}">
        <section class="pane-page details" ${state.panePage === "details" ? "" : "aria-hidden=\"true\""}>
          <div class="head"><span>Màn hình</span><span class="state">${state.computer?.state === "running" ? "live" : "off"}</span></div>
          <div class="screen">${screenPane(state.computer)}</div>
          <div class="caption">${escapeHtml(selected ? `Màn hình của ${selected.name}` : "chưa chọn bot")}</div>
          <div class="routines">
            <div class="routines-head">
              <span>Routine</span>
              <button type="button" class="icon-btn" data-act="routine-new" aria-label="Create Routine" ${selected ? "" : "disabled"}>+</button>
            </div>
            ${!selected
              ? `<p class="empty-note">chọn một bot để xem routine</p>`
              : state.routines.length
                ? `<ul class="routine-list">${state.routines.map((r) => `
                    <li class="routine${r.isEnabled ? "" : " off"}" data-routine="${escapeHtml(r.id)}">
                      <div class="routine-main">
                        <span class="nm">${escapeHtml(r.name)}</span>
                        <span class="when">${escapeHtml(r.scheduleText || r.schedule)}</span>
                      </div>
                      <label class="routine-toggle" title="${r.isEnabled ? "đang bật" : "đang tắt"}">
                        <input type="checkbox" data-act="routine-toggle" ${r.isEnabled ? "checked" : ""} />
                      </label>
                      <button type="button" class="icon-btn" data-act="routine-del" aria-label="Xoá routine">×</button>
                    </li>`).join("")}</ul>`
                : `<p class="empty-note">Routine là việc lặp lại theo lịch mà bot tự chạy. Chưa có cái nào.</p>`}
          </div>
        </section>
        <section class="pane-page settings" ${state.panePage === "settings" ? "" : "aria-hidden=\"true\""}>
          <div class="pane-top">
            <button type="button" class="icon-btn" data-act="back" aria-label="Back to details">‹</button>
            <span class="subpage-title">Bot settings</span>
          </div>
          ${selected ? `
          <div class="set-body">
            <button type="button" class="avatar-trigger" data-act="avatar" aria-label="Edit Bot avatar">${avatarOf(selected)}</button>
            <label class="field"><span>Bot name</span>
              <input type="text" data-field="name" value="${escapeHtml(selected.name)}" />
            </label>
            <label class="field"><span>Description</span>
              <textarea data-field="description" rows="2">${escapeHtml(selected.description)}</textarea>
            </label>
            <label class="toggle">
              <input type="checkbox" data-field="notifications" ${selected.notificationsEnabled ? "checked" : ""} />
              <span>Notifications</span>
            </label>
            <div class="set-foot">
              <button type="button" class="btn" data-act="hide">${selected.hidden ? "Hiện lại bot" : "Ẩn khỏi sidebar"}</button>
              <button type="button" class="btn danger" data-act="del">Xoá bot</button>
            </div>
          </div>` : `<p class="empty-note">chọn một bot để xem cài đặt</p>`}
        </section>
      </div>
    </aside>
    ${state.pluginsOpen ? `<div class="plugins-modal" role="dialog" aria-label="Plugins">
      <div class="plugins-card">
        <div class="plugins-head">
          <span class="title">Plugins</span>
          <button type="button" class="icon-btn" data-act="plugins-close" aria-label="Close plugins">×</button>
        </div>
        ${state.plugins === null
          ? `<p class="empty-note">đang tải…</p>`
          : state.plugins.length
            ? `<ul class="plugin-list">${state.plugins.map((p) => `
                <li class="plugin-row">
                  <div class="plugin-main">
                    <span class="nm">${escapeHtml(p.displayName)}<span class="kind">${p.kind}</span></span>
                    <span class="desc">${escapeHtml(p.description)}</span>
                  </div>
                  <button type="button" class="btn${p.installed ? "" : " primary"}" data-act="plugin-toggle" data-plugin="${p.id}">
                    ${p.installed ? "Gỡ" : "Cài"}
                  </button>
                </li>`).join("")}</ul>`
            : `<p class="empty-note">marketplace trống — cấu hình GROKBOT2_PLUGIN_REGISTRY để nạp danh sách</p>`}
      </div>
    </div>` : ""}
  </div>`));

  const roster = root.querySelector(".roster")!;
  const q = state.query.trim().toLowerCase();
  /*
   * Ưu tiên kết quả backend; lọc theo tên chỉ là bước đệm trong lúc chờ.
   *
   * Backend tìm cả trong nội dung transcript, FE thì không thể. Nhưng nếu chờ mạng mới vẽ thì mỗi
   * ký tự gõ vào là một khoảng trắng nhấp nháy — nên vẽ ngay bằng lọc tên, rồi thay bằng kết quả
   * thật khi nó về.
   */
  const hits = state.hits;
  const shown = !q
    ? state.agents
    : hits
      ? state.agents.filter((a) => hits.some((x) => x.agentId === a.id))
      : state.agents.filter((a) => a.name.toLowerCase().includes(q));
  const whyOf = (id: string) => state.hits?.find((x) => x.agentId === id)?.why ?? null;
  if (q && !shown.length) roster.append(el(`<div class="group">không có bot nào khớp "${escapeHtml(state.query.trim())}"</div>`));

  /**
   * Xếp bot vào nhóm theo `sidebarSections`, thứ tự nhóm giữ nguyên như host trả về.
   *
   * Bot không thuộc nhóm nào rơi vào mục catch-all `__agents__` ("Unassigned") — đúng cách app
   * gốc làm. Khi đang tìm kiếm thì bỏ nhóm và hiện phẳng: gom nhóm lúc đó chỉ làm khó đọc.
   */
  const groups: { name: string; items: NativeAgent[] }[] = [];
  if (state.sections.length && !q) {
    const placed = new Set<string>();
    for (const sec of state.sections) {
      if (sec.id === "__agents__") continue;
      const items = sec.agentIds.map((id) => shown.find((a) => a.id === id)).filter((a): a is NativeAgent => a != null);
      items.forEach((a) => placed.add(a.id));
      if (items.length) groups.push({ name: sec.name, items });
    }
    const rest = shown.filter((a) => !placed.has(a.id));
    const catchAll = state.sections.find((s) => s.id === "__agents__");
    if (rest.length) groups.push({ name: catchAll?.name ?? "Chưa phân nhóm", items: rest });
  } else {
    groups.push({ name: "", items: shown });
  }

  const rowsFor = (list: NativeAgent[]) => list;
  for (const g of groups) {
    /*
     * Đầu nhóm dựng theo số đo ở app gốc (`x-ray --groups`): `button` cao 30px có `aria-expanded`,
     * và số đếm CHỈ hiện khi nhóm đang gập. Phần co giãn là một khối riêng để `height` chuyển được
     * trong 200ms — cùng thời lượng đo được ở họ.
     */
    const shut = state.collapsed.has(g.name);
    if (g.name) {
      const head = el(`<button type="button" class="group" aria-expanded="${!shut}">
        <span class="caret">›</span><span class="lbl">${escapeHtml(g.name)}</span>
        ${shut ? `<span class="count">${g.items.length}</span>` : ""}
      </button>`);
      head.onclick = () => {
        if (shut) state.collapsed.delete(g.name); else state.collapsed.add(g.name);
        paint();
      };
      roster.append(head);
    }
    // Một khối con duy nhất, có chủ ý: mẹo `grid-template-rows: 0fr` chỉ co được HÀNG ĐẦU của
    // grid. Bản đầu cho 5 hàng bot làm con trực tiếp nên `aria-expanded` đổi mà chiều cao vẫn 275px.
    const reveal = el(`<div class="reveal${shut ? " shut" : ""}"><div class="reveal-in"></div></div>`);
    roster.append(reveal);
    const bay = reveal.firstElementChild!;
    for (const a of rowsFor(g.items)) {
    // App gốc gắn ", Unread activity" vào chính nhãn của hàng (đo: `aria-label="Marketing Lead, Unread activity"`).
    const item = el(`<button type="button" class="bot ${a.id === state.selected ? "active" : ""} ${a.hidden ? "dim" : ""}"${a.unread ? ` aria-label="${escapeHtml(a.name)}, Unread activity"` : ""}>
      ${avatarOf(a)}
      <span class="name">${escapeHtml(a.name)}</span>
      ${a.presence.isRunning || a.unread
        ? `<span class="dot${a.presence.isRunning ? " live" : ""}"></span>`
        : `<span class="when">${escapeHtml(shortTime(a.updatedAtMs))}</span>`}
      <span class="preview">${whyOf(a.id) === "transcript" ? "khớp trong nội dung · " : ""}${escapeHtml(preview(a))}</span>
    </button>`);
      item.onclick = () => selectBot(a.id);
      bay.append(item);
    }
  }

  const search = root.querySelector<HTMLInputElement>(".search input");
  if (search) {
    // `paint()` dựng lại cả cây DOM, nên phải trả lại focus và vị trí con trỏ, nếu không
    // gõ được đúng một ký tự rồi mất focus.
    search.oninput = () => {
      state.query = search.value;
      state.hits = null;          // kết quả cũ không còn đúng với từ khoá mới
      paint();
      queueSearch(state.query.trim());
    };
    if (state.query) {
      const next = root.querySelector<HTMLInputElement>(".search input")!;
      next.focus();
      next.setSelectionRange(next.value.length, next.value.length);
    }
  }

  renderTranscript(root.querySelector(".transcript")!, selected);

  /*
   * Từ đây trở xuống dùng `?.` chứ không `!`: đầu và đáy sidebar giờ dựng theo app gốc, nên `del`
   * và `hidden` chỉ tồn tại KHI menu tài khoản đang mở. Bản đầu của tôi vẫn `!` và `paint()` ném
   * lỗi ngay lần vẽ đầu — nút không còn thì phép khẳng định không-null là lời khai sai.
   */
  applyWidths();
  const grip = (sel: string, kind: "sidebar" | "pane") => {
    const n = root.querySelector<HTMLElement>(sel);
    if (n) wireHandle(n, kind);
  };
  grip(".grip-sidebar", "sidebar");
  grip(".grip-pane", "pane");

  root.querySelector<HTMLButtonElement>("[data-act=search]")?.addEventListener("click", () => {
    state.searchOpen = true; paint();
  });
  root.querySelector<HTMLButtonElement>("[data-act=account]")?.addEventListener("click", () => {
    state.accountOpen = !state.accountOpen; paint();
  });
  root.querySelector<HTMLButtonElement>("[data-act=logout]")?.addEventListener("click", async () => {
    await api.logout(); location.reload();
  });
  root.querySelectorAll<HTMLButtonElement>("[data-act=settings]").forEach((b) => {
    b.onclick = () => { state.paneOpen = true; state.panePage = "settings"; saveUi(); paint(); };
  });
  root.querySelector<HTMLButtonElement>("[data-act=plugins]")?.addEventListener("click", async () => {
    state.pluginsOpen = !state.pluginsOpen;
    paint();
    // Tải lười, một lần: mở panel mới cần danh sách, và `null` (chưa tải) khác mảng rỗng (trống thật).
    if (state.pluginsOpen && state.plugins === null) {
      try { state.plugins = (await api.listPlugins()).plugins; state.error = ""; }
      catch (e) { state.error = e instanceof Error ? e.message : String(e); }
      paint();
    }
  });
  root.querySelector<HTMLButtonElement>("[data-act=plugins-close]")?.addEventListener("click", () => {
    state.pluginsOpen = false; paint();
  });
  root.querySelectorAll<HTMLButtonElement>("[data-act=plugin-toggle]").forEach((b) => {
    b.onclick = async () => {
      const id = Number(b.dataset.plugin);
      const cur = state.plugins?.find((p) => p.id === id);
      if (!cur) return;
      // Dùng LUÔN danh sách backend trả về, không tự lật cờ ở FE — cùng lý do với routine (X5.1):
      // app gốc và web dùng chung một trạng thái cài, bản sao tự suy sẽ lệch.
      try { state.plugins = (await api.patchPlugin(id, !cur.installed)).plugins; state.error = ""; }
      catch (e) { state.error = e instanceof Error ? e.message : String(e); }
      paint();
    };
  });

  // `new` có hai chỗ: nút + ở đầu sidebar và mục trong menu tài khoản. Nối cả hai.
  root.querySelectorAll<HTMLButtonElement>("[data-act=new]").forEach((b) => { b.onclick = async () => {
    const name = prompt("Tên bot?", "Claude");
    if (!name) return;
    const created = await api.createAgent(name.trim());
    state.selected = created.agent.id;
    await refreshRoster();
  }; });

  const delBtn = root.querySelector<HTMLButtonElement>("[data-act=del]");
  if (delBtn) delBtn.onclick = async () => {
    if (!state.selected || !confirm("Xóa bot này?")) return;
    await api.deleteAgent(state.selected);
    state.selected = "";
    state.entries = [];
    await refreshRoster();
  };
  const hidBtn = root.querySelector<HTMLButtonElement>("[data-act=hidden]");
  if (hidBtn) hidBtn.onclick = () => {
    state.showHidden = !state.showHidden;
    void refreshRoster();
  };
  /*
   * Tên và mô tả giờ là TRƯỜNG trong trang settings, không còn nút "đổi tên" mở `prompt()`.
   *
   * Ghi khi rời trường (`change`), không ghi từng ký tự: gõ một cái tên là hàng chục PATCH và hàng
   * chục lần vẽ lại roster. App gốc cũng ghi khi rời trường.
   */
  const saveField = async (field: "name" | "description", value: string) => {
    if (!state.selected) return;
    const rec = state.agents.find((a) => a.id === state.selected);
    const before = field === "name" ? rec?.name : rec?.description;
    if (value === before) return;
    if (field === "name" && !value.trim()) return;   // tên rỗng thì bỏ qua, không xoá tên của họ
    try {
      await api.patchAgent(state.selected, field === "name" ? { name: value.trim() } : { description: value });
      state.error = "";
    } catch (e) {
      state.error = e instanceof Error ? e.message : String(e);
    }
    await refreshRoster();
  };
  const nameField = root.querySelector<HTMLInputElement>('[data-field="name"]');
  if (nameField) nameField.onchange = () => void saveField("name", nameField.value);
  const descField = root.querySelector<HTMLTextAreaElement>('[data-field="description"]');
  if (descField) descField.onchange = () => void saveField("description", descField.value);
  const notif = root.querySelector<HTMLInputElement>('[data-field="notifications"]');
  if (notif) notif.onchange = async () => {
    if (!state.selected) return;
    try {
      await api.patchAgent(state.selected, { notificationsEnabled: notif.checked });
      state.error = "";
    } catch (e) {
      state.error = e instanceof Error ? e.message : String(e);
      notif.checked = !notif.checked;   // trả lại đúng trạng thái thật khi ghi thất bại
    }
    await refreshRoster();
  };

  /*
   * Chỉ vẽ lại khi việc "ô nhập có chữ hay không" ĐỔI, không vẽ theo từng ký tự.
   *
   * Nút gửi hiện/ẩn theo trạng thái đó, nên phải theo dõi; nhưng gọi `paint()` mỗi lần gõ là dựng
   * lại cả cây DOM 60 lần một giây và mất luôn con trỏ. So trạng thái rỗng/không-rỗng thì mỗi lượt
   * gõ chỉ vẽ lại tối đa một lần.
   */
  const draftBox = root.querySelector<HTMLTextAreaElement>('textarea[name="q"]');
  if (draftBox) {
    /*
     * Cao theo nội dung: `rows=1` cố định làm Shift+Enter thành cuộn trong một hàng — không thấy
     * mình vừa xuống dòng. 160px trần lấy từ `max-height` trong CSS; số dòng tối đa của app gốc
     * chưa đo nên trần này là giá trị tạm.
     */
    const autosize = () => {
      draftBox.style.height = "auto";
      draftBox.style.height = `${Math.min(draftBox.scrollHeight, 160)}px`;
    };
    autosize();   // draft khôi phục sau paint() có thể đã nhiều dòng
    draftBox.oninput = () => {
      const had = state.draft.trim().length > 0;
      state.draft = draftBox.value;
      autosize();
      if (had !== (state.draft.trim().length > 0)) {
        const at = draftBox.selectionStart;
        paint();
        const next = root.querySelector<HTMLTextAreaElement>('textarea[name="q"]');
        if (next) { next.focus(); next.setSelectionRange(at, at); }
      }
    };
    /*
     * Phím tắt của app gốc: **Enter gửi, Shift+Enter xuống dòng** (composer của họ là textbox
     * `aria-multiline=true`, không khai `aria-keyshortcuts` — hành vi xác nhận từ chính app).
     *
     * Hai chỗ dễ hỏng, cả hai đều có chủ ý:
     * - Gõ tiếng Việt bằng IME: lúc đang ghép vần thì Enter là "chốt chữ", không phải "gửi" —
     *   `isComposing`/`keyCode 229` phải cho qua, không thì gửi giữa chừng một chữ đang gõ dở.
     * - Enter chỉ gửi khi nút ↑ đang hiện (có nội dung, bot không chạy, không busy). Khi không gửi
     *   được thì nuốt phím luôn thay vì chèn một dòng trống vô nghĩa vào draft.
     */
    draftBox.onkeydown = (ev) => {
      if (ev.key !== "Enter" || ev.shiftKey) return;
      if (ev.isComposing || ev.keyCode === 229) return;
      ev.preventDefault();
      const sel = state.agents.find((a) => a.id === state.selected);
      const canSend = (state.draft.trim().length > 0 || state.pending.length > 0)
        && !!sel && !sel.presence.isRunning && !state.busy;
      if (canSend) root.querySelector<HTMLFormElement>("form.composer")?.requestSubmit();
    };
    if (state.draft) {
      draftBox.focus();
      draftBox.setSelectionRange(state.draft.length, state.draft.length);
    }
  }

  /*
   * Ba nút của routine. Sau mỗi thao tác dùng LUÔN danh sách backend trả về, không tự sửa mảng ở
   * FE: backend là chỗ duy nhất biết thứ tự và `scheduleText`, và một bản sao tự suy ở FE sẽ lệch
   * ngay lần đầu ai đó sửa routine từ app gốc.
   */
  const applyRoutines = (list: Routine[]) => { state.routines = list; state.error = ""; paint(); };
  const routineFail = (e: unknown) => {
    state.error = e instanceof Error ? e.message : String(e);
    paint();
  };

  root.querySelector<HTMLButtonElement>("[data-act=routine-new]")?.addEventListener("click", async () => {
    if (!state.selected) return;
    const name = prompt("Tên routine?", "Báo cáo sáng");
    if (!name?.trim()) return;
    const promptText = prompt("Bot phải làm gì?", "Tổng hợp việc hôm qua");
    if (!promptText?.trim()) return;
    // Cron, không phải câu tiếng Anh — backend từ chối 400 nếu không đọc được, nên nói trước ở đây.
    const schedule = prompt("Lịch, dạng cron 5 trường (phút giờ ngày tháng thứ)", "0 9 * * *");
    if (!schedule?.trim()) return;
    try { applyRoutines((await api.createRoutine(state.selected, { name: name.trim(), prompt: promptText, schedule: schedule.trim() })).routines); }
    catch (e) { routineFail(e); }
  });

  root.querySelectorAll<HTMLElement>("li.routine").forEach((li) => {
    const id = li.dataset.routine;
    if (!id || !state.selected) return;
    const agentId = state.selected;
    li.querySelector<HTMLInputElement>("[data-act=routine-toggle]")?.addEventListener("change", async (ev) => {
      const on = (ev.target as HTMLInputElement).checked;
      try { applyRoutines((await api.patchRoutine(agentId, id, { isEnabled: on })).routines); }
      catch (e) { routineFail(e); }
    });
    li.querySelector<HTMLButtonElement>("[data-act=routine-del]")?.addEventListener("click", async () => {
      if (!confirm("Xoá routine này?")) return;
      try { applyRoutines((await api.deleteRoutine(agentId, id)).routines); }
      catch (e) { routineFail(e); }
    });
  });

  root.querySelector<HTMLButtonElement>("[data-act=back]")?.addEventListener("click", () => {
    state.panePage = "details";
    paint();
  });

  const hideBtn = root.querySelector<HTMLButtonElement>("[data-act=hide]");
  if (hideBtn) hideBtn.onclick = async () => {
    if (!state.selected) return;
    const rec = state.agents.find((a) => a.id === state.selected);
    const nextHidden = rec ? !rec.hidden : true;
    try {
      await api.hideAgent(state.selected, nextHidden);
      state.error = "";
      if (nextHidden && !state.showHidden) {
        state.selected = "";
        state.entries = [];
      }
    } catch (e) {
      state.error = e instanceof Error ? e.message : String(e);
    }
    await refreshRoster();
  };
  // Hai chỗ mở bộ chọn ảnh: nút "ảnh" và chính cái avatar trên header.
  const paneBtn = root.querySelector<HTMLButtonElement>("[data-act=pane]");
  if (paneBtn) paneBtn.onclick = () => {
    state.paneOpen = !state.paneOpen;
    saveUi();
    paint();
  };
  const mic = root.querySelector<HTMLButtonElement>("[data-act=mic]");
  if (mic) mic.onclick = () => toggleDictation(mic);
  root.querySelectorAll<HTMLButtonElement>('[data-act=avatar]').forEach((btn) => {
    btn.onclick = () => { if (selected) openAvatarPicker(selected); };
  });
  /*
   * Lần thứ BA cùng một lỗi trong dự án này, nên ghi lại cho rõ: hễ một nút chỉ xuất hiện trong một
   * số trạng thái thì `!` trên nó là một lời khai sai, và `paint()` ném lỗi ở lần vẽ đầu — người
   * dùng thấy "Không kết nối được BFF" trong khi backend hoàn toàn bình thường. Nút dừng vừa được
   * cho ẩn khi bot không chạy, nên nó vào đúng nhóm đó.
   */
  const stopBtn = root.querySelector<HTMLButtonElement>("[data-act=stop]");
  if (stopBtn) stopBtn.onclick = async () => {
    if (!state.selected) return;
    try {
      await api.interruptTurn(state.selected);
      markRunning(false);
      state.error = "";
    } catch (e) {
      state.error = e instanceof Error ? e.message : String(e);
    }
    await loadTranscript();
    await refreshRoster();
  };
  const pendingBox = root.querySelector<HTMLElement>(".pending")!;
  if (state.pending.length) {
    pendingBox.hidden = false;
    for (const p of state.pending) {
      const chip = el(`<span class="chip"><img alt="" src="${escapeHtml(p.href)}" /><button type="button" aria-label="bỏ ảnh">×</button></span>`);
      chip.querySelector("button")!.onclick = () => {
        state.pending = state.pending.filter((x) => x.path !== p.path);
        paint();
      };
      pendingBox.append(chip);
    }
  }
  root.querySelector<HTMLInputElement>("input[type=file]")!.onchange = async (ev) => {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(reader.error ?? new Error("read failed"));
      reader.readAsDataURL(file);
    });
    try {
      const staged = await api.uploadImage(file.name, dataUrl);
      state.pending = [...state.pending, { path: staged.path, name: staged.fileName, href: staged.href }];
      state.error = "";
    } catch (e) {
      state.error = e instanceof Error ? e.message : String(e);
    }
    paint();
  };
  const composerForm = root.querySelector("form");
  if (composerForm) composerForm.onsubmit = async (ev) => {
    ev.preventDefault();
    const box = root.querySelector("textarea")!;
    const content = box.value.trim();
    const attachments = state.pending.map((p) => ({ path: p.path, name: p.name }));
    if ((!content && !attachments.length) || !state.selected) return;
    box.value = "";
    state.draft = "";
    state.pending = [];
    state.busy = true;
    state.error = "";
    paint();
    try {
      await api.sendTurn(state.selected, content, crypto.randomUUID(), attachments);
      markRunning(true);
      await loadTranscript();
    } catch (e) {
      state.error = e instanceof Error ? e.message : String(e);
      markRunning(false);
    } finally {
      state.busy = false;
      paint();
    }
  };

  // Bấm ra ngoài thì đóng mọi menu reaction đang mở. Gắn MỘT lần: `paint()` chạy lại rất
  // nhiều lần, còn listener trên `root` thì `replaceChildren` không dọn — gắn mỗi lần vẽ là
  // cộng dồn vô hạn.
  if (!closeMenusBound) {
    closeMenusBound = true;
    root.addEventListener("click", () => {
      root.querySelectorAll<HTMLElement>('.react-menu').forEach((m) => { m.hidden = true; });
    });
  }

  /*
   * Avatar header sống động khi bot chưa có ảnh riêng. Có ảnh riêng thì để nguyên ảnh — người
   * dùng đã chọn thứ họ muốn thấy, thay bằng con bot nhúc nhích là ghi đè lựa chọn đó.
   */
  for (const av of liveAvatars) av.stop();
  liveAvatars = [];
  /*
   * Roster và header sống; avatar ngoài lề bubble thì không.
   *
   * Trong transcript có thể có hàng chục avatar 24px lặp lại cùng một con bot — cho tất cả cùng
   * nhúc nhích vừa tốn vừa ồn, mà chẳng nói thêm điều gì. Cái đáng sống là chỗ trạng thái bot có
   * nghĩa: hàng trong roster (đang trả lời / có tin mới) và bot đang mở.
   */
  root.querySelectorAll<HTMLElement>(".avatar.face[data-bot]").forEach((host) => {
    // Máng lượt nói: có thể có hàng chục avatar 22px lặp lại cùng một bot trong transcript.
    // (Trước A1 guard này trỏ vào `.msg-row` — class đó không còn, tức guard đã hở.)
    if (host.closest(".run-gutter")) return;
    const id = host.dataset.bot!;
    liveAvatars.push(animateAvatar(host, id, moodOf(state.agents.find((x) => x.id === id))));
  });

  // Ảnh nào `avatarOf()` cần mà chưa có thì tải sau khi cây DOM đã dựng xong.
  void fetchWantedAvatars();
}

function markRunning(running: boolean): void {
  const a = state.agents.find((x) => x.id === state.selected);
  if (a) a.presence = { ...a.presence, isRunning: running };
}

async function refreshRoster(): Promise<void> {
  state.agents = await api.listAgents(state.showHidden);
  /**
   * Nhóm đọc cùng lúc với roster, và lỗi thì bỏ qua: mất nhóm chỉ làm sidebar phẳng, còn để nó
   * làm gãy cả roster thì mất luôn thứ quan trọng hơn.
   */
  try { state.sections = (await api.sidebarSections()).sections; } catch { /* sidebar phẳng */ }
  if (state.selected && !state.agents.some((a) => a.id === state.selected)) {
    state.selected = state.agents[0]?.id ?? "";
    if (!state.selected) state.entries = [];
  }
  if (!state.selected && state.agents[0]) state.selected = state.agents[0].id;
  paint();
}

/**
 * Nạp routine của bot đang chọn.
 *
 * Lỗi thì để danh sách rỗng và ghi vào `state.error`, KHÔNG ném: panel Details còn có màn hình và
 * chú thích bên cạnh, làm vỡ cả panel vì một danh sách phụ là đổi một lỗi nhỏ thành một lỗi to.
 */
async function loadRoutines(): Promise<void> {
  if (!state.selected) { state.routines = []; return; }
  try {
    state.routines = (await api.listRoutines(state.selected)).routines;
  } catch (e) {
    state.routines = [];
    state.error = `routine: ${e instanceof Error ? e.message : e}`;
  }
}

/**
 * Nạp transcript có GỘP: khi streaming, mỗi chunk là một sự kiện SSE và bản trước `void
 * loadTranscript()` cho mỗi sự kiện — các fetch chồng nhau, cái CŨ về sau cái MỚI thì transcript
 * nhảy lùi một nhịp rồi nhảy tới, tức một cú nháy nữa ngoài chuyện animation. Giờ: đang nạp thì
 * chỉ ghi cờ `dirty`, vòng lặp nạp lại MỘT lần khi xong — mọi thứ tự về đích đều đúng.
 */
let transcriptBusy = false, transcriptDirty = false;
/**
 * Mở chat một bot — dùng chung cho hàng roster VÀ nhãn tên trên lượt (app gốc: nhãn đó là nút
 * `Open X's chat`). Mở là ĐỌC: app gốc clear cờ unread khi mở chat (`kickstartAgent`), nên đây
 * cũng PATCH `unread: false` — không thì chấm xanh ở sidebar không bao giờ tắt trên web.
 */
function selectBot(id: string): void {
  const a = state.agents.find((x) => x.id === id);
  if (!a) return;
  state.selected = id;
  if (a.unread) {
    state.agents = state.agents.map((x) => (x.id === id ? { ...x, unread: false } : x));
    api.patchAgent(id, { unread: false }).catch(() => { /* mất mạng thì SSE roster sẽ sửa lại */ });
  }
  void loadTranscript();
  void loadComputer();
  void loadRoutines().then(paint);
  paint();
}

async function loadTranscript(): Promise<void> {
  if (!state.selected) { state.entries = []; paint(); return; }
  if (transcriptBusy) { transcriptDirty = true; return; }
  transcriptBusy = true;
  try {
    do {
      transcriptDirty = false;
      state.entries = (await api.getTranscript(state.selected)).entries;
      paint();
    } while (transcriptDirty && state.selected);
  } finally { transcriptBusy = false; }
}

async function loadComputer(): Promise<void> {
  if (!state.selected) { state.computer = null; return; }
  try { state.computer = await api.getComputer(state.selected); }
  catch { state.computer = null; }
  paint();
}

/** The app itself, once a session exists (multi-tenant Phase 4b). */
async function bootApp(): Promise<void> {
  root.textContent = "đang tải…";
  /*
   * Nạp bố cục TRƯỚC lần vẽ đầu, không sau: nạp sau thì người dùng thấy sidebar nhảy từ mặc định
   * sang bề rộng của mình — một cú giật ở mỗi lần mở app.
   */
  try {
    const { ui } = await api.hostSettings();
    if (typeof ui.sidebarWidth === "number") state.ui.sidebarWidth = ui.sidebarWidth;
    if (typeof ui.paneWidth === "number") state.ui.paneWidth = ui.paneWidth;
    if (typeof ui.sidebarCollapsed === "boolean") state.ui.sidebarCollapsed = ui.sidebarCollapsed;
    if (typeof ui.paneOpen === "boolean") state.paneOpen = ui.paneOpen;
    applyWidths();
  } catch { /* chưa có bố cục đã lưu, hoặc backend cũ: dùng mặc định */ }
  await refreshRoster();
  await loadTranscript();
  await loadComputer();
  void refreshUpgrade();
  const ac = new AbortController();
  const onEvent = (name: string, data: unknown) => {
    const d = data as { agentId?: string };
    if (name === "agent.upserted") { void refreshRoster(); void refreshUpgrade(); }
    if (name === "transcript.append" && (!d.agentId || d.agentId === state.selected)) void loadTranscript();
    if (name === "computer.status" && d.agentId === state.selected) void loadComputer();
  };
  /*
   * SSE phải TỰ NỐI LẠI. `listenEvents` là fetch-stream: backend restart thì stream `done` và hàm
   * return ÊM — bản trước nghe đúng một lần nên sau đó FE mù vĩnh viễn: turn xong rồi mà ba chấm
   * vẫn treo (bắt được trên stack thật khi BFF chết giữa phiên đo). Đứt là lỡ sự kiện, nên mỗi lần
   * nối lại phải đồng bộ roster + transcript + computer trước — SSE chỉ báo "có gì mới", không
   * phát lại những gì đã bỏ lỡ.
   */
  void (async () => {
    let backoff = 1_000;
    for (;;) {
      const started = Date.now();
      try {
        await api.listenEvents(onEvent, ac.signal);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
      }
      if (ac.signal.aborted) return;
      // Sống lâu rồi mới đứt ⇒ mạng chỉ chớp: thử lại nhanh. Chết ngay ⇒ backend đang sập: lùi dần.
      backoff = Date.now() - started > 30_000 ? 1_000 : Math.min(15_000, backoff * 2);
      await new Promise((r) => setTimeout(r, backoff));
      if (ac.signal.aborted) return;
      void refreshRoster();
      void loadTranscript();
      void loadComputer();
    }
  })();
}


/** An Upgrade button, shown only when the account is out of quota and a checkout URL is configured.
 *  Mounted on <body> (survives paint()); opens the self-hosted checkout in a new tab. */
function mountUpgrade(show: boolean, url: string): void {
  document.getElementById("gb2-upgrade")?.remove();
  if (!show || !url) return;
  const btn = document.createElement("button");
  btn.id = "gb2-upgrade";
  btn.className = "gb2-upgrade";
  btn.textContent = "⚡ Nâng cấp";
  btn.title = "Hết hạn mức — nâng cấp gói để tiếp tục";
  btn.addEventListener("click", () => window.open(url, "_blank", "noopener"));
  document.body.append(btn);
}

async function refreshUpgrade(): Promise<void> {
  try { const m = await api.me(); mountUpgrade(m.overQuota, m.checkoutUrl); }
  catch { /* /v1/me is best-effort — never block the app on it */ }
}

/** Email + password gate. Register creates an account; login uses an existing one. */
function renderLogin(err = ""): void {
  document.getElementById("gb2-logout")?.remove();
  root.innerHTML = `
    <div class="login">
      <form class="login__card" id="login-form">
        <h1>Grok Bot <span>local</span></h1>
        <p class="login__sub">Đăng nhập vào không gian của bạn</p>
        <input id="login-email" type="email" placeholder="email" autocomplete="username" required />
        <input id="login-pass" type="password" placeholder="mật khẩu (≥ 8 ký tự)" autocomplete="current-password" required />
        ${err ? `<p class="login__err">${escapeHtml(err)}</p>` : ""}
        <div class="login__row">
          <button type="submit" data-act="login" class="login__go">Đăng nhập</button>
          <button type="button" data-act="register" class="login__alt">Tạo tài khoản</button>
        </div>
      </form>
    </div>`;
  const form = document.getElementById("login-form") as HTMLFormElement;
  const email = () => (document.getElementById("login-email") as HTMLInputElement).value.trim();
  const pass = () => (document.getElementById("login-pass") as HTMLInputElement).value;
  const submit = async (act: "login" | "register") => {
    try {
      if (act === "register") await api.registerAccount(email(), pass());
      else await api.loginAccount(email(), pass());
      await bootApp();
    } catch (e) {
      renderLogin(e instanceof Error ? e.message : String(e));
    }
  };
  form.addEventListener("submit", (ev) => { ev.preventDefault(); void submit("login"); });
  form.querySelector('[data-act="register"]')?.addEventListener("click", () => void submit("register"));
}

async function boot(): Promise<void> {
  if (!api.hasSession()) { renderLogin(); return; }
  try {
    await bootApp();
  } catch (e) {
    // A stale/rejected token lands here — drop it and show the login gate rather than a dead app.
    if (e instanceof Error && /401|unauthorized/i.test(e.message)) { await api.logout(); renderLogin("Phiên hết hạn — đăng nhập lại."); return; }
    root.innerHTML = `<p class="err">Không kết nối được BFF :8788 — chạy <code>pnpm backend</code> rồi reload.<br>${escapeHtml(String(e))}</p>`;
  }
}

void boot();
