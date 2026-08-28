/**
 * `transcribeAudio` qua CỔNG — cái micro trong khung soạn tin.
 *
 *   npx tsx --test services/grokbot-backend/src/transcribe-gateway.test.ts
 *
 * Backend này đã trả lời RPC proto `TranscribeAudio` từ lâu, nhưng client 0.29 hỏi qua **cổng box**
 * và đường đó chưa có — nút mic quay xong, gửi đi, rồi im. Hình dạng hai đầu trích từ bundle 0.29:
 *
 *   vào : {audioBase64: <base64>, mimeType: "...", language?: "..."}
 *   ra  : record, và renderer rút ĐÚNG một trường —
 *         `function hGt(t){const{text:e}=t;return{text:e}}`
 *
 * Bài quan trọng nhất: **không bao giờ được ném lỗi ra cổng.** Bộ phiên âm chưa cài hay âm thanh
 * hỏng đều là "không nghe ra chữ nào" (`{text:""}`, người dùng gõ tay), còn một lỗi văng ra thì cái
 * nút chết mà không nói gì — đúng thứ ta đang đi sửa.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildCommands } from "@grokbot2/cursor-acl";

/** Cổng giả: mọi thứ trả rỗng, chỉ `media.transcribe` là thật cho từng bài. */
function commandsWith(transcribe?: (a: Buffer, m: string, l?: string) => Promise<{ text: string; ms: number }>) {
  const anyPort: any = new Proxy({}, { get: () => new Proxy(() => ({}), { get: () => () => ({}) }) });
  const ports: any = new Proxy({}, {
    get: (_t, k) => (k === "media" ? { ...anyPort, transcribe, stagedCount: () => 0 } : anyPort),
  });
  return buildCommands(ports);
}

test("giải mã base64 rồi đưa ĐÚNG bytes + mimeType + language xuống bộ phiên âm", async () => {
  let seen: { audio: Buffer; mime: string; lang?: string } | null = null;
  const cmds = commandsWith(async (audio, mime, lang) => {
    seen = { audio, mime, lang };
    return { text: "xin chào", ms: 42 };
  });
  const out = await cmds.transcribeAudio({
    audioBase64: Buffer.from("RIFFxxxx").toString("base64"),
    mimeType: "audio/webm",
    language: "vi",
  });
  assert.deepEqual(out, { text: "xin chào", ms: 42 });
  assert.equal(seen!.audio.toString("utf8"), "RIFFxxxx", "phải là bytes đã giải mã, không phải chuỗi base64");
  assert.equal(seen!.mime, "audio/webm");
  assert.equal(seen!.lang, "vi");
});

test("không có language thì truyền undefined, không phải chuỗi rỗng", async () => {
  let lang: unknown = "chưa gọi";
  const cmds = commandsWith(async (_a, _m, l) => { lang = l; return { text: "", ms: 0 }; });
  await cmds.transcribeAudio({ audioBase64: Buffer.from("abc").toString("base64"), mimeType: "audio/webm" });
  assert.equal(lang, undefined);
});

test("chưa cài bộ phiên âm → {text:''} chứ KHÔNG phải 404 hay lỗi", async () => {
  const cmds = commandsWith(undefined);
  const out = await cmds.transcribeAudio({ audioBase64: Buffer.from("abc").toString("base64"), mimeType: "audio/webm" });
  assert.deepEqual(out, { text: "", ms: 0 });
});

test("bộ phiên âm NÉM LỖI vẫn phải ra record — nút mic không được chết câm", async () => {
  const cmds = commandsWith(async () => { throw new Error("no transcriber installed"); });
  const out = await cmds.transcribeAudio({ audioBase64: Buffer.from("abc").toString("base64"), mimeType: "audio/webm" });
  // Nếu một ngày ai đó cho lỗi văng ra khỏi đây, bài này phải đỏ.
  assert.equal((out as { text: string }).text, "");
});

test("đối số thiếu/hỏng: không gọi bộ phiên âm, trả record rỗng", async () => {
  let called = 0;
  const cmds = commandsWith(async () => { called += 1; return { text: "khong duoc goi", ms: 1 }; });
  for (const bad of [undefined, {}, { audioBase64: "" }, { audioBase64: 123 }, { mimeType: "audio/webm" }]) {
    const out = await cmds.transcribeAudio(bad as never);
    assert.equal((out as { text: string }).text, "", JSON.stringify(bad));
  }
  assert.equal(called, 0, "không được gọi bộ phiên âm với đầu vào rỗng");
});
