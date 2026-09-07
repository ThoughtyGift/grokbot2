/**
 * Chép tệp máy người dùng ↔ box — phần kiểm được KHÔNG cần daemon nào (tiêm `Day` giả).
 *
 * Ghim đúng những thứ sai im lặng nhất: số khúc và cờ `append` (thiếu cờ ở khúc 2 là tệp bị ghi đè
 * còn đúng 1 khúc cuối mà không lỗi nào), sha256 đầu-cuối, đường dẫn mặc định hai chiều, và trần
 * 100 MiB được nói bằng câu tiếng Việt TRƯỚC khi gửi. Đường thật đo qua `/internal/ops/local-exec`
 * kind `copy-to-box` / `copy-from-box` — bảng theo dõi §2.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chepLenBox, chepVeMay, catKhuc, tenTep, KHUC_LEN_BOX, KHUC_TU_BOX, TRAN_TEP, type Day } from "./chep-tep.js";

/** Chủ giả — `chepLenBox`/`chepVeMay` đòi owner từ 07/09 (sổ máy tách theo người). */
const CHU = "auth0|nguoi-do";

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const dem = (n: number, seed: number) => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = (i * 31 + seed) & 255; return b; };

/** Máy người dùng giả: một tệp; box giả: kho `Map` đường dẫn → đệm, ghi/nối như daemon thật. */
function dungDay(tepMay: Record<string, Buffer>, box: Map<string, Buffer>) {
  const goi = { ghi: [] as { path: string; bytes: number; append: boolean }[], doc: [] as { offset: number; length: number }[], day: [] as { path: string; bytes: number }[] };
  const day: Day = {
    async taiTuMay(path) {
      const b = tepMay[path];
      return b ? { ok: true, data: { bytesBase64: b.toString("base64") } } : { ok: false, error: "Path is outside the allowed local-exec root and was refused: " + path };
    },
    async dayLenMay(path, bytesBase64) { const b = Buffer.from(bytesBase64, "base64"); goi.day.push({ path, bytes: b.length }); tepMay[path] = b; return { ok: true }; },
    async ghiBox(a) {
      const k = Buffer.from(a.bytesBase64, "base64");
      goi.ghi.push({ path: a.path, bytes: k.length, append: a.append });
      box.set(a.path, a.append ? Buffer.concat([box.get(a.path) ?? Buffer.alloc(0), k]) : k);
      return { totalSize: box.get(a.path)!.length };
    },
    async docBox(a) {
      const b = box.get(a.path); if (!b) throw new Error(`ENOENT: ${a.path}`);
      goi.doc.push({ offset: a.offset, length: a.length });
      return { totalSize: b.length, bytesBase64: b.subarray(a.offset, a.offset + a.length).toString("base64") };
    },
  };
  return { day, goi };
}

test("catKhuc: cắt đúng biên, tệp rỗng vẫn ra một khúc rỗng (để tạo được tệp 0 byte)", () => {
  assert.equal(catKhuc(Buffer.alloc(0), 4).length, 1);
  assert.deepEqual(catKhuc(Buffer.alloc(9), 4).map((k) => k.length), [4, 4, 1]);
  assert.deepEqual(catKhuc(Buffer.alloc(8), 4).map((k) => k.length), [4, 4]);
  assert.equal(tenTep("C:\\Users\\admin\\Desktop\\clip.mp4"), "clip.mp4");
  assert.equal(tenTep("tu-may/anh.png"), "anh.png");
});

test("máy → box: 13 MiB thành 3 khúc, khúc đầu ghi mới, hai khúc sau append, sha khớp, mặc định tu-may/<tên>", async () => {
  const goc = dem(13 * 1024 * 1024 + 7, 3);
  const box = new Map<string, Buffer>();
  const { day, goi } = dungDay({ "C:/Users/admin/Desktop/clip.mp4": goc }, box);
  const r = await chepLenBox({ machineId: "may-1", owner: CHU, duongMay: "C:/Users/admin/Desktop/clip.mp4" }, day);
  assert.ok(r.ok, JSON.stringify(r));
  if (!r.ok) return;
  assert.equal(r.duongBox, "tu-may/clip.mp4");
  assert.equal(r.khuc, 3);
  assert.deepEqual(goi.ghi.map((g) => [g.bytes, g.append]), [[KHUC_LEN_BOX, false], [KHUC_LEN_BOX, true], [goc.length - 2 * KHUC_LEN_BOX, true]]);
  assert.equal(sha(box.get("tu-may/clip.mp4")!), sha(goc), "tệp trên box phải là bản chép từng byte");
  assert.equal(r.sha256, sha(goc));
  assert.equal(r.bytes, goc.length);
});

test("máy → box: boxPath tự chọn được; tệp rỗng vẫn tạo; ngoài root máy thì trả lỗi của daemon", async () => {
  const box = new Map<string, Buffer>();
  const { day, goi } = dungDay({ "C:/Users/admin/rong.txt": Buffer.alloc(0) }, box);
  const r = await chepLenBox({ machineId: "may-1", owner: CHU, duongMay: "C:/Users/admin/rong.txt", duongBox: "inbox/r.txt" }, day);
  assert.ok(r.ok && r.duongBox === "inbox/r.txt" && r.khuc === 1 && r.bytes === 0);
  assert.equal(box.get("inbox/r.txt")!.length, 0);
  assert.equal(goi.ghi[0].append, false);
  const x = await chepLenBox({ machineId: "may-1", owner: CHU, duongMay: "C:/Windows/x.dll" }, day);
  assert.equal(x.ok, false);
  assert.match(String(!x.ok && x.error), /outside the allowed local-exec root/);
});

test("máy → box: quá 100 MiB thì nói bằng câu tiếng Việt, không gửi khúc nào lên box", async () => {
  const box = new Map<string, Buffer>();
  const { day, goi } = dungDay({ "C:/Users/admin/to.bin": Buffer.alloc(TRAN_TEP + 1) }, box);
  const r = await chepLenBox({ machineId: "may-1", owner: CHU, duongMay: "C:/Users/admin/to.bin" }, day);
  assert.equal(r.ok, false);
  assert.match(String(!r.ok && r.error), /vượt trần 100\.0 MiB/);
  assert.equal(goi.ghi.length, 0);
});

test("box → máy: 9 MiB đọc 3 khúc 4 MiB, ghi MỘT lần lên máy vào <localRoot>\\Desktop\\<tên>, sha khớp", async () => {
  const goc = dem(9 * 1024 * 1024 + 1, 9);
  const box = new Map<string, Buffer>([["ket-qua/ra.mp4", goc]]);
  const tepMay: Record<string, Buffer> = {};
  const { day, goi } = dungDay(tepMay, box);
  const r = await chepVeMay({ machineId: "may-1", owner: CHU, duongBox: "ket-qua/ra.mp4", localRoot: "C:\\Users\\admin" }, day);
  assert.ok(r.ok, JSON.stringify(r));
  if (!r.ok) return;
  assert.equal(r.duongMay, "C:\\Users\\admin\\Desktop\\ra.mp4");
  assert.deepEqual(goi.doc.map((d) => d.offset), [0, KHUC_TU_BOX, 2 * KHUC_TU_BOX]);
  assert.equal(goi.day.length, 1, "đường máy người dùng ↔ backend đi một khung, không cắt");
  assert.equal(sha(tepMay["C:\\Users\\admin\\Desktop\\ra.mp4"]), sha(goc));
  assert.equal(r.khuc, 3);
});

test("box → máy: thiếu localRoot lẫn path thì từ chối có chữ; tệp không có trên box thì nói tên tệp", async () => {
  const { day } = dungDay({}, new Map([["a.txt", Buffer.from("x")]]));
  const r = await chepVeMay({ machineId: "may-1", owner: CHU, duongBox: "a.txt" }, day);
  assert.equal(r.ok, false);
  assert.match(String(!r.ok && r.error), /"path"/);
  const x = await chepVeMay({ machineId: "may-1", owner: CHU, duongBox: "khong-co.txt", duongMay: "C:/Users/admin/Desktop/k.txt" }, day);
  assert.equal(x.ok, false);
  assert.match(String(!x.ok && x.error), /khong-co\.txt/);
});
