/**
 * Icon trong nút — hộp CỐ ĐỊNH, không phải glyph chữ.
 *
 * Vì sao module này tồn tại: FE trước đây dùng ký tự Unicode (`+`, `⋯`, `↩`, `⌕`) làm icon. Một
 * glyph mang theo line-height và baseline của font, nên nó KHÔNG căn giữa được trong nút — đo qua
 * CDP (2026-08-23) thì nút hover-action 24×24 có glyph lệch **9px xuống dưới**, và kích thước glyph
 * (11×17, 12×19, 13×18…) trôi theo font chứ không phải theo thiết kế.
 *
 * App gốc dùng `i.ui-icon` — một hộp vuông có width/height cố định, padding nút bằng 0, và tâm icon
 * trùng tâm nút (dx=dy=0 ở MỌI nút đo được). Số đo lấy từ chính app:
 *
 *   nút New 24×24 → icon 18×18   ·   Search 375×32 → 14×14 (lề trái 8)
 *   Plugins 375×40 → 14×14       ·   computer 34×28 → 18×18
 *   attach 28×28 → 16×16         ·   hover actions 24×24 → 14×14
 *
 * Nét vẽ là của mình (không chép asset của hãng — luật §5 của roadmap); chỉ HỘP là theo số đo.
 */

const SVG = (size: number, body: string, extra = ""): string =>
  `<svg class="ui-icon" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${body}</svg>`;

export type IconName =
  | "plus" | "search" | "plugins" | "monitor" | "paperclip" | "mic" | "send" | "stop"
  | "smile" | "reply" | "dots" | "close" | "chevron-left" | "chevron-right" | "download" | "trash";

const PATHS: Record<IconName, string> = {
  plus: `<path d="M8 3.5v9M3.5 8h9"/>`,
  search: `<circle cx="7" cy="7" r="4"/><path d="M10.2 10.2 13.5 13.5"/>`,
  plugins: `<rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="1"/><rect x="9" y="9" width="4.5" height="4.5" rx="1"/>`,
  monitor: `<rect x="1.5" y="2.5" width="13" height="9" rx="1.5"/><path d="M5.5 14h5M8 11.5V14"/>`,
  paperclip: `<path d="M9.5 4 5 8.5a2.1 2.1 0 0 0 3 3l4.5-4.5a3.5 3.5 0 0 0-5-5L3 6.5a4.9 4.9 0 0 0 7 7L13 10.5"/>`,
  mic: `<rect x="6" y="2" width="4" height="7" rx="2"/><path d="M4 8a4 4 0 0 0 8 0M8 12v2"/>`,
  send: `<path d="M8 13V3M4 6.5 8 2.5l4 4"/>`,
  stop: `<rect x="4.5" y="4.5" width="7" height="7" rx="1.5" fill="currentColor" stroke="none"/>`,
  smile: `<circle cx="8" cy="8" r="5.5"/><path d="M6 6.5h.01M10 6.5h.01M5.8 9.8a2.8 2.8 0 0 0 4.4 0"/>`,
  reply: `<path d="M6 4 2.5 7.5 6 11"/><path d="M2.5 7.5H9a4 4 0 0 1 4 4V13"/>`,
  dots: `<circle cx="3.5" cy="8" r="1.15" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1.15" fill="currentColor" stroke="none"/><circle cx="12.5" cy="8" r="1.15" fill="currentColor" stroke="none"/>`,
  close: `<path d="M4 4l8 8M12 4l-8 8"/>`,
  "chevron-left": `<path d="M10 3.5 5.5 8l4.5 4.5"/>`,
  "chevron-right": `<path d="M6 3.5 10.5 8 6 12.5"/>`,
  download: `<path d="M8 2.5v8M5 7.5 8 10.5l3-3M3 13h10"/>`,
  trash: `<path d="M3 5h10M6.5 5V3.5h3V5M4.5 5l.5 8h6l.5-8"/>`,
};

/** `size` là bề rộng/cao hộp icon — luôn truyền số ĐO ĐƯỢC của nút tương ứng, đừng chọn cho vừa mắt. */
export const icon = (name: IconName, size: number): string => SVG(size, PATHS[name]);
