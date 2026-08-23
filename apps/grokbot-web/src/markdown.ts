/**
 * Markdown tối thiểu cho bubble của bot — app gốc render markdown thật trong tin nhắn.
 *
 * Đo trên app đang chạy (CDP :9222, 2026-08-23): tin của bot chứa `<p>`, `<code>`, `<ul>`;
 * code chip nền `rgba(119,119,119,.173)` chữ `rgb(255,86,103)` bo 4px — tức họ parse markdown
 * chứ không in text trần. Bên mình trước đây `document.createTextNode(content)` nên mọi
 * `**đậm**`, `` `code` ``, `- bullet` hiện nguyên ký hiệu.
 *
 * An toàn theo CẤU TRÚC: escape toàn bộ đầu vào TRƯỚC, rồi mới thay ký hiệu markdown bằng thẻ.
 * Không có nhánh nào đưa chuỗi chưa escape vào HTML, nên không cần sanitizer riêng.
 * Link chỉ nhận http/https — `javascript:` không có đường vào.
 *
 * Phạm vi cố ý hẹp: đoạn văn, xuống dòng, đậm/nghiêng, code inline, code block ```,
 * danh sách -/* và 1., link [t](url), tiêu đề #..###, trích dẫn >. Bảng/nested list chưa cần —
 * thêm khi thấy thật trong transcript, đừng thêm trước.
 */

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

/** Thay ký hiệu inline trên chuỗi ĐÃ escape. Code inline xử lý trước để nội dung nó không bị các luật sau chạm vào. */
function inline(escaped: string): string {
  return escaped
    .split(/(`[^`\n]+`)/)
    .map((seg) => {
      if (seg.length > 2 && seg.startsWith("`") && seg.endsWith("`")) {
        return `<code>${seg.slice(1, -1)}</code>`;
      }
      return seg
        .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
        .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<em>$2</em>")
        // đầu vào đã escape nên URL không thể chứa `"` sống — thuộc tính href an toàn
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, `<a href="$2" target="_blank" rel="noreferrer">$1</a>`);
    })
    .join("");
}

const UL_RE = /^\s*[-*+]\s+(.*)$/;
const OL_RE = /^\s*\d+[.)]\s+(.*)$/;
const H_RE = /^(#{1,3})\s+(.*)$/;
const QUOTE_RE = /^\s*>\s?(.*)$/;

export function mdToHtml(src: string): string {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++; // bỏ dòng ``` đóng (hoặc trôi qua cuối nếu block không đóng — vẫn render được)
      out.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`);
      continue;
    }
    if (UL_RE.test(line)) {
      const items: string[] = [];
      while (i < lines.length && UL_RE.test(lines[i])) items.push(inline(esc(lines[i++].match(UL_RE)![1])));
      out.push(`<ul>${items.map((t) => `<li>${t}</li>`).join("")}</ul>`);
      continue;
    }
    if (OL_RE.test(line)) {
      const items: string[] = [];
      while (i < lines.length && OL_RE.test(lines[i])) items.push(inline(esc(lines[i++].match(OL_RE)![1])));
      out.push(`<ol>${items.map((t) => `<li>${t}</li>`).join("")}</ol>`);
      continue;
    }
    const h = line.match(H_RE);
    if (h) {
      // Tiêu đề trong bubble chat không cần thang h1–h3 thật — một dòng đậm là đúng tỉ lệ.
      out.push(`<p class="md-h">${inline(esc(h[2]))}</p>`);
      i++;
      continue;
    }
    if (QUOTE_RE.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && QUOTE_RE.test(lines[i])) buf.push(inline(esc(lines[i++].match(QUOTE_RE)![1])));
      out.push(`<blockquote>${buf.join("<br>")}</blockquote>`);
      continue;
    }
    if (!line.trim()) { i++; continue; }

    const buf: string[] = [line];
    i++;
    while (
      i < lines.length && lines[i].trim() &&
      !/^```/.test(lines[i]) && !UL_RE.test(lines[i]) && !OL_RE.test(lines[i]) &&
      !H_RE.test(lines[i]) && !QUOTE_RE.test(lines[i])
    ) buf.push(lines[i++]);
    out.push(`<p>${buf.map((l) => inline(esc(l))).join("<br>")}</p>`);
  }
  return out.join("");
}
