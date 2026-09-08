/**
 * Gom các khúc của `uploadAttachmentChunk` lại thành một tệp.
 *
 * ── Vì sao cần ──────────────────────────────────────────────────────────────────────────────────
 *
 * Client 0.43 **luôn thử đường CHIA KHÚC trước**, và chỉ rơi về `uploadAttachment` (một phát) khi
 * gateway báo *không biết lệnh*. Đọc `main-app.cjs` 0.43:
 *
 *   async function uploadStaged(F,N){ try{ return await uploadStagedInChunks(F,N) }
 *                                     catch(G){ if(!isUnknownGatewayMethodError(G)) throw G;
 *                                               return await uploadStagedWhole(F,N) } }
 *   // trong uploadStagedInChunks: let {committedPath} = await uploadAttachmentChunk({…});
 *   //   if (committedPath != null) return committedPath;
 *   //   hết khúc mà không có committedPath ⇒ throw SandStagedUploadIncompleteError
 *
 * Cửa `/gw/api` của ta trả `200 {}` cho lệnh không có handler — tức nó nói "xong rồi", KHÔNG nói
 * "không biết lệnh". Nên client gửi hết khúc, không thấy `committedPath`, rồi ném; và vì lỗi ấy
 * không phải `isUnknownGatewayMethodError` nên đường một-phát **không bao giờ được chạm tới**.
 * Đo 08/09/2026 trên máy người dùng: ảnh 552.191 byte, `unmapped: ["uploadAttachmentChunk"]`,
 * khung soạn hiện *"Couldn't send your message. Check your connection and try again."*
 *
 * Chú thích của `uploadAttachment` ngay trong `commands.ts` ghi rằng sửa tên trường ở đó là
 * *"the whole 'Couldn't send your message' report"* — đúng cho cánh cửa nó sửa, nhưng 0.43 mở cửa
 * khác TRƯỚC, nên cùng một triệu chứng quay lại qua đường khác.
 *
 * ── Vì sao là module riêng, thuần ───────────────────────────────────────────────────────────────
 *
 * `commands.ts` kéo cả `@grokbot2/proto` nên bài đo không nạp được nó; phép gom khúc là chỗ dễ sai
 * nhất (thứ tự, trần, tệp treo) nên nó phải đo được TRƯỚC khi nối dây.
 */

/**
 * Trần byte — đọc từ `attachmentByteLimitForName` của hãng (`main-app.cjs` 0.43), không tự đặt:
 *
 *   var SJe = 25*1024*1024, EJe = 200*1024*1024;
 *   function attachmentByteLimitForName(e){ return nameLooksLikeVideo(e) ? EJe : SJe }
 *   function refuseAttachmentSize(e){ return e.size===0 ? {reason:"empty"}
 *                                          : e.size>e.limitBytes ? {reason:"too-large"} : null }
 *
 * Client đã chặn trước khi gửi, nên đây là tầng thứ hai — nó tồn tại để một người gọi KHÁC client
 * không làm tiến trình ăn hết RAM.
 */
export const TRAN_VIDEO = 200 * 1024 * 1024;
export const TRAN_THUONG = 25 * 1024 * 1024;

/** Bảng đuôi video của hãng (`pp` trong `main-app.cjs`) — quyết định trần nào áp. */
const DUOI_VIDEO = new Set([".m4v", ".mov", ".mp4", ".ogv", ".webm"]);

/**
 * Mime suy từ ĐUÔI TÊN. `stageImage` bỏ qua mime khai báo và tự đo bytes, nên bảng này chỉ có hệ
 * quả thật ở `stageFile` (tệp không phải ảnh) — và ở đó nó là thứ duy nhất biết PDF là PDF.
 * Đường một-phát dập cứng `image/png` cho mọi thứ; đừng chép lại chỗ đó.
 */
const MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".bmp": "image/bmp", ".avif": "image/avif", ".heic": "image/heic",
  ".m4v": "video/mp4", ".mov": "video/quicktime", ".mp4": "video/mp4", ".ogv": "video/ogg",
  ".webm": "video/webm", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4",
  ".flac": "audio/flac", ".ogg": "audio/ogg", ".opus": "audio/ogg", ".aac": "audio/aac",
  ".pdf": "application/pdf", ".txt": "text/plain", ".md": "text/markdown", ".csv": "text/csv",
  ".json": "application/json", ".xml": "application/xml", ".html": "text/html",
  ".zip": "application/zip",
};

const duoi = (ten: string): string => {
  const i = ten.lastIndexOf(".");
  return i <= 0 ? "" : ten.slice(i).toLowerCase();
};

export const tranTheoTen = (ten: string): number => (DUOI_VIDEO.has(duoi(ten)) ? TRAN_VIDEO : TRAN_THUONG);
export const mimeTheoTen = (ten: string): string => MIME[duoi(ten)] ?? "application/octet-stream";

/**
 * `isSafeFilename` của hãng, nguyên vế:
 *   !(typeof e!="string" || e.length===0 || e.length>255 || e.includes("/") || e.includes("\\") || e.includes("\0"))
 */
export const tenAnToan = (ten: unknown): ten is string =>
  typeof ten === "string" && ten.length > 0 && ten.length <= 255
  && !ten.includes("/") && !ten.includes("\\") && !ten.includes("\0");

export type KetQuaGom =
  /** Còn thiếu byte — người gọi phải trả reply KHÔNG có `committedPath`. */
  | { xong: false }
  /** Đủ rồi — người gọi đem `dataUrl` đi stage rồi trả `committedPath`. */
  | { xong: true; dataUrl: string; ten: string; mime: string }
  /** Đầu vào vô lý; câu này đi vào `reason` của reply. */
  | { loi: string };

export type KhoGomKhuc = {
  nhan(a: unknown): KetQuaGom;
  /** Số lần tải đang dở — cho bài đo và cho `/gw/__coverage` nếu sau này muốn phơi ra. */
  dangCho(): number;
};

const soNguyenKhongAm = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;

/**
 * @param gio đồng hồ tiêm được — bài đo không chờ thật.
 * @param hanSongMs tệp dở quá hạn thì bỏ; client không bao giờ quay lại một `uploadId` cũ.
 * @param toiDaCho số lần tải dở cùng lúc; quá thì bỏ cái cũ nhất (giữ RAM có trần).
 */
export function taoKhoGomKhuc(opts: {
  gio?: () => number;
  hanSongMs?: number;
  toiDaCho?: number;
} = {}): KhoGomKhuc {
  const gio = opts.gio ?? (() => Date.now());
  const hanSongMs = opts.hanSongMs ?? 10 * 60_000;
  const toiDaCho = opts.toiDaCho ?? 8;

  type Dang = { ten: string; tong: number; phan: Buffer[]; daNhan: number; chamNhat: number };
  const dang = new Map<string, Dang>();

  const donHetHan = (): void => {
    const now = gio();
    for (const [id, d] of dang) if (now - d.chamNhat > hanSongMs) dang.delete(id);
  };

  return {
    dangCho: () => dang.size,

    nhan(a: unknown): KetQuaGom {
      const o = (a ?? {}) as Record<string, unknown>;
      const uploadId = typeof o.uploadId === "string" && o.uploadId.length > 0 ? o.uploadId : null;
      if (uploadId == null) return { loi: "uploadAttachmentChunk cần uploadId" };
      if (!tenAnToan(o.filename)) return { loi: "uploadAttachmentChunk cần filename hợp lệ" };
      const ten = o.filename;

      const offset = soNguyenKhongAm(o.offset);
      const tong = soNguyenKhongAm(o.totalSize);
      if (offset == null) return { loi: "offset phải là số nguyên không âm" };
      if (tong == null) return { loi: "totalSize phải là số nguyên không âm" };
      // `refuseAttachmentSize` của hãng gọi 0 byte là "empty" — cùng câu, cùng chỗ từ chối.
      if (tong === 0) return { loi: "empty" };
      const tran = tranTheoTen(ten);
      if (tong > tran) return { loi: `too-large: ${tong} byte, trần ${tran}` };
      if (typeof o.bytesBase64 !== "string") return { loi: "bytesBase64 phải là chuỗi base64" };

      donHetHan();

      let d = dang.get(uploadId);
      if (d === undefined) {
        // Khúc đầu PHẢI ở offset 0: nhận một khúc giữa cho một id chưa biết là dựng một tệp có lỗ.
        if (offset !== 0) return { loi: `uploadId lạ mà offset ${offset} — khúc đầu phải ở offset 0` };
        while (dang.size >= toiDaCho) {
          const cuNhat = dang.keys().next().value;
          if (cuNhat === undefined) break;
          dang.delete(cuNhat);
        }
        d = { ten, tong, phan: [], daNhan: 0, chamNhat: gio() };
        dang.set(uploadId, d);
      }

      // Client chỉ tăng offset SAU khi nhận reply, nên chuỗi phải khít. Lệch một khúc là im lặng
      // ghép sai byte — thà từ chối có chữ.
      if (offset !== d.daNhan) return { loi: `offset ${offset} không khít, đang chờ ${d.daNhan}` };
      if (tong !== d.tong) return { loi: `totalSize đổi giữa lần tải (${d.tong} → ${tong})` };

      const bytes = Buffer.from(o.bytesBase64, "base64");
      if (bytes.length === 0) return { loi: "khúc rỗng" };
      if (d.daNhan + bytes.length > d.tong) {
        dang.delete(uploadId);
        return { loi: `khúc vượt totalSize (${d.daNhan} + ${bytes.length} > ${d.tong})` };
      }

      d.phan.push(bytes);
      d.daNhan += bytes.length;
      d.chamNhat = gio();
      if (d.daNhan < d.tong) return { xong: false };

      dang.delete(uploadId);
      const all = Buffer.concat(d.phan);
      const mime = mimeTheoTen(ten);
      return { xong: true, ten, mime, dataUrl: `data:${mime};base64,${all.toString("base64")}` };
    },
  };
}
