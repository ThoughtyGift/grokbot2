/**
 * Patch: the composer thumbnail shows "Image unavailable" for every local attachment on Windows.
 *
 * Not our backend. `cOt` is the stock main-process path normaliser, and in the app's own engine
 * (Electron 42.1.0 / Node 24.15.0) `new URL("C:\\Users\\…")` yields protocol `c:`, not `file:` —
 * so the guard returns null and `resolveMedia` bails in ~0 ms, before any disk read and before the
 * box leg. POSIX paths (`/workspace/…`) make `new URL` THROW, land in `catch{return t}`, and work
 * fine — which is exactly why transcript images always rendered and only local attachments broke.
 *
 * The fix keeps the original's intent (hand non-file URLs back as-is, normalise real paths through
 * `swr`) and adds the one case its author did not have: a Windows drive letter is a path, not a URL.
 *
 * A/B measured in the live app 2026-08-18, same input, only `cOt` differing:
 *   stock   → `cOt -> null`, NULL
 *   patched → `kind:"image" 1920x1040`, dataUrl 89,814 chars, 26 ms local read, box leg untouched
 */
export default {
  id: "win-drive-path",
  summary: "chuẩn hoá đường dẫn: ổ đĩa Windows là ĐƯỜNG DẪN, không phải URL (ảnh thu nhỏ trong ô soạn)",

  /**
   * **0.43: hãng tự sửa đúng lỗi này.** `normalizeAttachmentSource` nay là
   *
   *     function yB(e){…if(yct.test(e))return e;try{return new URL(e).protocol!=="file:"?null:Od(e)}…}
   *     var yct=/^[a-zA-Z]:[\\/]/
   *
   * — kiểm ổ đĩa Windows TRƯỚC `new URL`, tức chính cái vế bản vá này thêm vào. Không có gì để vá,
   * nhưng cũng không dùng `obsoleteWhenMissing`: "không thấy neo" có thể chỉ là hàm đổi hình dạng
   * lần nữa mà lỗi vẫn còn. `obsoleteIf` đòi **bằng chứng dương** — thấy đúng câu sửa của hãng thì
   * mới được nói "đã thừa"; không thấy cả neo lẫn bằng chứng thì vẫn đỏ như cũ.
   */
  obsoleteIf: {
    file: "dist/electron-main/main-app.cjs",
    find: 'if(yct.test(e))return e;try{return new URL(e).protocol!=="file:"?null:Od(e)}catch{return e}}',
    expected: 1,
    why: "0.43 kiểm ổ đĩa Windows (yct) trước new URL — hãng tự sửa",
  },

  /**
   * Một bản vá, nhiều phiên bản client.
   *
   * Không dấu hiệu nào của 0.20 còn sống trong 0.29 — nhưng **lỗi thì còn**, chỉ là hàm đổi tên.
   * Bản 0.29 tự khai tên thật của nó, nên lần này không phải đoán:
   *
   *     function vht(n){…protocol!=="file:"?null:Pst(n)…}
   *     s(vht,"normalizeAttachmentSource")
   *
   * `expected: 1` vẫn là toàn bộ câu chuyện an toàn: bundle nào đổi hình dạng thì không biến thể
   * nào khớp, và `--apply` dừng đỏ kèm id thay vì vá bừa vào thứ trông na ná.
   */
  variants: [
    {
      version: "0.20.0",
      file: "dist/electron-main/main.cjs",
      find: 'function cOt(t){if(typeof t!="string"||t.length===0)return null;try{return new URL(t).protocol!=="file:"?null:swr(t)}catch{return t}}',
      expected: 1,
      replace: 'function cOt(t){if(typeof t!="string"||!t)return null;try{new URL(t)}catch{return t}return t[1]==":"?t:swr(t)}/*grokbot2:win-drive-path-fix*/',
      marker: "/*grokbot2:win-drive-path-fix*/",
    },
    {
      version: "0.29.0",
      file: "dist/electron-main/main.cjs",
      find: 'function vht(n){if(typeof n!="string"||n.length===0)return null;try{return new URL(n).protocol!=="file:"?null:Pst(n)}catch{return n}}',
      expected: 1,
      replace: 'function vht(n){if(typeof n!="string"||!n)return null;try{new URL(n)}catch{return n}return n[1]==":"?n:Pst(n)}/*grokbot2:win-drive-path-fix*/',
      marker: "/*grokbot2:win-drive-path-fix*/",
    },
  ],
};
