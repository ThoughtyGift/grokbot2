/**
 * "Teach a task" — record what somebody demonstrates in the box's browser, save it as a routine.
 *
 * The vendor does this on their own machines; none of it is in the client bundle, which only
 * forwards three calls and expects a state object back. So the recorder is ours to build, and the
 * pieces were already here: the box's Chrome is reachable over CDP (the same tab the VNC pane
 * shows), and routines already store and replay a task. This is the wire between them.
 *
 * The client's contract, read off the bundle rather than guessed:
 *
 *     start({agentId, entryPoint})  -> state
 *     stop({agentId, save})         -> state
 *     status()                      -> state
 *     state = {state: "idle"|"recording", agentId, startedAtMs, maxDurationMs}
 *
 * The REPLY IS THE STATE. The renderer sets an optimistic `recording` and then overwrites it with
 * whatever comes back, so a reply that omits `state` pushes its state machine into a value it has
 * no branch for — which is exactly how this used to leave the pane spinning on "Starting desktop".
 *
 * What it cannot do: only actions inside the box's Chrome are events. A desktop app outside the
 * browser reaches us as pixels over VNC and nothing more, so it cannot be taught this way.
 */
import { cdpForAgent, onCdpEvent } from "./browser.js";
import { automationCreateRef, automationRefineRef, teachHandoffRef } from "./chat/state.js";
import { batDauQuayDemo, dungQuayDemo, banGiaoBaiHoc, xepHangBaiHoc } from "./teach-demo.js";
import { create as taoSkill, forAgent as skillCuaBot, update as suaSkill } from "./workflows.js";
import { publish } from "./events.js";
import { callPool } from "@grokbot2/pool-client";
import { config, loadPoolKey } from "./config.js";

/** The client's own limit (`600 * 1e3` in the bundle). Sending a different one desynchronises its countdown. */
const MAX_DURATION_MS = 600_000;

export interface TeachState {
  state: "idle" | "recording";
  agentId: string | null;
  startedAtMs: number | null;
  maxDurationMs: number;
}

export const IDLE: TeachState = { state: "idle", agentId: null, startedAtMs: null, maxDurationMs: MAX_DURATION_MS };

export interface Step {
  act: "click" | "fill" | "navigate" | "key";
  sel?: string;
  text?: string;
  value?: string;
  /** Giá trị đã bị che vì nhạy cảm — bên lưu đếm để quyết định có tạo routine không. */
  masked?: boolean;
  url?: string;
  /** Phím chức năng: Enter/Tab/Escape. Chỉ có ở bước `key`. */
  key?: string;
  /** Lúc backend nhận được bước, để phân biệt điều hướng do người mở với điều hướng do cú bấm. */
  t?: number;
}

/** One recording at a time: the pane is modal and the box has one screen. */
let active: {
  agentId: string; startedAtMs: number; timer: NodeJS.Timeout;
  steps: Step[]; off: () => void;
  /** Bản quay màn hình chạy SONG SONG — xem `startTeach`. Null khi không có box. */
  quay: Promise<{ ok: boolean; lyDo?: string }> | null;
} | null = null;

/**
 * Nút `+` đi đường nào — quyết định 06/09 (§5 mục 14 bảng theo dõi).
 *
 * Hãng 0.30/0.43: video màn hình → tin `teach-recording` → BOT tự học trong một lượt chat → skill có
 * `{input}` → thẻ `sand-workflow:<slug>` → mời chạy thử. Bên mình tới 05/09: sự kiện DOM qua CDP →
 * backend chép thành routine + skill, `hocNen` đặt tên nền — chính xác selector nhưng không hiểu ý
 * định, và người dùng không thấy gì trong chat.
 *
 * Chọn đường VIDEO làm đường chính vì nó là thứ người dùng nhìn thấy khớp với app gốc, và vì bài
 * học thành văn bản đọc được. Nhưng KHÔNG bỏ bộ ghi CDP: nó chạy cùng lúc, và nhật ký của nó đi kèm
 * video làm "lịch sử Chrome" — hãng đối chiếu lịch sử trình duyệt để khớp từng bước, ta có thứ tốt
 * hơn là chính selector và URL đã bấm. Không có box (không quay được) thì rơi về đường cũ nguyên
 * vẹn, nên máy không có box vẫn dạy được.
 */
function duongVideo(run: NonNullable<typeof active>, video: { ok: boolean }): boolean {
  return run.quay != null && video.ok && teachHandoffRef != null;
}

/**
 * The recorder, injected into the page.
 *
 * `Page.addScriptToEvaluateOnNewDocument` re-runs this on every navigation, so the listeners
 * survive a page change — a taught task that starts on a login page and ends on a dashboard would
 * otherwise stop recording at the first click.
 *
 * Selector preference is id → aria-label → name → first class → tag, and it is recorded so a replay
 * can say how much to trust it: `#id` is stable, a bare tag is a guess.
 */
const BINDING = "__grokTeachStep";

const RECORDER = `(() => {
  if (window.__grokTeachArmed) return;
  // Only the top frame records. addScriptToEvaluateOnNewDocument arms EVERY frame, and a real news
  // site loads a dozen ad iframes that each announce themselves — a demonstration of "open the site,
  // click a headline, click another" came back as 14 steps of which 8 were banner iframes loading
  // cdn.../html5_banner_thuong_.../index.html. Nobody demonstrated those.
  //
  // The cost is an app embedded in an iframe, which cannot be taught this way. That is rarer than
  // advertising, and a step list full of ad frames is not a lesser problem than a missing one.
  if (window.top !== window) return;
  window.__grokTeachArmed = true;
  // Every step leaves the page immediately. Keeping them in a page array was the first version and
  // it silently lost everything on navigation: \`addScriptToEvaluateOnNewDocument\` re-arms the
  // listeners on the new document, but the new document has a new \`window\` and a new empty array.
  // A binding call reaches the backend, which is the only place that outlives the page.
  const out = (s) => { try { window.${BINDING}(JSON.stringify(s)); } catch (e) { /* binding gone */ } };
  const steps = [];
  // What was clicked is often a leaf inside the thing that was MEANT to be clicked: an icon's
  // \`svg\`, its \`path\`, a \`span\` of label text. A real recording on a React/Tailwind app came back
  // with "bấm \`path\`" and "bấm \`svg\`" — true about the DOM and useless to replay. Walk up to the
  // nearest thing a person can actually click, which is also where the aria-label and the text live.
  const actionable = (el) => {
    for (let n = el, hops = 0; n && n.tagName && hops < 5; n = n.parentElement, hops++) {
      const tag = n.tagName.toLowerCase();
      if (tag === "button" || tag === "a" || tag === "input" || tag === "select" ||
          tag === "textarea" || tag === "label" || tag === "summary") return n;
      const role = n.getAttribute && n.getAttribute("role");
      if (role === "button" || role === "link" || role === "menuitem" || role === "tab") return n;
      if (n.getAttribute && n.getAttribute("aria-label")) return n;
    }
    return el;
  };
  const sel = (el) => {
    if (!el || !el.tagName) return { sel: "?", quality: "none" };
    if (el.id) return { sel: "#" + el.id, quality: "id" };
    const aria = el.getAttribute && el.getAttribute("aria-label");
    if (aria) return { sel: '[aria-label="' + aria.replace(/"/g, '\\\\"') + '"]', quality: "aria" };
    const name = el.getAttribute && el.getAttribute("name");
    if (name) return { sel: el.tagName.toLowerCase() + '[name="' + name + '"]', quality: "name" };
    if (typeof el.className === "string" && el.className.trim()) {
      return { sel: "." + el.className.trim().split(/\\s+/)[0], quality: "class" };
    }
    return { sel: el.tagName.toLowerCase(), quality: "tag" };
  };
  const push = (step) => {
    const last = steps[steps.length - 1];
    // The same field fires change more than once and a click can bubble twice; a repeat of the
    // previous step is noise, not a second action.
    if (last && last.act === step.act && last.sel === step.sel && last.value === step.value) return;
    steps.push(step);
    out(step);
  };
  // Ô đang được gõ vào, và hàm xả nó thành một bước. Khai báo trước listener 'click' vì listener đó
  // gọi 'xaGo'; thân hàm được gán ở dưới, cạnh phần bàn phím mà nó thuộc về.
  let dangGo = null;
  let xaGo = () => {};
  document.addEventListener("click", (e) => {
    // Gõ xong rồi bấm đi chỗ khác là cách rời một ô phổ biến nhất, và \`change\` không phải lúc nào
    // cũng bắn. Xả chữ đang gõ TRƯỚC cú bấm để thứ tự các bước đúng như người đã làm.
    xaGo();
    const t = actionable(e.target);
    const s = sel(t);
    push({ act: "click", sel: s.sel, quality: s.quality, text: (t.textContent || "").trim().slice(0, 60) });
  }, true);
  /*
   * Che thông tin nhạy cảm — và vì sao KHÔNG che theo hình dạng số.
   *
   * Bản trước chỉ che 'input[type=password]'. Mọi ô khác ghi nguyên văn, cắt 120 ký tự — rồi bản
   * ghi ấy thành một routine SỐNG MÃI, đọc được từ bảng Routines. Ô OTP hầu như luôn là
   * 'type="text"'; khoá API dán vào ô text cũng vậy; số thẻ trên phần lớn trang thanh toán cũng vậy.
   *
   * App gốc 0.30 nói rõ phạm vi trong skill 'learn-from-demonstration': "passwords, one-time codes,
   * API keys, financial account numbers, and private personal details".
   *
   * Nhưng có một đánh đổi thật: che một giá trị THẬT thì bước đó không replay được nữa. Nên chỉ che
   * theo **tín hiệu mạnh** — ô tự khai là gì ('type', 'autocomplete', tên/nhãn), hoặc giá trị mang
   * dấu hiệu không thể nhầm (tiền tố khoá, số thẻ qua Luhn). KHÔNG che một dãy 4–8 chữ số trần: nó
   * có thể là mã OTP, mà cũng có thể là số lượng, năm, mã bưu chính — che nó là làm hỏng những bài
   * dạy bình thường để đổi lấy một trường hợp hiếm.
   */
  const nhanO = (t) => {
    let s = "";
    for (const k of ["name", "id", "placeholder", "aria-label", "autocomplete"]) {
      const v = t.getAttribute && t.getAttribute(k);
      if (v) s += " " + v;
    }
    return s.toLowerCase();
  };
  const oNhayCam = (t) => {
    if (!t) return false;
    if (t.type === "password") return true;
    const ac = ((t.getAttribute && t.getAttribute("autocomplete")) || "").toLowerCase();
    if (/one-time-code|cc-number|cc-csc|cc-exp|current-password|new-password/.test(ac)) return true;
    return /otp|one.?time|verif|passcode|\bpin\b|cvv|cvc|card.?number|creditcard|iban|account.?number|routing|api.?key|apikey|secret|token/.test(nhanO(t));
  };
  /** Luhn — số thẻ hợp lệ thì không thể là số lượng hay năm. */
  const laSoThe = (v) => {
    const d = String(v).replace(/[\s-]/g, "");
    if (!/^[0-9]{13,19}$/.test(d)) return false;
    let sum = 0, alt = false;
    for (let i = d.length - 1; i >= 0; i--) {
      let n = +d[i];
      if (alt) { n *= 2; if (n > 9) n -= 9; }
      sum += n; alt = !alt;
    }
    return sum % 10 === 0;
  };
  const laKhoa = (v) => {
    const x = String(v).trim();
    if (/^(sk-|hal_|ghp_|gho_|github_pat_|xox[abprs]-|AKIA|ASIA|AIza|Bearer\s)/i.test(x)) return true;
    // Chuỗi dài không có khoảng trắng, lẫn cả chữ lẫn số: dạng của khoá dán vào, không phải câu chữ.
    return x.length >= 32 && !/\s/.test(x) && /[0-9]/.test(x) && /[A-Za-z]/.test(x);
  };
  const giaTriNhayCam = (v) => laSoThe(v) || laKhoa(v);

  /** Ghi giá trị một ô thành bước 'fill', che nếu nhạy cảm. Dùng chung cho 'change' và bàn phím. */
  const ghiO = (t) => {
    const s = sel(t);
    const raw = String(t && t.value != null ? t.value : "");
    if (oNhayCam(t) || giaTriNhayCam(raw)) {
      // 'masked' để bên lưu đếm được — xem 'desktop_teach_stop'.
      push({ act: "fill", sel: s.sel, quality: s.quality, value: "***", masked: true });
      return;
    }
    push({ act: "fill", sel: s.sel, quality: s.quality, value: raw.slice(0, 120) });
  };
  document.addEventListener("change", (e) => { dangGo = null; ghiO(e.target); }, true);

  /*
   * Bàn phím.
   *
   * Bản trước chỉ nghe 'click' và 'change'. Đo trên bài 24h.com.vn: người dạy gõ "24h" rồi Enter, và
   * routine sinh ra KHÔNG có bước điền nào — mất đúng chữ quyết định bài đó là bài gì. Lý do là
   * Google chặn Enter bằng JS rồi tự điều hướng, nên ô tìm kiếm không bao giờ blur để 'change' bắn.
   *
   * Không ghi từng phím một: ba mươi bước "gõ chữ n" thì không ai đọc nổi. Thay vào đó nhớ ô đang
   * được gõ, rồi XẢ nó thành một bước 'fill' khi người ta rời ô — bằng Enter/Tab/Escape, hoặc bằng
   * một cú bấm. Xả qua 'ghiO' nên vẫn đi qua đúng bộ lọc che.
   */
  const PHIM_ROI = { Enter: "Enter", Tab: "Tab", Escape: "Escape" };
  xaGo = () => {
    const t = dangGo;
    dangGo = null;
    if (t && String(t.value != null ? t.value : "")) ghiO(t);
  };
  // Nghe 'input' chứ KHÔNG phải 'keydown' để biết ô nào đang được nhập.
  //
  // 'keydown' chỉ thấy người gõ từng phím. Nó bỏ sót DÁN, tự điền của trình duyệt, và IME tiếng
  // Việt — mà dán chính là cách người ta nhập khoá API và số thẻ, đúng những thứ phần che ở trên
  // sinh ra để bắt. 'input' bắn cho cả bốn.
  document.addEventListener("input", (e) => {
    const t = e.target;
    if (t && "value" in t) dangGo = t;
  }, true);
  // Bàn phím chỉ còn lo phím RỜI ô: chúng vừa là bước riêng, vừa là lúc xả chữ đang gõ.
  document.addEventListener("keydown", (e) => {
    const ten = PHIM_ROI[e.key];
    if (!ten) return;
    xaGo();
    push({ act: "key", key: ten });
  }, true);
  push({ act: "navigate", url: location.href });
})()`;

/** Begin recording in the bot's own tab. Returns the state the client will adopt verbatim. */
/**
 * Kênh `teach-recording` — pane của client sống bằng nó.
 *
 * Phát ở MỌI chỗ trạng thái đổi, kể cả khi hết giờ hay bị đóng lúc tắt máy: pane đọc luồng, nên
 * một lần đổi không phát là pane đứng nguyên ở "đang ghi" trong khi máy đã dừng từ lâu.
 */
const pushState = (): void => { publish({ type: "teach.recording", state: recordingState() as unknown as Record<string, unknown> }); };

export async function startTeach(agentId: string): Promise<TeachState> {
  if (active) return recordingState();
  const id = agentId || "default";
  const steps: Step[] = [];
  // Collect BEFORE arming, so a step fired during setup is not dropped.
  const off = onCdpEvent((method, params) => {
    if (method !== "Runtime.bindingCalled" || params?.name !== BINDING) return;
    try {
      const step = JSON.parse(String(params.payload)) as Step;
      // A cap, because a page with a mousemove-happy widget could otherwise grow this without end.
      // Mốc giờ đóng ở ĐÂY chứ không phải trong trang: một cú bấm làm trang đổi thì `window` cũ mất,
      // và bước điều hướng theo sau lại do document mới đóng dấu — hai đồng hồ khác nhau. Backend là
      // chỗ duy nhất thấy cả hai bước bằng cùng một đồng hồ.
      if (steps.length < 300) steps.push({ ...step, t: Date.now() });
    } catch { /* not our payload */ }
  });
  try {
    await cdpForAgent(id, "Runtime.enable");
    await cdpForAgent(id, "Page.enable");
    // The binding outlives navigations, which is the whole point of using one.
    await cdpForAgent(id, "Runtime.addBinding", { name: BINDING });
    // Re-arm the listeners on every new document, and on the page already open.
    await cdpForAgent(id, "Page.addScriptToEvaluateOnNewDocument", { source: RECORDER });
    await cdpForAgent(id, "Runtime.evaluate", { expression: RECORDER, returnByValue: true });
  } catch (e) {
    off();
    console.warn(`[grokbot2] [teach] cannot start: ${(e as Error).message}`);
    return IDLE;
  }
  // The client stops itself at ten minutes; this is the backend not being left recording for ever
  // if the app is closed mid-take.
  const timer = setTimeout(() => { void stopTeach(id, false); }, MAX_DURATION_MS + 30_000);
  /*
   * Quay màn hình SONG SONG, không chờ: ffmpeg mất ~2 s để lên, và reply của lệnh này là trạng thái
   * pane — giữ nó thêm 2 s là lớp phủ "watching" của client đứng trước backend lâu hơn nữa (bẫy §7).
   * Kết quả đọc ở `stopTeach`. Không quay được (không box, ffmpeg hỏng) thì không phải lỗi: đường CDP
   * vẫn ghi, và lúc dừng sẽ đi đường cũ.
   */
  const quay = batDauQuayDemo(id).catch((e: Error) => ({ ok: false, lyDo: e.message }));
  active = { agentId: id, startedAtMs: Date.now(), timer, steps, off, quay };
  console.log(`[grokbot2] [teach] recording for ${id}`);
  pushState();
  return recordingState();
}

export function recordingState(): TeachState {
  if (!active) return IDLE;
  return { state: "recording", agentId: active.agentId, startedAtMs: active.startedAtMs, maxDurationMs: MAX_DURATION_MS };
}

/**
 * Stop listening and disarm the page.
 *
 * The steps are already here — they arrived one binding call at a time — so this reads nothing back
 * out of the page. That is the fix for the version that did: whatever the page still held was only
 * ever the steps from the LAST document.
 */
async function finish(agentId: string): Promise<void> {
  try {
    await cdpForAgent(agentId, "Runtime.removeBinding", { name: BINDING });
  } catch { /* session may be gone */ }
  try {
    await cdpForAgent(agentId, "Runtime.evaluate", { expression: `delete window.__grokTeachArmed`, returnByValue: true });
  } catch { /* tab may be gone */ }
}

/**
 * Turn a step list into the prompt a routine runs.
 *
 * Written for the agent that will replay it, not for a machine: the browser tools take a selector
 * and a value, so the steps are given in those terms, and the weak selectors are called out so the
 * agent looks at the page instead of trusting `.btn` blindly.
 */
/**
 * Điều hướng này có phải HỆ QUẢ của bước trước không?
 *
 * Bấm một link rồi trang đổi — cú bấm là việc người ta làm, còn URL mới là kết quả. Ghi cả hai thì
 * routine vừa thừa vừa giòn: đo trên bài 24h.com.vn, bước "mở lại URL kết quả Google" mang theo
 * `ei`/`ved` đã hết hạn, chép lại chỉ để hỏng.
 *
 * Mốc giờ do backend đóng lúc nhận bước. Thiếu mốc giờ thì tin vào thứ tự, vì thứ tự là thứ duy
 * nhất còn lại.
 */
function laHeQua(nav: Step, truoc: Step | undefined): boolean {
  if (!truoc || (truoc.act !== "click" && truoc.act !== "key")) return false;
  if (nav.t == null || truoc.t == null) return true;
  return nav.t - truoc.t < 3000;
}

export function stepsToPrompt(steps: Step[]): string {
  const lines: string[] = [];
  let n = 0;
  // Bước `navigate` ĐẦU TIÊN là nơi tab đang đứng lúc bật ghi, không ai mở nó trong buổi dạy. Lần
  // chạy đo được ghi nguyên URL kết quả Google còn sót từ phiên trước thành "bước 1". Nhánh
  // `about:`/`data:` bên dưới đã chặn đúng ý này rồi, nhưng một URL http sót lại thì lọt qua.
  /*
   * Bước 0 là nơi tab đang đứng lúc bật ghi — bộ ghi đóng nó ngay lúc gài, trước khi sự kiện nào
   * kịp bắn. Nhưng KHÔNG phải lúc nào cũng bỏ được: nếu người dạy đã mở sẵn trang cần dạy rồi mới
   * bật ghi thì đó chính là điểm bắt đầu, bỏ đi là routine không biết mở ở đâu.
   *
   * Chỉ bỏ khi nó bị THAY THẾ ngay: bước kế tiếp cũng là một điều hướng, nghĩa là người ta đi chỗ
   * khác luôn và nơi xuất phát không còn nghĩa gì. Đó đúng là ca đo được trên bài 24h.com.vn — tab
   * còn nằm ở URL kết quả Google của phiên trước, rồi buổi dạy mở google.com đè lên.
   */
  const boDau = steps[0]?.act === "navigate" && steps[1]?.act === "navigate";
  let truoc: Step | undefined;
  for (const [i, s] of steps.entries()) {
    if (i === 0 && boDau) continue;
    if (s.act === "navigate" && laHeQua(s, truoc)) continue;
    truoc = s;
    const q = (s as { quality?: string }).quality;
    const weak = q === "class" || q === "tag" ? "  (selector yếu — kiểm lại trên trang trước khi bấm)" : "";
    if (s.act === "navigate" && s.url) {
      // `about:blank` and `data:` are where a fresh tab happens to be sitting, not a place a replay
      // can navigate back to. Recording one as step 1 buried the real first action under a wall of
      // percent-encoding. A long http URL is truncated instead: the host and path are what identify
      // it, and the agent has the page in front of it.
      if (/^(about:|data:)/i.test(s.url)) continue;
      // NOT truncated. A cut URL cannot be opened, so shortening one turns an actionable step into
      // a dead one — five of the fourteen steps in the first real recording ended in an ellipsis and
      // none of those five could have been replayed. Length is capped by the step count instead.
      lines.push(`${++n}. mở ${s.url}`);
      continue;
    }
    if (s.act === "click") { lines.push(`${++n}. bấm \`${s.sel}\`${s.text ? ` ("${s.text}")` : ""}${weak}`); continue; }
    if (s.act === "fill") { lines.push(`${++n}. điền \`${s.sel}\` = "${s.value ?? ""}"${weak}`); continue; }
    // Nhánh này từng thiếu, và `act:"key"` chỉ tồn tại trong khai báo kiểu — một nhánh chết trông
    // như đã làm xong. Không có nó thì Enter biến mất khỏi mọi bài dạy có tìm kiếm.
    if (s.act === "key" && s.key) { lines.push(`${++n}. nhấn ${s.key}`); continue; }
  }
  if (!lines.length) return "";
  return [
    "Làm lại đúng các bước sau trong trình duyệt (dùng các tool browser_*):",
    "",
    ...lines,
    "",
    "Nếu một bước không khớp trang thật thì DỪNG và nói rõ bước nào, đừng đoán bước tiếp theo.",
  ].join("\n");
}

/**
 * Stop, and save when asked.
 *
 * A save with nothing recorded creates nothing: an empty routine would sit in the panel looking
 * like a taught task and do nothing when run. `discardedBecauseEmpty` is what the caller reports.
 */
// ── Cho một lượt model đọc lại buổi dạy ────────────────────────────────────────────────────────
//
// Đây là chỗ khác app gốc sâu nhất. Của ta: `stepsToPrompt()` CHÉP bản ghi ra chữ, không ai đọc.
// App gốc: một lượt model xem hết video rồi mới viết skill — nên nó đặt được tên cho việc, nhận ra
// đường đi vòng và đổi sang đường thẳng, và hiểu "bài nổi bật" thay vì ghim bài của hôm nay.
//
// Đo trên bài 24h.com.vn: app gốc ra `Read 24h.com.vn news` đi thẳng vào trang chủ; ta ra
// `Việc đã dạy — 08-29 08:31` đi vòng qua Google. Không luật nào trong `stepsToPrompt` bù được,
// vì khái quát hoá cần người đọc.

/**
 * Rút bản ghi thành lời cho MODEL đọc — khác `stepsToPrompt` ở chỗ giữ lại MỌI thứ.
 *
 * `stepsToPrompt` bỏ điều hướng hệ quả vì đó không phải việc ai làm. Model thì CẦN chúng: chính
 * chúng nói một cú bấm dẫn tới đâu, và không biết đích đến thì không thể rút ngắn đường đi.
 */
export function stepsForModel(steps: Step[]): string {
  const out: string[] = [];
  steps.forEach((s, i) => {
    const n = i + 1;
    if (s.act === "navigate") {
      const vi = i === 0 ? "nơi tab đang đứng lúc bật ghi"
        : laHeQua(s, steps[i - 1]) ? "trang tự chuyển tới sau thao tác trên"
        : "người tự mở";
      out.push(`${n}. [${vi}] ${s.url ?? ""}`);
      return;
    }
    if (s.act === "click") { out.push(`${n}. [bấm] ${s.sel}${s.text ? ` — chữ trên đó: "${s.text}"` : ""}`); return; }
    if (s.act === "fill") {
      out.push(`${n}. [điền] ${s.sel} = ${s.masked ? "(giá trị nhạy cảm, đã che ngay lúc ghi)" : `"${s.value ?? ""}"`}`);
      return;
    }
    if (s.act === "key" && s.key) out.push(`${n}. [phím] ${s.key}`);
  });
  return out.join("\n");
}

const LUAT_HOC = [
  "Đây là bản ghi thao tác của một người đang DẠY VIỆC cho bot bằng cách tự làm mẫu trong trình duyệt.",
  "Việc của bạn: đặt tên cho việc đó, và viết lại thành các bước để lần sau bot tự làm.",
  "",
  "Trả lời DUY NHẤT bằng JSON, không kèm chữ nào khác:",
  '{"ten":"...","buoc":["...","..."],"ghiChu":"..."}',
  "",
  "Luật:",
  "- ten: nói việc đó LÀM GÌ. Tiếng Việt, tối đa 60 ký tự, KHÔNG chứa ngày giờ.",
  "- buoc: chỉ dùng thông tin có trong bản ghi. TUYỆT ĐỐI không thêm bước không ai làm.",
  "- Dòng [trang tự chuyển tới] là hệ quả của thao tác ngay trên nó, không phải việc ai làm — đừng",
  "  chép nó thành một bước. Nhưng HÃY dùng nó để biết một cú bấm dẫn tới đâu.",
  "- Được RÚT NGẮN đường đi khi bản ghi cho thấy đích đến: nếu người ta tìm trên Google rồi bấm vào",
  "  một trang, hãy đi thẳng vào trang đó. Nói lý do trong ghiChu.",
  "- Nếu một bước bám vào nội dung của HÔM NAY (một bài báo cụ thể, một đơn cụ thể), hãy viết thành",
  '  mô tả chung ("bài đầu tiên trên trang chủ") thay vì ghim đúng nội dung đó.',
  "- Giá trị đã che thì viết <cần người điền>. Đừng đoán.",
  "- ghiChu: MỘT câu về chỗ bạn đã đổi so với bản ghi thô, hoặc chuỗi rỗng nếu giữ nguyên.",
].join("\n");

/**
 * Đọc câu trả lời model.
 *
 * Trả `null` cho mọi thứ không chắc chắn. Bài dạy thô đã lưu xong trước khi lượt này chạy, nên từ
 * chối một câu trả lời đáng ngờ chỉ mất phần đẹp; nhận bừa thì hỏng cả routine mà không ai biết.
 */
export function docKetQuaHoc(text: string): { name: string; prompt: string } | null {
  const raw = String(text ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const dau = raw.indexOf("{");
  const cuoi = raw.lastIndexOf("}");
  if (dau < 0 || cuoi <= dau) return null;
  let o: { ten?: unknown; buoc?: unknown; ghiChu?: unknown };
  try { o = JSON.parse(raw.slice(dau, cuoi + 1)); } catch { return null; }

  const ten = String(o?.ten ?? "").trim();
  if (!ten || ten.length > 80) return null;
  // Một cái tên toàn ngày giờ chính là thứ lượt này sinh ra để thay.
  if (/\d{1,2}[-/:]\d{2}/.test(ten)) return null;

  const buoc = Array.isArray(o?.buoc)
    ? o.buoc.map((x) => String(x ?? "").trim()).filter(Boolean)
    : [];
  if (!buoc.length || buoc.length > 40) return null;
  if (buoc.some((b) => b.length > 300)) return null;

  const ghiChu = String(o?.ghiChu ?? "").trim();
  // Model hay tự đánh số lại; bỏ số của nó rồi đánh số của mình, kẻo ra "1. 1. mở …".
  const dong = buoc.map((b, i) => `${i + 1}. ${b.replace(/^\d+[.)]\s*/, "")}`);
  return {
    name: ten,
    prompt: [
      "Làm lại việc sau trong trình duyệt (dùng các tool browser_*):",
      "",
      ...dong,
      ...(ghiChu ? ["", `Ghi chú từ lúc học: ${ghiChu}`] : []),
      "",
      "Nếu một bước không khớp trang thật thì DỪNG và nói rõ bước nào, đừng đoán bước tiếp theo.",
    ].join("\n"),
  };
}

/**
 * Buổi dạy này chủ yếu là nhập thông tin bí mật?
 *
 * Luật của app gốc: *"If the demonstration was mostly entering credentials, say so and do not
 * create a skill."* Lý do thực tế chứ không phải lo xa: mọi giá trị bắt được đều đã bị che ngay
 * lúc ghi, nên routine ấy KHÔNG replay được — nó chỉ còn là một bản ghi rằng ai đó đã đăng nhập.
 *
 * Ngưỡng cố ý dè dặt. Đăng nhập một lần rồi làm mười việc vẫn là bài dạy tốt, nên chỉ từ chối khi
 * số ô bí mật nhiều bằng hoặc hơn TOÀN BỘ việc làm được.
 */
export function chuYeuLaBiMat(steps: Step[]): boolean {
  const che = steps.filter((s) => s.act === "fill" && s.masked).length;
  if (!che) return false;
  const viecThat = steps.filter((s) => s.act === "click" || (s.act === "fill" && !s.masked)).length;
  return che >= viecThat;
}

/**
 * Chạy NỀN, sau khi routine thô đã lưu.
 *
 * Không chặn câu trả lời của `stopTeach`: ở client câu trả lời CHÍNH LÀ trạng thái của pane, nên
 * giữ nó lại vài chục giây là pane đứng ở "đang ghi" trong khi máy đã dừng. Và lưu trước rồi sửa
 * sau còn có nghĩa là model hỏng, hết hạn mức, hay mất mạng thì bài dạy vẫn còn nguyên.
 */
async function hocNen(agentId: string, tenTho: string, steps: Step[]): Promise<void> {
  const key = loadPoolKey();
  if (!key || !automationRefineRef) return;
  try {
    const r = await callPool(
      [{ role: "user", content: `${LUAT_HOC}\n\nBản ghi:\n${stepsForModel(steps)}` }],
      { url: config.poolUrl, key, model: config.model, maxTokens: 1200, timeoutMs: 60_000 },
    );
    if (!r.ok || !r.text) { console.warn("[grokbot2] [teach] model không trả lời; giữ bản ghi thô"); return; }
    const dep = docKetQuaHoc(r.text);
    if (!dep) { console.warn("[grokbot2] [teach] câu trả lời model không dùng được; giữ bản ghi thô"); return; }
    const ok = automationRefineRef(agentId, tenTho, { name: dep.name, prompt: dep.prompt });
    // Skill mang cùng cái tên thô, nên nó cũng phải được đặt lại tên — nếu không menu `/` giữ
    // "Việc đã dạy — 08-31 09:12" mãi mãi, đúng thứ tên mà `hocNen` sinh ra để thay.
    const sk = skillCuaBot({ agentId }).find((w) => w.name === tenTho);
    if (sk) suaSkill({ workflowId: sk.id, name: dep.name, instructions: dep.prompt });
    console.log(ok
      ? `[grokbot2] [teach] đã đặt tên việc: "${dep.name}"`
      : `[grokbot2] [teach] không tìm thấy routine "${tenTho}" để sửa; giữ bản ghi thô`);
  } catch (e) {
    console.warn(`[grokbot2] [teach] học lỗi, giữ bản ghi thô: ${(e as Error).message}`);
  }
}

export async function stopTeach(agentId: string, save: boolean): Promise<TeachState & { saved?: string; steps?: number; refused?: string; handoff?: boolean }> {
  const id = active?.agentId ?? agentId ?? "default";
  const run = active;
  if (run) { clearTimeout(run.timer); run.off(); active = null; pushState(); }
  if (!run) return IDLE;

  const steps = run.steps;
  await finish(id);
  // Dừng ffmpeg dù lưu hay bỏ — một bản quay không ai dừng sẽ chạy tới hạn 10 phút và ăn CPU của bot.
  const video = (await run.quay) ?? { ok: false };
  const clip = video.ok ? await dungQuayDemo() : null;
  console.log(`[grokbot2] [teach] stopped for ${id}: ${steps.length} step(s), save=${save}, video=${clip ? `${clip.giay}s` : "không"}`);

  if (!save) return IDLE;
  if (clip && duongVideo(run, video)) {
    // Đường của hãng: BOT học. Host xếp phiên vào hàng đợi của bot (phiếu `pending/<sessionId>.json` + nhật ký CDP
    // `actions.md` trong thư mục phiên) RỒI mới bàn giao — tin chỉ tiêm queue scope, bot tự nhận phiếu. Không tạo
    // routine thô ở đây nữa — tạo sẽ ra hai skill cho một buổi dạy, và skill của bot mới là cái có `{input}`.
    await xepHangBaiHoc(clip, stepsForModel(steps));
    const h = banGiaoBaiHoc(clip);
    teachHandoffRef!(id, h);
    console.log(`[grokbot2] [teach] bàn giao cho bot: phiếu ${clip.sessionId}, ${steps.length} bước CDP kèm theo`);
    return { ...IDLE, steps: steps.length, handoff: true };
  }
  const prompt = stepsToPrompt(steps);
  if (!prompt) return { ...IDLE, steps: 0 };
  if (!automationCreateRef) return { ...IDLE, steps: steps.length };
  if (chuYeuLaBiMat(steps)) {
    const ly = "buổi dạy này gần như chỉ có nhập thông tin bí mật, nên tôi không lưu thành routine:"
      + " mọi giá trị đều đã bị che, chạy lại sẽ không điền được gì.";
    console.warn(`[grokbot2] [teach] từ chối lưu cho ${id}: chủ yếu là thông tin bí mật`);
    return { ...IDLE, steps: steps.length, refused: ly };
  }

  // "manual" is the trigger for a routine with no schedule: the Routines panel lists it, Run fires
  // it, and the scheduler has nothing to match — which is what a taught task wants until somebody
  // decides it should also run on a clock.
  const name = `Việc đã dạy — ${new Date().toISOString().slice(5, 16).replace("T", " ")}`;
  // The creator answers with the trigger's description ("manual"), which is not what the caller
  // asked; it wants to know WHAT was saved.
  automationCreateRef(id, { name, prompt, trigger: "manual" });
  /*
   * Lưu THÊM thành skill, không thay routine.
   *
   * Hai thứ trả lời hai câu hỏi khác nhau: routine là "chạy việc này theo lịch", skill là "gõ `/`
   * để bảo tôi làm lại việc này". App gốc bản mới biến buổi dạy thành skill
   * (`learn-from-demonstration`), và trước đây bên mình chỉ có nửa routine — dạy xong thì chỉ gọi
   * lại được từ bảng Routines, chứ không gọi được ngay trong lúc đang chat.
   *
   * Bỏ routine đi thì mất đường chạy theo lịch, nên giữ cả hai.
   */
  taoSkill({
    agentId: id,
    name,
    description: `Việc đã dạy trong trình duyệt · ${steps.length} bước`,
    instructions: prompt,
  });
  // Rồi mới nhờ model đặt tên và viết lại — nền, không chặn câu trả lời này. Xem `hocNen`.
  void hocNen(id, name, steps);
  return { ...IDLE, saved: name, steps: steps.length };
}

/** Shutdown: never leave a recorder armed in the box's browser. */
export function closeTeach(): void {
  if (active) { clearTimeout(active.timer); active.off(); active = null; }
}
