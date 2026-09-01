/**
 * `sand-media://` — đường client nạp VIDEO — và vì sao nó trả "Couldn't load media".
 *
 * Trích 01/09 từ `electron-main/main.cjs` bản 0.30 (`gatewayMediaRemoteReader`): scheme `sand-media`
 * không đọc file trực tiếp, nó gọi thẳng gateway command của ta:
 *
 *     readChunk(path, offset, length, videoPlayback)
 *       → readAttachmentChunk({path, offset, length, videoPlayback})
 *       → { bytesBase64, totalSize, mime }
 *
 * và trước khi phát, nó hỏi metadata bằng một lượt `offset:0, length:0`:
 *
 *     const a = await readChunk(path, 0, 0, videoPlayback);
 *     if (a == null || a.mime == null || a.totalSize <= 0) return m3t();   // ← "Couldn't load media"
 *
 * Ba điều kiện, và ta trượt điều kiện GIỮA: handler của ta trả `{totalSize, bytesBase64}` và chưa
 * bao giờ trả `mime`. Nên **mọi** video qua `sand-media` đều hỏng — không phải hỏng ngẫu nhiên.
 *
 * Ảnh không hỏng vì ảnh đi đường khác (nhúng thẳng trong proto), nên video là thứ đầu tiên thực sự
 * cần `sand-media`, và nó chưa từng chạy một lần.
 *
 * Bài này chạy dưới `node --test`, nên `dataDir()` trỏ vào thư mục tạm (`NODE_TEST_CONTEXT`) — nó
 * KHÔNG chạm `.data` của người dùng. Điều đó là cố ý: kho attachment có `MAX_ENTRIES = 64` và tự
 * `unlinkSync` bản cũ nhất, nên một bài test stage file vào kho thật có thể XOÁ ảnh thật của người
 * dùng. Đây là bẫy cùng họ với "sổ trắng hoá ra không trắng" trong §7 bảng theo dõi.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { readAttachmentChunk, stageFile } from "./attachments.js";

/** 20 byte "video" — nội dung không quan trọng, chỉ cần bytes có thật và mime khai đúng. */
const MP4_GIA = `data:video/mp4;base64,${Buffer.alloc(20, 7).toString("base64")}`;

test("lượt hỏi metadata (length: 0) trả về mime — thiếu nó client vẽ 'Couldn't load media'", async () => {
  const path = stageFile(MP4_GIA, "quay-man-hinh.mp4", "video/mp4");
  assert.ok(path, "stageFile phải trả về đường dẫn ảo");

  const meta = await readAttachmentChunk({ path, offset: 0, length: 0 });
  assert.ok(meta, "lượt hỏi metadata không được trả null");

  // Đúng ba điều kiện client kiểm, theo đúng thứ tự trong `resolveRemoteMeta`.
  assert.notEqual(meta.mime, null, "mime là null → client dừng ở đây và vẽ 'Couldn't load media'");
  assert.equal(meta.mime, "video/mp4");
  assert.ok(meta.totalSize > 0, "totalSize <= 0 cũng ra cùng lỗi ấy");
  assert.equal(meta.totalSize, 20, "totalSize phải là kích thước THẬT của file");
});

test("lượt đọc dữ liệu trả đúng khoảng byte, và mime đi kèm mọi lượt", async () => {
  const path = stageFile(MP4_GIA, "clip.mp4", "video/mp4");
  assert.ok(path);

  const chunk = await readAttachmentChunk({ path, offset: 4, length: 6 });
  assert.ok(chunk);
  assert.equal(chunk.mime, "video/mp4", "client dùng mime của lượt dữ liệu làm content-type khi meta thiếu");
  assert.equal(chunk.totalSize, 20);
  assert.equal(Buffer.from(chunk.bytesBase64, "base64").length, 6);
});

test("file không nhận ra kiểu vẫn phải có mime — application/octet-stream chứ không phải null", async () => {
  const path = stageFile(`data:application/octet-stream;base64,${Buffer.alloc(8).toString("base64")}`, "khong-duoi");
  assert.ok(path);
  const meta = await readAttachmentChunk({ path, offset: 0, length: 0 });
  assert.ok(meta);
  assert.ok(typeof meta.mime === "string" && meta.mime.length > 0, "mime rỗng cũng là null với client");
});
