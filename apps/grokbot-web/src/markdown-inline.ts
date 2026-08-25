/**
 * Escape + thay ký hiệu inline + các mẫu nhận dạng khối.
 *
 * Tách ra để `markdown.ts` (vòng lặp) và `markdown-blocks.ts` (từng khối) cùng dùng mà không ai
 * import ngược ai. **Bất biến an toàn nằm ở đây**: escape toàn bộ đầu vào TRƯỚC, rồi mới thay ký
 * hiệu bằng thẻ — nên không nhánh nào đưa chuỗi chưa escape vào HTML.
 */
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

/** Thay ký hiệu inline trên chuỗi ĐÃ escape. Code inline xử lý trước để nội dung nó không bị các luật sau chạm vào. */
export function inline(escaped: string): string {
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

export const UL_RE = /^\s*[-*+]\s+(.*)$/;
export const OL_RE = /^\s*\d+[.)]\s+(.*)$/;
export const H_RE = /^(#{1,3})\s+(.*)$/;
export const QUOTE_RE = /^\s*>\s?(.*)$/;

