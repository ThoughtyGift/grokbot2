import "./style.css";
import * as api from "./api";
import type { AnimatedAvatar, BotMood } from "./avatar";
import { AVATAR_COLORS, AVATAR_EXPRESSIONS, AVATAR_SHAPES, TILE_INK, animateAvatar, botAvatarPng, botAvatarSvg, pickFor } from "./avatar";
import type { NativeAgent, NativeEntry, ComputerStatus, SidebarSection } from "./api";

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
    const label = e.event?.type === "name-changed" ? `đổi tên ${e.event.from} → ${e.event.to}` : (e.event?.type ?? "event");
    return el(`<div class="event">${escapeHtml(label)}</div>`);
  }
  if (e.kind === "widget") return renderWidget(e);
  if (e.kind === "tool-call") {
    const card = el(`<article class="tool-card ${e.status ?? ""} ${e.needsApproval && e.status === "pending" ? "pending" : ""}">
      <header><strong>${escapeHtml(e.name ?? "tool")}</strong><span>${escapeHtml(e.status ?? "")}</span></header>
      <pre>${escapeHtml(e.summary || e.result || "")}</pre>
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
      bubble.append(img);
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
    bubble.append(document.createTextNode(e.content));
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
 * Bộ emoji dưới đây là **lựa chọn của mình**, không phải bộ của hãng: cú bấm vào picker của họ
 * không lọt (toolbar của họ là một node dùng chung, hover qua CDP không giữ trạng thái), nên bộ
 * của họ chưa đo được. Đây là chỗ duy nhất trong phần này không có số đo phía sau.
 */
const REACTIONS = ["👍", "❤️", "😄", "🎉", "🙏", "👀", "✅", "🚀"];

/** Tên tám hình. Id trong `bloub` là tiếng Pháp; nhãn hiện ra là tiếng Việt. */
const SHAPE_LABELS: Record<string, string> = {
  cercle: "Tròn", galet: "Cuội", squircle: "Vuông tròn", capsule: "Viên nhộng",
  triangle: "Tam giác", hexagone: "Lục giác", nuage: "Mây", goutte: "Giọt",
};

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
    <button type="button" class="act" aria-label="Thêm reaction"></button>
    <div class="react-menu" hidden role="menu"></div>
  </div>`);
  const menu = bar.querySelector<HTMLElement>(".react-menu")!;
  for (const emoji of REACTIONS) {
    const pick = el(`<button type="button" role="menuitem" aria-label="reaction ${escapeHtml(emoji)}">${escapeHtml(emoji)}</button>`);
    pick.onclick = (ev) => { ev.stopPropagation(); menu.hidden = true; void toggleReaction(e.id, emoji); };
    menu.append(pick);
  }
  bar.querySelector<HTMLButtonElement>(".act")!.onclick = (ev) => {
    ev.stopPropagation();
    // Chỉ một menu mở tại một thời điểm.
    root.querySelectorAll<HTMLElement>('.react-menu').forEach((other) => { if (other !== menu) other.hidden = true; });
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
function renderRuns(entries: NativeEntry[]): HTMLElement[] {
  const out: HTMLElement[] = [];
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
    const isMsg = e.kind === "message" || e.kind === "agent-message";
    if (!isMsg) { run = null; runKey = ""; out.push(renderEntry(e)); continue; }

    const mine = e.kind === "message";
    const key = mine ? "me" : `bot:${e.author?.id ?? "?"}`;
    if (key !== runKey) {
      const opensBlock = key !== lastSpeaker;
      runKey = key;
      lastSpeaker = key;
      run = el(`<div class="run ${mine ? "mine" : "theirs"}${opensBlock ? " opens" : ""}"></div>`);
      const gutter = el(`<div class="run-gutter"></div>`);
      if (!mine && e.author) gutter.innerHTML = avatarOf({ id: e.author.id, name: e.author.name });
      const col = el(`<div class="run-col"></div>`);
      if (opensBlock) {
        col.append(el(`<div class="run-author">${escapeHtml(mine ? "bạn" : (e.author?.name ?? "bot"))}</div>`));
      }
      run.append(gutter, col);
      out.push(run);
    }
    const col = run!.querySelector(".run-col")!;
    const node = renderEntry(e);
    // Đuôi chỉ ở bubble đầu của một lượt MỞ ĐẦU khối — cùng điều kiện với nhãn tên.
    if (run!.classList.contains("opens") && col.querySelectorAll(".bubble").length === 0) {
      node.classList.add("first");
    }
    col.append(node);
  }
  return out;
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

function paint(): void {
  const selected = state.agents.find((a) => a.id === state.selected);
  root.replaceChildren(el(`<div class="shell${state.paneOpen ? "" : " no-pane"}">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-row">
          <strong>grokbot2</strong>
          <button type="button" class="new-icon" data-act="new" title="bot mới">+</button>
        </div>
        <small>native /v1 · không qua Cursor ACL</small>
      </div>
      <label class="search">
        <span class="ico">⌕</span>
        <input type="search" placeholder="Tìm bot" value="${escapeHtml(state.query ?? "")}" />
      </label>
      <div class="roster"></div>
      <div class="side-actions">
        <button type="button" class="primary" data-act="new">bot mới</button>
        <button type="button" class="ghost" data-act="hidden">${state.showHidden ? "giấu bot ẩn" : "hiện bot ẩn"}</button>
        <button type="button" class="danger" data-act="del" ${selected ? "" : "disabled"}>xóa</button>
      </div>
    </aside>
    <section class="chat">
      <div class="chat-head">
        ${selected ? `<button type="button" class="avatar-btn" data-act="avatar" title="đổi ảnh">${avatarOf(selected)}</button>` : ""}
        <h1>${escapeHtml(selected?.name ?? "chọn một bot")}</h1>
        <div class="head-actions">
          <span class="status">${selected?.presence.isRunning ? "đang trả lời" : "sẵn sàng"}</span>
          <button type="button" class="ghost" data-act="rename" ${selected ? "" : "disabled"}>đổi tên</button>
          <button type="button" class="ghost" data-act="avatar" ${selected ? "" : "disabled"}>ảnh</button>
          <button type="button" class="icon-btn" data-act="pane" aria-label="${state.paneOpen ? "Đóng panel" : "Mở panel"}" title="${state.paneOpen ? "Đóng panel" : "Mở panel"}">${state.paneOpen ? "›" : "‹"}</button>
          <button type="button" class="ghost" data-act="hide" ${selected ? "" : "disabled"}>${selected?.hidden ? "hiện" : "ẩn"}</button>
        </div>
      </div>
      ${state.error ? `<div class="err">${escapeHtml(state.error)}</div>` : ""}
      <div class="transcript"></div>
      <form class="composer">
        <div class="pending" hidden></div>
        <label class="attach" title="gửi ảnh">+<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" ${selected ? "" : "disabled"} /></label>
        <textarea name="q" rows="1" aria-label="Prompt" placeholder="Hỏi bất cứ điều gì, hoặc kéo tệp vào." ${selected ? "" : "disabled"}></textarea>
        ${SPEECH_OK ? `<button type="button" class="mic" data-act="mic" aria-label="Đọc để nhập" title="Đọc để nhập" ${selected ? "" : "disabled"}>◉</button>` : ""}
        <button type="submit" class="send" title="gửi" ${selected && !state.busy && !selected?.presence.isRunning ? "" : "disabled"}>↑</button>
        <button type="button" class="stop" data-act="stop" title="dừng" ${selected?.presence.isRunning ? "" : "disabled"}>■</button>
      </form>
    </section>
    <aside class="computer">
      <div class="head"><span>Màn hình</span><span class="state">${state.computer?.state === "running" ? "live" : "off"}</span></div>
      <div class="screen">${screenPane(state.computer)}</div>
      <div class="caption">${escapeHtml(selected ? `Màn hình của ${selected.name}` : "chưa chọn bot")}</div>
      <div class="routines">
        <p>Routine là việc lặp lại theo lịch mà bot tự chạy.</p>
        <button type="button" data-act="routine" ${selected ? "" : "disabled"}>Tạo routine</button>
      </div>
    </aside>
  </div>`));

  const roster = root.querySelector(".roster")!;
  const q = state.query.trim().toLowerCase();
  const shown = q ? state.agents.filter((a) => a.name.toLowerCase().includes(q)) : state.agents;
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
    if (g.name) roster.append(el(`<div class="group">${escapeHtml(g.name)}</div>`));
    for (const a of rowsFor(g.items)) {
    const item = el(`<button type="button" class="bot ${a.id === state.selected ? "active" : ""} ${a.hidden ? "dim" : ""}">
      ${avatarOf(a)}
      <span class="name">${escapeHtml(a.name)}</span>
      ${a.presence.isRunning || a.unread
        ? `<span class="dot${a.presence.isRunning ? " live" : ""}"></span>`
        : `<span class="when">${escapeHtml(shortTime(a.updatedAtMs))}</span>`}
      <span class="preview">${escapeHtml(preview(a))}</span>
    </button>`);
      item.onclick = () => { state.selected = a.id; void loadTranscript(); void loadComputer(); paint(); };
      roster.append(item);
    }
  }

  const search = root.querySelector<HTMLInputElement>(".search input");
  if (search) {
    // `paint()` dựng lại cả cây DOM, nên phải trả lại focus và vị trí con trỏ, nếu không
    // gõ được đúng một ký tự rồi mất focus.
    search.oninput = () => { state.query = search.value; paint(); };
    if (state.query) {
      const next = root.querySelector<HTMLInputElement>(".search input")!;
      next.focus();
      next.setSelectionRange(next.value.length, next.value.length);
    }
  }

  const log = root.querySelector(".transcript")!;
  /*
   * Hai trạng thái rỗng KHÁC nhau, app gốc phân biệt: chưa chọn bot ("No Bot selected.") và đã
   * chọn nhưng hội thoại trống. Trước đây cả hai đều ra một câu, tức nói sai với người vừa mở app.
   */
  if (!selected) log.append(el(`<div class="empty">Chưa chọn bot.</div>`));
  else if (!state.entries.length) log.append(el(`<div class="empty">Bắt đầu một cuộc trò chuyện.</div>`));
  for (const node of renderRuns(state.entries)) log.append(node);
  log.scrollTop = log.scrollHeight;

  root.querySelector<HTMLButtonElement>("[data-act=new]")!.onclick = async () => {
    const name = prompt("Tên bot?", "Claude");
    if (!name) return;
    const created = await api.createAgent(name.trim());
    state.selected = created.agent.id;
    await refreshRoster();
  };
  root.querySelector<HTMLButtonElement>("[data-act=del]")!.onclick = async () => {
    if (!state.selected || !confirm("Xóa bot này?")) return;
    await api.deleteAgent(state.selected);
    state.selected = "";
    state.entries = [];
    await refreshRoster();
  };
  root.querySelector<HTMLButtonElement>("[data-act=hidden]")!.onclick = () => {
    state.showHidden = !state.showHidden;
    void refreshRoster();
  };
  root.querySelector<HTMLButtonElement>("[data-act=rename]")!.onclick = async () => {
    if (!state.selected) return;
    const current = state.agents.find((a) => a.id === state.selected)?.name ?? "";
    const name = prompt("Tên bot?", current);
    if (!name?.trim() || name.trim() === current) return;
    try {
      await api.renameAgent(state.selected, name.trim());
      state.error = "";
    } catch (e) {
      state.error = e instanceof Error ? e.message : String(e);
    }
    await refreshRoster();
    await loadTranscript();
  };
  root.querySelector<HTMLButtonElement>("[data-act=hide]")!.onclick = async () => {
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
  root.querySelector<HTMLButtonElement>("[data-act=pane]")!.onclick = () => {
    state.paneOpen = !state.paneOpen;
    paint();
  };
  const mic = root.querySelector<HTMLButtonElement>("[data-act=mic]");
  if (mic) mic.onclick = () => toggleDictation(mic);
  root.querySelectorAll<HTMLButtonElement>('[data-act=avatar]').forEach((btn) => {
    btn.onclick = () => { if (selected) openAvatarPicker(selected); };
  });
  root.querySelector<HTMLButtonElement>("[data-act=stop]")!.onclick = async () => {
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
  root.querySelector("form")!.onsubmit = async (ev) => {
    ev.preventDefault();
    const box = root.querySelector("textarea")!;
    const content = box.value.trim();
    const attachments = state.pending.map((p) => ({ path: p.path, name: p.name }));
    if ((!content && !attachments.length) || !state.selected) return;
    box.value = "";
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

async function loadTranscript(): Promise<void> {
  if (!state.selected) { state.entries = []; paint(); return; }
  state.entries = (await api.getTranscript(state.selected)).entries;
  paint();
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
  await refreshRoster();
  await loadTranscript();
  await loadComputer();
  mountLogout();
  void refreshUpgrade();
  const ac = new AbortController();
  void api.listenEvents((name, data) => {
    const d = data as { agentId?: string };
    if (name === "agent.upserted") { void refreshRoster(); void refreshUpgrade(); }
    if (name === "transcript.append" && (!d.agentId || d.agentId === state.selected)) void loadTranscript();
    if (name === "computer.status" && d.agentId === state.selected) void loadComputer();
  }, ac.signal).catch((e) => {
    if (e instanceof DOMException && e.name === "AbortError") return;
    state.error = `SSE: ${e instanceof Error ? e.message : e}`;
    paint();
  });
}

/** A floating sign-out control, mounted on <body> so `paint()` (which owns #app) never wipes it. */
function mountLogout(): void {
  document.getElementById("gb2-logout")?.remove();
  const btn = document.createElement("button");
  btn.id = "gb2-logout";
  btn.className = "gb2-logout";
  btn.textContent = `⎋ ${api.currentEmail() || "đăng xuất"}`;
  btn.title = "Đăng xuất";
  btn.addEventListener("click", async () => { await api.logout(); location.reload(); });
  document.body.append(btn);
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
