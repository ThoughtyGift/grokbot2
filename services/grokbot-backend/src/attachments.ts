/**
 * Attachments the agent produces (screenshots, mostly).
 *
 * Getting a picture into the transcript is a three-gate problem, and every gate was found the
 * hard way — see docs/parity.md:
 *
 *  1. **The media gate is the URL string's file extension.** The renderer only routes an
 *     attachment to the image component when `AZ(url)` finds a known extension: it splits on
 *     `/` and `\`, takes the last segment, and reads the text after the last `.`. A base64
 *     `data:` URL has no dot, so it renders as a file chip no matter what `file_name` says.
 *  2. **The desktop rejects Windows drive paths.** `normalizeAttachmentSource` runs
 *     `new URL(source)`; `C:\…` parses with protocol `c:` and is dropped. A `file://` URL is
 *     worse — it throws inside the message renderer and takes the section down.
 *  3. **A path that is not a URL is passed through**, tried against the desktop's own
 *     filesystem first, and then handed to the box gateway as
 *     `readAttachmentImage({path}) → {dataUrl, width, height}`.
 *
 * So: hand out POSIX-looking virtual paths under /workspace ending in a real extension, and
 * serve the bytes from gate 3. Nothing touches the user's disk.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { bindAttachmentCatalog, dataDir } from "./store.js";

/** The virtual directory the transcript refers to. Nothing is written here; see DISK. */
const DIR = "/workspace/attachments";
/** Where the bytes actually live, beside the rest of the backend's state. */
/** Theo thư mục dữ liệu đang dùng, không phải `../.data` ghim cứng — xem dataDir() trong store.ts. */
const DISK = (): string => join(dataDir(), "attachments");
/** Bounded so a long browsing session cannot grow without limit. */
const MAX_ENTRIES = 64;

interface Stored { bytes: Buffer; mime: string; width: number; height: number }

const store = new Map<string, Stored>();
let seq = 1;

/**
 * Screenshots must survive a backend restart. Held only in memory they came back as
 * "Image unavailable" the moment tsx reloaded, which looks exactly like a broken contract.
 */
function diskPath(virtual: string): string {
  return join(DISK(), basename(virtual));
}

{
  try {
    mkdirSync(DISK(), { recursive: true });
    for (const name of readdirSync(DISK())) {
      const virtual = `${DIR}/${name}`;
      try {
        const bytes = readFileSync(join(DISK(), name));
        // Mime comes from the bytes, not from a constant: staging now accepts JPEG/GIF/WebP, and
        // restoring them all as image/png would hand the renderer a data URL it cannot decode.
        // Non-image files (X8) restore too — skipping them meant a restart between staging and
        // sending silently lost the attachment while its bytes still sat on disk.
        const size = imageSize(bytes);
        store.set(virtual, size ? { bytes, ...size } : { bytes, mime: "application/octet-stream", width: 0, height: 0 });
        const n = Number(/^(\d+)-/.exec(name)?.[1] ?? 0);
        if (n >= seq) seq = n + 1;
      } catch { /* skip unreadable */ }
    }
    if (store.size) console.log(`[grokbot2] restored ${store.size} attachment(s)`);
  } catch { /* no state dir yet */ }
}

interface Measured { width: number; height: number; mime: string }

/** PNG carries its size in the IHDR chunk: 8-byte signature, 4 length, 4 "IHDR", w, h. */
function pngSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 24 || bytes.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/**
 * JPEG states its size in a start-of-frame segment, which has to be walked to.
 *
 * There is no fixed offset: the file is a chain of `FF <marker> <2-byte length>` segments, and
 * a photo from a page carries EXIF, ICC and thumbnails ahead of the frame — so the marker can
 * be tens of kilobytes in. Only the SOF markers hold the dimensions, and SOF4/SOF8/SOF12 are
 * NOT among them (they are DHT/JPG/DAC, which is why the ranges below have holes). Segments
 * without a length (standalone markers, and the padding FFs allowed between segments) must be
 * stepped over one byte at a time or the walk desynchronises and reads garbage as a size.
 */
function jpegSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xff) { i += 1; continue; }        // resync past padding
    const marker = bytes[i + 1];
    if (marker === 0xff) { i += 1; continue; }           // fill byte
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    if (marker === 0xda || marker === 0xd9) return null; // scan data begins; no frame header found
    const len = bytes.readUInt16BE(i + 2);
    const isSof = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7)
      || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
    if (isSof) {
      if (i + 9 > bytes.length) return null;
      return { height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7) };
    }
    if (len < 2) return null;                            // malformed; refuse rather than loop
    i += 2 + len;
  }
  return null;
}

/** GIF: "GIF87a"/"GIF89a", then the logical screen width and height, little-endian. */
function gifSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 10 || bytes.toString("ascii", 0, 3) !== "GIF") return null;
  return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
}

/**
 * WebP, whose three variants store the size three different ways.
 *
 * Worth handling rather than skipping: it is what most image CDNs now serve to a modern
 * browser, so a WebP-only reader is the common case, not the exotic one.
 */
function webpSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 30 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP") return null;
  const chunk = bytes.toString("ascii", 12, 16);
  if (chunk === "VP8X") return { width: (bytes.readUIntLE(24, 3) & 0xffffff) + 1, height: (bytes.readUIntLE(27, 3) & 0xffffff) + 1 };
  // Lossy: the 14-bit dimensions sit after the 3-byte frame tag and the "*" sync code.
  if (chunk === "VP8 ") return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  // Lossless: 14 bits each, packed across four bytes after the 0x2f signature.
  if (chunk === "VP8L" && bytes[20] === 0x2f) {
    const b = bytes.readUInt32LE(21);
    return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
  }
  return null;
}

/**
 * Measure any image the renderer can draw, and report its real mime alongside.
 *
 * The format is read from the bytes, never from the URL or the file name: a CDN serving
 * `photo.jpg` as WebP is ordinary, and a wrong mime here reaches the renderer as a broken
 * picture rather than as an error anyone could trace.
 */
export function imageSize(bytes: Buffer): Measured | null {
  const png = pngSize(bytes);
  if (png) return { ...png, mime: "image/png" };
  const jpeg = jpegSize(bytes);
  if (jpeg) return { ...jpeg, mime: "image/jpeg" };
  const gif = gifSize(bytes);
  if (gif) return { ...gif, mime: "image/gif" };
  const webp = webpSize(bytes);
  if (webp) return { ...webp, mime: "image/webp" };
  return null;
}

/**
 * Keep an image and return the virtual path to put in `message.url`.
 * Returns null when the bytes are not an image we can measure — the renderer needs real
 * width/height, and guessing them produces a blank frame.
 */
export function stageImage(dataUrl: string, fileName: string): string | null {
  const comma = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || comma < 0) return null;
  const bytes = Buffer.from(dataUrl.slice(comma + 1), "base64");
  // The declared mime in the data URL is ignored in favour of the measured one. Callers build
  // that prefix from a URL or a guess (the gateway hardcodes image/png), so it is the least
  // reliable thing available, and the renderer decodes by mime.
  const size = imageSize(bytes);
  if (size == null) return null;

  // The extension is the renderer's only routing signal (gate 1 above), so it has to match the
  // real format: a WebP saved as `.png` reaches the image component and fails to decode there.
  const ext = size.mime.slice(6);
  const base = fileName.replace(/[^A-Za-z0-9._-]/g, "_") || `image.${ext}`;
  const safe = new RegExp(`\\.${ext}$`, "i").test(base) ? base : `${base.replace(/\.[A-Za-z0-9]+$/, "")}.${ext}`;
  const path = `${DIR}/${seq++}-${safe}`;
  store.set(path, { bytes, ...size });
  try {
    mkdirSync(DISK(), { recursive: true });
    writeFileSync(diskPath(path), bytes);
  } catch { /* memory-only for this run */ }

  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
    try { unlinkSync(diskPath(oldest)); } catch { /* already gone */ }
  }
  return path;
}

/**
 * Gateway `readAttachmentImage({path})`. The desktop calls this after its own filesystem
 * lookup misses, and feeds the result straight into the image component, which needs
 * `width`/`height` present or it renders "Image unavailable".
 */
/**
 * Stage a NON-image file — what "Attach files" needs beyond pictures.
 *
 * stageImage measures the bytes and refuses anything that is not a decodable image, which is right for
 * the image component but rejects a PDF, a .txt, a .docx — every ordinary attachment. This keeps any
 * bytes, records the mime the client declared (there is nothing to measure), and writes it to the same
 * store so readAttachmentText/readAttachmentChunk can read it back. width/height are 0: not an image,
 * and non-image attachments route by extension, not dimensions.
 */
export function stageFile(dataUrl: string, fileName: string, mimeType?: string): string | null {
  const comma = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || comma < 0) return null;
  const bytes = Buffer.from(dataUrl.slice(comma + 1), "base64");
  if (bytes.length === 0) return null;
  const declared = mimeType || dataUrl.slice(5, comma).split(";")[0] || "application/octet-stream";
  const base = (fileName || "file").replace(/[^A-Za-z0-9._-]/g, "_");
  const path = `${DIR}/${seq++}-${base}`;
  store.set(path, { bytes, mime: declared, width: 0, height: 0 });
  try {
    mkdirSync(DISK(), { recursive: true });
    writeFileSync(diskPath(path), bytes);
  } catch { /* memory-only for this run */ }
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
    try { unlinkSync(diskPath(oldest)); } catch { /* already gone */ }
  }
  return path;
}

/**
 * Nội dung TEXT của một tệp đã stage — để lượt hiện tại đưa vào history của model.
 *
 * Sync có chủ ý: `sendPrompt` dựng history đồng bộ, và tệp của LƯỢT NÀY vừa được stage qua
 * `/v1/attachments` nên bytes chắc chắn còn trong store; đường box (async) là của tệp bot tự
 * viết, không phải của tệp người dùng vừa gửi. Trần 32KB: đủ cho tài liệu thường, và một tệp
 * lớn hơn thì phần đầu + ghi chú bị cắt vẫn hơn là chỉ mỗi cái tên.
 */
export function stagedTextPreview(path: string, cap = 32 * 1024): { text: string; truncated: boolean } | null {
  const hit = store.get(path);
  if (hit == null) return null;
  if (!TEXT_EXTENSIONS.has(extensionOf(path)) || looksBinary(hit.bytes.subarray(0, 4096))) return null;
  return { text: hit.bytes.subarray(0, cap).toString("utf8"), truncated: hit.bytes.length > cap };
}

export function readAttachmentImage(args: { path?: unknown }): { dataUrl: string; width: number; height: number } | null {
  const path = typeof args?.path === "string" ? args.path : "";
  const hit = store.get(path);
  if (hit == null) return null;
  return {
    dataUrl: `data:${hit.mime};base64,${hit.bytes.toString("base64")}`,
    width: hit.width,
    height: hit.height,
  };
}

/**
 * Kích thước và cỡ tệp của một attachment đã staged. `null` nếu không biết nó.
 *
 * Dùng cho entry `user-attachment`: app gốc gửi kèm `width`/`height`/`byteSize`, và renderer đọc
 * chúng khi dựng thư viện ảnh (`i.addImage(file_path, a.width ?? null, a.height ?? null, …)`).
 */
export function attachmentInfo(path: string): { width: number; height: number; byteSize: number } | null {
  const hit = store.get(path);
  if (hit == null) return null;
  return { width: hit.width, height: hit.height, byteSize: hit.bytes.length };
}

/** For logging: how many images are held. */
export const stagedCount = (): number => store.size;

/** Catalog for `attachments_meta` — bytes stay on disk; sqlite only indexes them. */
export function attachmentCatalog(): { path: string; mime: string; width: number; height: number; bytes: number; fileName: string }[] {
  return [...store.entries()].map(([path, s]) => ({
    path, mime: s.mime, width: s.width, height: s.height, bytes: s.bytes.length, fileName: basename(path),
  }));
}

/* ────────────────────────────────────────────────────────────────────────────
 * Files that are not images.
 *
 * The renderer routes a `type:"attachment"` message by extension (`qvn` in the client):
 * an http(s) url with no file_name is a link, a known image extension is an image, and
 * everything else — `.md` included — is a **file chip**. The chip opens a preview, and the
 * preview is what asks for content, through two gateway methods the desktop calls straight
 * through (they are NOT desktop-local, main.cjs forwards both to the box):
 *
 *   readAttachmentText({path})                    → null
 *                                                 | {kind:"binary", bytes}
 *                                                 | {kind:"text", text, truncated, bytes}
 *   readAttachmentChunk({path, offset, length})   → {totalSize, bytesBase64}
 *
 * `bytes` is the file SIZE, not its content — that is where the chip's "6.9 KB" comes from
 * (client `Eft`: <1 KB shows B, under 10 KB one decimal). Returning the text there instead
 * would render a nonsense size and no error, so it is worth stating.
 *
 * A probe call arrives as `length: 0`, asking only for `totalSize`.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Matches the client's own text-preview extension list closely enough to agree with it. */
const TEXT_EXTENSIONS = new Set([
  "txt", "text", "log", "md", "markdown", "mdx", "rst", "adoc", "tex", "json", "jsonc",
  "json5", "ndjson", "csv", "tsv", "xml", "yaml", "yml", "toml", "ini", "cfg", "conf",
  "env", "properties", "sh", "bash", "zsh", "py", "js", "mjs", "cjs", "ts", "tsx", "jsx",
  "css", "html", "sql", "go", "rs", "rb", "java", "c", "h", "cpp", "hpp",
]);

/** The head the original previews before declaring the rest truncated. */
const TEXT_PREVIEW_CAP = 128 * 1024;

/**
 * Trần một khối media, khớp với client: `sand-media` cắt mọi yêu cầu ở 4 MB (`Zri` trong
 * `electron-main` 0.30). Đặt cùng số ở đây để một khối không bao giờ lớn hơn thứ nó chịu nhận.
 *
 * KHÔNG dùng `TEXT_PREVIEW_CAP` cho media. Đó là trần của bản xem trước VĂN BẢN, và dùng nhầm nó là
 * một trong hai lỗi làm "Couldn't load media": video 129 KB vượt trần 128 KB nên bị cắt, và
 * `totalSize` báo về 131.072 thay vì kích thước thật.
 */
const MEDIA_CHUNK_CAP = 4 * 1024 * 1024;

/**
 * Mime theo phần mở rộng — cho tệp nằm trên box, nơi không có bản ghi mime nào.
 *
 * Vì sao phải có: client kiểm `a.mime == null` TRƯỚC khi phát, nên thiếu mime là hỏng ngay ở lượt
 * hỏi metadata, chưa kịp tải một byte nào. `application/octet-stream` là đáy có chủ ý — một mime sai
 * còn cho client thử, còn `null` thì nó dừng hẳn.
 */
const MEDIA_MIME: Record<string, string> = {
  mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm",
  mkv: "video/x-matroska", avi: "video/x-msvideo",
  mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg", flac: "audio/flac",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml", pdf: "application/pdf",
};

const extensionOf = (path: string): string => {
  const last = path.split(/[/\\]/).pop() ?? "";
  const dot = last.lastIndexOf(".");
  return dot <= 0 ? "" : last.slice(dot + 1).toLowerCase();
};

/**
 * Where a non-image attachment's bytes come from.
 *
 * Staged bytes first (anything this backend produced itself), then the box, because the
 * interesting case is a file the agent WROTE — `edit_file_v2("plan.md", …)` then attaching
 * it. Those bytes only exist in the box, and reading them from disk here would find
 * nothing.
 */
async function loadBytes(path: string): Promise<Buffer | null> {
  const staged = store.get(path);
  if (staged != null) return staged.bytes;
  try {
    const { boxCall, boxConfigured } = await import("./box-exec.js");
    if (!boxConfigured()) return null;
    const r = await boxCall<{ totalSize: number; bytesBase64: string }>("readBytes", {
      target_file: path, offset: 0, length: TEXT_PREVIEW_CAP,
    });
    return Buffer.from(r.bytesBase64 ?? "", "base64");
  } catch { return null; }
}

/** Bytes that are almost certainly not text: a NUL in the head is the usual give-away. */
const looksBinary = (head: Buffer): boolean => head.includes(0);

/** Gateway `readAttachmentText({path})`. */
export async function readAttachmentText(args: { path?: unknown }): Promise<
  { kind: "binary"; bytes: number } | { kind: "text"; text: string; truncated: boolean; bytes: number } | null
> {
  const path = typeof args?.path === "string" ? args.path : "";
  if (!path) return null;
  const buf = await loadBytes(path);
  if (buf == null) return null;
  const bytes = buf.length;
  if (!TEXT_EXTENSIONS.has(extensionOf(path)) || looksBinary(buf.subarray(0, 4096))) return { kind: "binary", bytes };
  const head = buf.subarray(0, TEXT_PREVIEW_CAP);
  return { kind: "text", text: head.toString("utf8"), truncated: bytes > TEXT_PREVIEW_CAP, bytes };
}

/**
 * Gateway `readAttachmentChunk({path, offset, length})` — và đây là đường client nạp VIDEO.
 *
 * Trích 01/09 từ `electron-main` 0.30 (`gatewayMediaRemoteReader`): scheme `sand-media://` không đọc
 * file, nó gọi thẳng lệnh này rồi tự dựng một `Response` có `content-range`. Trước khi phát, nó hỏi
 * metadata bằng `offset:0, length:0` và bỏ đi nếu thiếu bất cứ điều nào trong ba:
 *
 *     if (a == null || a.mime == null || a.totalSize <= 0) → "Couldn't load media"
 *
 * Bản trước trả `{totalSize, bytesBase64}` — **không có `mime`** — nên điều kiện giữa luôn trượt và
 * MỌI video đều hỏng. Ảnh không hỏng vì ảnh nhúng thẳng trong proto, nên đường này chưa bao giờ chạy
 * một lần và không ai thấy: `coverage.lastArgs` ghi 198 lượt
 * `{"path":"/home/gb2u003/workspace/rec_test.mp4","offset":0,"length":0,"videoPlayback":true}`.
 *
 * Đường dẫn tới đây là đường TUYỆT ĐỐI trên box, không phải `file://`, nên `readBytes` nhận thẳng.
 * `videoPlayback` chỉ để client bỏ qua cache meta của chính nó; bên mình không có cache đó.
 *
 * `length: 0` vẫn là lượt hỏi kích thước, nhưng nay đọc `totalSize` từ CHÍNH box thay vì từ độ dài
 * một buffer đã bị `TEXT_PREVIEW_CAP` cắt.
 */
export async function readAttachmentChunk(args: {
  path?: unknown; offset?: unknown; length?: unknown;
}): Promise<{ totalSize: number; bytesBase64: string; mime: string } | null> {
  const path = typeof args?.path === "string" ? args.path : "";
  if (!path) return null;
  const from = Math.max(0, Number(args?.offset) || 0);
  const length = Number(args?.length) || 0;

  // Tệp do backend này stage: mime đã nằm trong kho, không phải đoán từ đuôi.
  const staged = store.get(path);
  if (staged != null) {
    const { bytes, mime } = staged;
    if (length <= 0 || from >= bytes.length) return { totalSize: bytes.length, bytesBase64: "", mime };
    return {
      totalSize: bytes.length,
      bytesBase64: bytes.subarray(from, from + Math.min(length, MEDIA_CHUNK_CAP)).toString("base64"),
      mime,
    };
  }
  return readBoxRange(path, from, length);
}

/**
 * Đọc một KHOẢNG byte của tệp trên box, kèm kích thước thật của nó.
 *
 * Tách khỏi `loadBytes` có chủ ý: `loadBytes` phục vụ bản xem trước văn bản nên nó luôn nạp từ
 * offset 0 với trần 128 KB. Phát video là đọc theo khoảng — client hỏi `bytes 131072-…` và một hàm
 * luôn đọc từ đầu thì trả sai dữ liệu mà không báo lỗi nào.
 */
async function readBoxRange(
  path: string, from: number, length: number,
): Promise<{ totalSize: number; bytesBase64: string; mime: string } | null> {
  try {
    const { boxCall, boxConfigured } = await import("./box-exec.js");
    if (!boxConfigured()) return null;
    const mime = MEDIA_MIME[extensionOf(path)] ?? "application/octet-stream";
    // `length: 0` là lượt hỏi kích thước của chính box — nó trả `totalSize` mà không chở byte nào.
    // `attach_file` đã dùng đúng lượt này từ lâu (`runtime/tools.ts`), nên hợp đồng là thứ đã chạy.
    const probe = await boxCall<{ totalSize?: number }>("readBytes", { target_file: path, offset: 0, length: 0 });
    const totalSize = Number(probe?.totalSize) || 0;
    if (totalSize <= 0) return null;
    if (length <= 0 || from >= totalSize) return { totalSize, bytesBase64: "", mime };
    const r = await boxCall<{ bytesBase64?: string }>("readBytes", {
      target_file: path, offset: from, length: Math.min(length, MEDIA_CHUNK_CAP),
    });
    return { totalSize, bytesBase64: r?.bytesBase64 ?? "", mime };
  } catch (e) {
    /*
     * NÓI RA vì sao, đừng chỉ trả null.
     *
     * Client vẽ đúng một chữ "Couldn't load media" cho mọi nguyên nhân, nên nếu bên này cũng im thì
     * ba chuyện khác hẳn nhau trông y hệt: đường nằm NGOÀI gốc box (`readBytes` từ chối bằng "path
     * escapes root"), file không tồn tại, và box chết. Tôi tự vấp cái đầu tiên trong lúc đo bản vá
     * này — `/home/gb2u003/rec/…` ngoài gốc `workspace` — và chỉ biết được sau khi đi đọc `desktop.ts`.
     */
    console.warn(`[grokbot2] readAttachmentChunk: box từ chối "${path}" — ${(e as Error).message}`);
    return null;
  }
}

bindAttachmentCatalog(attachmentCatalog);
