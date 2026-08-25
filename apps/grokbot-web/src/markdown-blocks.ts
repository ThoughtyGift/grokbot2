/**
 * Từng loại khối markdown, mỗi loại một hàm.
 *
 * Trước đây tất cả nằm trong một vòng `while` 53 dòng, và mọi khối dùng chung một biến đếm `i` —
 * nghĩa là thêm một loại khối mới là phải đọc lại cả vòng để chắc mình không nuốt mất dòng của
 * người khác. Ở đây mỗi hàm nhận vị trí đang đứng và **tự nói mình dừng ở đâu**, nên vòng lặp chỉ
 * còn việc thử lần lượt.
 *
 * Trả `null` = "khối này không phải của tôi", để vòng lặp thử loại kế tiếp.
 */
import { esc, inline, UL_RE, OL_RE, H_RE, QUOTE_RE } from "./markdown-inline.js";

export interface Taken { html: string; next: number }
export type Block = (lines: string[], i: number) => Taken | null;

/** ``` … ``` — khối không đóng vẫn render được, cố ý: chat hay bị cắt giữa chừng. */
const fence: Block = (lines, i) => {
  if (!/^```/.test(lines[i])) return null;
  const buf: string[] = [];
  let j = i + 1;
  while (j < lines.length && !/^```/.test(lines[j])) buf.push(lines[j++]);
  return { html: `<pre><code>${esc(buf.join("\n"))}</code></pre>`, next: j + 1 };
};

/** Danh sách — gạch đầu dòng và đánh số dùng chung một khuôn, chỉ khác thẻ bọc. */
const listWith = (re: RegExp, tag: "ul" | "ol"): Block => (lines, i) => {
  if (!re.test(lines[i])) return null;
  const items: string[] = [];
  let j = i;
  while (j < lines.length && re.test(lines[j])) items.push(inline(esc(lines[j++].match(re)![1])));
  return { html: `<${tag}>${items.map((t) => `<li>${t}</li>`).join("")}</${tag}>`, next: j };
};

/** Tiêu đề trong bubble chat không cần thang h1–h3 thật — một dòng đậm là đúng tỉ lệ. */
const heading: Block = (lines, i) => {
  const h = lines[i].match(H_RE);
  return h ? { html: `<p class="md-h">${inline(esc(h[2]))}</p>`, next: i + 1 } : null;
};

const quote: Block = (lines, i) => {
  if (!QUOTE_RE.test(lines[i])) return null;
  const buf: string[] = [];
  let j = i;
  while (j < lines.length && QUOTE_RE.test(lines[j])) buf.push(inline(esc(lines[j++].match(QUOTE_RE)![1])));
  return { html: `<blockquote>${buf.join("<br>")}</blockquote>`, next: j };
};

export const BLOCKS: Block[] = [fence, listWith(UL_RE, "ul"), listWith(OL_RE, "ol"), heading, quote];

/** Một dòng có mở đầu khối khác không — dùng để biết đoạn văn phải dừng ở đâu. */
const startsBlock = (line: string): boolean =>
  /^```/.test(line) || UL_RE.test(line) || OL_RE.test(line) || H_RE.test(line) || QUOTE_RE.test(line);

/** Đoạn văn: chạy tới dòng trống, hoặc tới khi một khối khác bắt đầu. */
export const paragraph: Block = (lines, i) => {
  const buf: string[] = [lines[i]];
  let j = i + 1;
  while (j < lines.length && lines[j].trim() && !startsBlock(lines[j])) buf.push(lines[j++]);
  return { html: `<p>${buf.map((l) => inline(esc(l))).join("<br>")}</p>`, next: j };
};
