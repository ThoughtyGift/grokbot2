/**
 * Markdown tối thiểu cho bubble của bot — app gốc render markdown thật trong tin nhắn.
 *
 * Đo trên app đang chạy (CDP :9222, 2026-08-23): tin của bot chứa `<p>`, `<code>`, `<ul>`;
 * code chip nền `rgba(119,119,119,.173)` chữ `rgb(255,86,103)` bo 4px — tức họ parse markdown
 * chứ không in text trần. Bên mình trước đây `document.createTextNode(content)` nên mọi
 * `**đậm**`, `` `code` ``, `- bullet` hiện nguyên ký hiệu.
 *
 * An toàn theo CẤU TRÚC: escape toàn bộ đầu vào TRƯỚC, rồi mới thay ký hiệu markdown bằng thẻ.
 * Bất biến đó nằm trong `markdown-inline.ts`, và không nhánh nào đi vòng qua nó — nên không cần
 * sanitizer riêng. Link chỉ nhận http/https; `javascript:` không có đường vào.
 *
 * Phạm vi cố ý hẹp: đoạn văn, xuống dòng, đậm/nghiêng, code inline, code block, danh sách, link,
 * tiêu đề, trích dẫn. Bảng/nested list chưa cần — thêm khi thấy thật trong transcript, đừng thêm
 * trước.
 *
 * File này giờ chỉ còn **vòng lặp**; từng loại khối nằm ở `markdown-blocks.ts`.
 */
import { BLOCKS, paragraph, type Taken } from "./markdown-blocks.js";


export function mdToHtml(src: string): string {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].trim()) { i++; continue; }
    // Thử từng loại khối theo thứ tự; không loại nào nhận thì đó là đoạn văn.
    const taken: Taken = BLOCKS.reduce<Taken | null>((hit, block) => hit ?? block(lines, i), null)
      ?? paragraph(lines, i)!;
    out.push(taken.html);
    i = taken.next;
  }
  return out.join("");
}
