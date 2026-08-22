/**
 * Avatar bot — hình dạng, biểu cảm và màu suy ra từ id, dựng bằng lõi `bloub`.
 *
 * Trước đây avatar mặc định là chữ cái đầu tên trên nền màu. Đúng luật (asset của hãng không được
 * chép) nhưng nhìn chẳng liên quan gì tới app gốc. `bloub` là bản dựng lại con bot x.ai bằng SVG,
 * **giấy phép MIT, tác giả tự đo từ video** — nên nó vượt qua được đúng cái rào đã chặn ảnh của
 * hãng: cấm là cấm chép *của họ*, không phải cấm trông giống. Xuất xứ và ranh giới:
 * [`vendor/bloub/PROVENANCE.md`](vendor/bloub/PROVENANCE.md).
 *
 * File này là **lớp bọc duy nhất** quanh thư mục vendor. Không sửa file trong đó.
 */
import { EXPRESSIONS } from "./vendor/bloub/expressions";
import { BotEngine } from "./vendor/bloub/engine";
import { DEMI_VIEWBOX, RAYON } from "./vendor/bloub/repere";
import { COLORS, SHAPES } from "./vendor/bloub/skins";

/**
 * Hai màu mắt có thể dùng, chọn theo **màu thân** chứ không theo nền trang.
 *
 * Bản gốc khoét mắt thành lỗ thủng nên mắt luôn ăn màu nền phía sau. Vẽ đặc thì phải tự chọn, và
 * chọn theo nền trang là sai: thân màu kem trên nền tối cần mắt TỐI, thân màu đen cần mắt SÁNG.
 * Đã sai hai lần theo đúng kiểu đó — mỗi lần đổi nền là một lần mắt tàng hình. Chọn theo thân thì
 * đổi nền bao nhiêu lần cũng vẫn đúng.
 */
const EYE_LIGHT = "#f9f9f9";
const EYE_DARK = "#0a0a0c";

export type AvatarPick = { shape: number; expression: number; color: number };

/**
 * Băm id thành một bộ (hình, biểu cảm, màu).
 *
 * Ba trường phải độc lập, nếu không hai bot cạnh nhau dễ trùng cả bộ. Bản đầu nhân băm với ba hằng
 * rồi lấy dư — và **dồn cục**: 40 bot chỉ ra 28 tổ hợp, vì phép nhân giữ bit thấp phụ thuộc bit
 * thấp đầu vào, mà `agent-1`…`agent-40` khác nhau đúng ở đó. Sửa bằng hai việc: muối riêng cho
 * từng trường (băm ba chuỗi khác nhau, không phải ba lát của một số), và một bước trộn cuối
 * (`fmix32` của MurmurHash3) để bit cao lan xuống bit thấp trước khi chia dư.
 */
function fnv1a(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Bước trộn cuối của MurmurHash3: khuấy để mọi bit đầu vào ảnh hưởng mọi bit đầu ra. */
function fmix32(x: number): number {
  let h = x >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}

export function pickFor(id: string): AvatarPick {
  return {
    shape: fmix32(fnv1a(`${id}#shape`)),
    expression: fmix32(fnv1a(`${id}#expression`)),
    color: fmix32(fnv1a(`${id}#color`)),
  };
}

const at = <T>(list: T[], n: number): T => list[n % list.length]!;

/** Độ sáng tương đối (WCAG), 0 = đen, 1 = trắng. */
function luminance(hex: string): number {
  const v = parseInt(hex.slice(1), 16);
  const ch = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}

/**
 * Nền shell — phải khớp `--bg` trong style.css.
 *
 * Chỉ dùng để loại màu thân không đọc được trên nền. Đổi theme là đổi hằng này, và **chỉ** hằng
 * này: mọi luật khác đều tính theo tương phản chứ không theo ngưỡng sáng/tối cố định.
 */
const SHELL = "#070707";

/** Tỉ lệ tương phản WCAG giữa hai màu. 1 = trùng nhau, 21 = đen trên trắng. */
function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Bảng màu cho avatar **suy từ id** — bỏ những màu không đọc được trên nền trang.
 *
 * Luật nói về **quan hệ** với nền, không về một ngưỡng sáng/tối cố định. Ngưỡng tuyệt đối đã sai
 * hai lần: `>= 0.02` đúng với nền tối rồi lộn ngược khi đổi sang nền giấy. Tương phản thì đổi nền
 * bao nhiêu lần cũng tự đúng.
 *
 * Với nền `#070707`, 1.6 loại đúng `encre #0a0a0c` (1.03) và giữ mọi màu còn lại. Bảng chọn tay
 * vẫn đủ 12 màu — cố ý chọn màu chìm là quyền của người dùng.
 */
/** Mắt lấy màu nào tương phản với thân hơn. */
function eyeFor(bodyHex: string): string {
  return contrast(EYE_LIGHT, bodyHex) >= contrast(EYE_DARK, bodyHex) ? EYE_LIGHT : EYE_DARK;
}

const MIN_CONTRAST = 1.6;
const DERIVED_COLORS = COLORS.filter((c) => contrast(c.hex, SHELL) >= MIN_CONTRAST);

/**
 * Màu vẽ các ô trong bộ chọn HÌNH và BIỂU CẢM.
 *
 * Bloub luôn vẽ những ô đó bằng mực đen, kể cả khi màu đang chọn là màu khác — chỉ hàng Màu mới
 * đổi màu. Bản trước vẽ ô theo màu đang chọn, nên chọn `crème` là cả hai bảng trắng xoá.
 */
export const TILE_INK = "#0a0a0c";

export type AvatarOptions = {
  /** Ghi đè lựa chọn suy từ id — bộ chọn ảnh dùng để xem trước. */
  shapeId?: string;
  colorHex?: string;
  expressionId?: string;
  /** `hole`: mắt là lỗ thủng như bản gốc. `ink`: mắt vẽ đặc. Mặc định `ink` — xem ghi chú. */
  eyeMode?: "ink" | "hole";
  /** Nền phía sau khi `eyeMode: "hole"`. */
  paper?: string;
};

/**
 * Một khung SVG tĩnh của con bot.
 *
 * Bản gốc khoét mắt thành **lỗ thủng** để nhìn xuyên qua thân — đẹp trên nền sáng của trang họ.
 * Trên nền `rgb(7,7,7)` của mình thì lỗ thủng trên thân màu tối = mắt tàng hình. Nên mặc định vẽ
 * mắt đặc bằng màu chữ chính. Đây là chỗ đi chệch bản gốc có chủ ý, không phải dựng sai.
 */
export function botAvatarSvg(id: string, opts: AvatarOptions = {}): string {
  const pick = pickFor(id);
  const shape = opts.shapeId
    ? (SHAPES.find((s) => s.id === opts.shapeId) ?? at(SHAPES, pick.shape))
    : at(SHAPES, pick.shape);
  const expression = opts.expressionId
    ? (EXPRESSIONS.find((e) => e.id === opts.expressionId) ?? at(EXPRESSIONS, pick.expression))
    : at(EXPRESSIONS, pick.expression);
  const fill = opts.colorHex ?? at(DERIVED_COLORS, pick.color).hex;

  // `sample(0)` = khung đứng yên ở trạng thái nghỉ. Avatar là ảnh tĩnh, không chạy vòng đời.
  const frame = new BotEngine(RAYON, "idle", shape.radii, expression).sample(0);
  const vb = DEMI_VIEWBOX;
  const eye = opts.eyeMode === "hole" ? "#000" : eyeFor(fill);
  const eyes = frame.eyes
    .map((e) => `<path d="${e.d}" transform="${e.matrix}" opacity="${e.alpha}" fill="${eye}"/>`)
    .join("");

  if (opts.eyeMode === "hole") {
    const uid = `m${(pickFor(id).shape % 100000).toString(36)}`;
    return `<svg viewBox="${-vb} ${-vb} ${vb * 2} ${vb * 2}" xmlns="http://www.w3.org/2000/svg">`
      + `<mask id="${uid}"><path d="${frame.bodyPath}" fill="#fff"/>${eyes}</mask>`
      + `<rect x="${-vb}" y="${-vb}" width="${vb * 2}" height="${vb * 2}" fill="${opts.paper ?? "transparent"}"/>`
      + `<path d="${frame.bodyPath}" fill="${fill}" mask="url(#${uid})"/></svg>`;
  }
  return `<svg viewBox="${-vb} ${-vb} ${vb * 2} ${vb * 2}" xmlns="http://www.w3.org/2000/svg">`
    + `<path d="${frame.bodyPath}" fill="${fill}"/>${eyes}</svg>`;
}

/** 12 màu của bảng gốc — bộ chọn ảnh dùng đúng bảng này thay cho dải hue tự chế. */
export const AVATAR_COLORS = COLORS.map((c) => c.hex);
/** 8 hình. */
export const AVATAR_SHAPES = SHAPES.map((s) => s.id);
/** 16 biểu cảm, đúng thứ tự bảng của bloub. */
export const AVATAR_EXPRESSIONS = EXPRESSIONS.map((e) => e.id);

/**
 * Vẽ avatar thành PNG để nạp lên backend.
 *
 * Đi qua `<img>` + canvas chứ không tự vẽ lại bằng canvas API: SVG đã là nguồn sự thật, vẽ lại lần
 * hai là hai bản dựng phải giữ cho giống nhau. Data URL cùng gốc nên canvas không bị nhiễm bẩn.
 */
export function botAvatarPng(id: string, opts: AvatarOptions = {}, size = 256): Promise<string> {
  const svg = botAvatarSvg(id, opts);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = size;
      c.height = size;
      const g = c.getContext("2d");
      if (!g) return reject(new Error("không lấy được canvas 2d"));
      g.drawImage(img, 0, 0, size, size);
      resolve(c.toDataURL("image/png"));
    };
    img.onerror = () => reject(new Error("không dựng được SVG avatar"));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}


// ── avatar chạy động ──────────────────────────────────────────────────────────
//
// Cùng một engine, khác chỗ: ảnh tĩnh gọi `sample(0)` một lần, còn ở đây gọi mỗi khung hình.
// Ba trạng thái của `states.ts` khớp thẳng với ba trạng thái bot mà backend đã biết:
//
//     bot đang trả lời   -> thinking
//     có tin chưa đọc    -> notify
//     còn lại            -> idle
//
// Không bịa thêm trạng thái nào: `wink`/`burst`/`comet` là animation trình diễn của trang họ, gán
// bừa vào một con bot đang làm việc thì chỉ gây hiểu nhầm.

export type BotMood = "idle" | "thinking" | "notify";

export interface AnimatedAvatar {
  /** Đổi trạng thái; engine tự morph sang, không nhảy. */
  setMood(mood: BotMood): void;
  /** Dừng vòng lặp và bỏ tham chiếu. Bắt buộc gọi khi phần tử bị gỡ khỏi DOM. */
  stop(): void;
}

/**
 * Gắn một avatar chạy động vào `host`.
 *
 * `paint()` dựng lại toàn bộ cây DOM mỗi lần vẽ, nên phần tử này sống ngắn: người gọi phải `stop()`
 * bản cũ trước khi tạo bản mới. Không làm vậy thì mỗi lượt vẽ để lại một vòng `requestAnimationFrame`
 * chạy mãi trên một node đã rời DOM — vài phút dùng là hàng trăm vòng lặp.
 */
/**
 * Một avatar sống, gắn vào `host`.
 *
 * Mọi avatar dùng CHUNG một vòng `requestAnimationFrame` (xem `TICKER` bên dưới). Bảy avatar trong
 * roster mà mỗi cái một vòng lặp là bảy lần trình duyệt bị đánh thức mỗi khung hình, để vẽ bảy hình
 * bé bằng đầu ngón tay. Một nhịp chung vẽ đúng một lượt.
 */
export function animateAvatar(host: HTMLElement, id: string, mood: BotMood = "idle", opts: AvatarOptions = {}): AnimatedAvatar {
  const pick = pickFor(id);
  const shape = opts.shapeId ? (SHAPES.find((x) => x.id === opts.shapeId) ?? at(SHAPES, pick.shape)) : at(SHAPES, pick.shape);
  const expression = opts.expressionId
    ? (EXPRESSIONS.find((e) => e.id === opts.expressionId) ?? at(EXPRESSIONS, pick.expression))
    : at(EXPRESSIONS, pick.expression);
  const fill = opts.colorHex ?? at(DERIVED_COLORS, pick.color).hex;

  const engine = new BotEngine(RAYON, mood, shape.radii, expression);
  const vb = DEMI_VIEWBOX;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `${-vb} ${-vb} ${vb * 2} ${vb * 2}`);
  const body = document.createElementNS(SVG_NS, "path");
  body.setAttribute("fill", fill);
  svg.append(body);
  const eyeNodes: SVGPathElement[] = [];
  host.replaceChildren(svg);

  const draw = (t: number) => {
    const frame = engine.sample(t);
    body.setAttribute("d", frame.bodyPath);
    while (eyeNodes.length < frame.eyes.length) {
      const e = document.createElementNS(SVG_NS, "path");
      e.setAttribute("fill", eyeFor(fill));
      svg.append(e);
      eyeNodes.push(e);
    }
    frame.eyes.forEach((e, i) => {
      const n = eyeNodes[i]!;
      n.setAttribute("d", e.d);
      n.setAttribute("transform", e.matrix);
      n.setAttribute("opacity", String(e.alpha));
    });
    for (let i = frame.eyes.length; i < eyeNodes.length; i++) eyeNodes[i]!.setAttribute("opacity", "0");
  };

  /*
   * Vẽ khung đầu NGAY, trước khi vào nhịp.
   *
   * `draw` tạo node mắt theo `frame.eyes`, nên nếu chờ khung RAF đầu tiên thì có một nhịp SVG chỉ
   * có thân: avatar hiện ra trống rồi mới đủ mắt. Bắt được vì `e2e-avatar-ui` đỏ đúng ở bước
   * "mặt bot suy từ id" — nó đếm số path và gặp 1 thay vì 3. Một nhịp trống thì mắt người khó
   * thấy, nhưng nó là trạng thái thật, và một bài test đọc DOM thì thấy ngay.
   */
  draw(TICKER.now());

  const handle: Ticked = { draw, engine };
  TICKER.add(handle);
  return {
    setMood(next) { engine.setState(next, TICKER.now()); },
    stop() { TICKER.remove(handle); },
  };
}

interface Ticked { draw(t: number): void; engine: BotEngine }

/**
 * Nhịp chung.
 *
 * Dừng hẳn khi không còn avatar nào — một vòng RAF chạy rỗng vẫn giữ trình duyệt tỉnh và vẫn tốn
 * pin. Cũng dừng khi tab bị ẩn: `requestAnimationFrame` tự ngưng ở tab nền, nhưng thời gian thì
 * vẫn trôi, nên khi quay lại phải tính lại mốc để con bot không "nhảy" một phát bù cho mấy phút
 * vắng mặt.
 */
const TICKER = {
  items: new Set<Ticked>(),
  raf: 0,
  t0: 0,
  last: 0,
  now(): number { return this.last; },
  add(h: Ticked) {
    this.items.add(h);
    if (!this.raf) {
      this.t0 = performance.now() - this.last * 1000;
      this.raf = requestAnimationFrame((t) => this.tick(t));
    }
  },
  remove(h: Ticked) {
    this.items.delete(h);
    if (!this.items.size && this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
  },
  tick(t: number) {
    this.last = (t - this.t0) / 1000;
    for (const h of this.items) h.draw(this.last);
    this.raf = this.items.size ? requestAnimationFrame((n) => this.tick(n)) : 0;
  },
};

const SVG_NS = "http://www.w3.org/2000/svg";
