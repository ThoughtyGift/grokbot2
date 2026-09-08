/**
 * Epoch của replica phải BỀN qua khởi động lại, và mốc thứ tự KHÔNG BAO GIỜ TỤT.
 *
 *   node services/grokbot-backend/scripts/run-tests.mjs "services/grokbot-backend/src/epoch-ben.test.ts"
 *
 * Bài này ghim hai tính chất, và tính chất thứ hai mới là chỗ nguy: một epoch bền mà số tụt là sai
 * thứ tự IM LẶNG ở client 0.43 (`ingestSnapshot` bỏ thẳng khi `throughSequence < acceptedSequence`),
 * tệ hơn hẳn cái pane đứng mà bản vá này đi chữa. Xem đầu `chat/epoch-ben.ts` cho số đo 08/09.
 */
import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// Cách ly VÔ ĐIỀU KIỆN trước khi nạp module — không `??=` theo env của runner (bảng theo dõi §7).
const tam = mkdtempSync(join(tmpdir(), "gb2-epoch-"));
process.env.GROKBOT2_DATA_DIR = tam;
process.env.GROKBOT2_STATE_FILE = join(tam, "state.json");
process.env.GROKBOT2_SQLITE_FILE = join(tam, "grokbot.sqlite");
process.env.GROKBOT2_REPLICA_EPOCH_FILE = join(tam, "replica-epoch.json");

const M = await import("./chat/epoch-ben.js");
const { epochBen, mocSeq, datCho, KHOI, _quenChoTest } = M;

/** Mô phỏng một lần backend khởi động lại: quên bản đã nạp, đọc lại từ đĩa. */
const khoiDongLai = () => _quenChoTest();

test("epoch giữ NGUYÊN qua khởi động lại — đây là cả mục đích của bản vá", () => {
  const dau = epochBen();
  assert.ok(dau.length > 0);
  khoiDongLai();
  assert.equal(epochBen(), dau, "epoch đổi sau khởi động lại là quay về đúng lỗi 08/09");
  khoiDongLai();
  assert.equal(epochBen(), dau);
});

test("số phát ra sau khởi động lại CAO HƠN mọi số đã phát", () => {
  const khoa = "transcript:agent-1078";
  // Một lượt streaming đẩy sequence lên cao hơn số entry rất nhiều — cho nó vượt qua đúng biên lô,
  // vì nhánh "đặt chỗ thêm một lô" chỉ chạy khi bộ đếm VƯỢT mốc, không chạy mỗi số.
  let daPhat = 0;
  for (const seq of [1, 2, 50, 172, 400, KHOI + 2, KHOI + 3]) { datCho(khoa, seq); daPhat = seq; }

  khoiDongLai();
  const san = mocSeq(khoa);
  assert.ok(san > daPhat, `sàn sau khởi động lại (${san}) phải > số đã phát (${daPhat})`);
  // Và lãng phí có TRẦN: lỗ chuỗi sau một lần khởi động lại không quá một lô. (Sàn KHÔNG phải
  // `daPhat + KHOI` — mốc đặt lúc bộ đếm vượt lô, nên nó nằm đâu đó trong khoảng một lô phía trên.)
  assert.ok(san <= daPhat + KHOI, `sàn (${san}) không được vượt quá một lô trên số đã phát`);
});

test("số nhỏ hơn mốc KHÔNG kéo mốc xuống", () => {
  const khoa = "transcript:agent-x";
  datCho(khoa, 500);
  const truoc = mocSeq(khoa);
  datCho(khoa, 3);
  datCho(khoa, 499);
  assert.equal(mocSeq(khoa), truoc, "mốc chỉ được đi LÊN — đây là thứ chặn sai thứ tự");
});

test("mỗi khoá một mốc riêng: bot này không đẩy chuỗi của bot khác", () => {
  datCho("transcript:agent-a", 900);
  assert.equal(mocSeq("transcript:agent-b"), 0);
  assert.ok(mocSeq("transcript:agent-a") >= 900);
});

test("ghi một lần mỗi LÔ, không ghi mỗi sự kiện", () => {
  const khoa = "transcript:agent-lo";
  datCho(khoa, 1);
  const lan1 = readFileSync(process.env.GROKBOT2_REPLICA_EPOCH_FILE!, "utf8");
  // Mọi số trong cùng lô không được chạm đĩa nữa.
  for (let i = 2; i <= KHOI; i++) datCho(khoa, i);
  assert.equal(readFileSync(process.env.GROKBOT2_REPLICA_EPOCH_FILE!, "utf8"), lan1,
    "trong cùng một lô thì không được ghi lại — nếu không là một lần ghi đĩa mỗi token");
});

test("tệp hỏng thì đúc epoch MỚI, không ném và không giữ epoch cũ", () => {
  // Mốc đã mất nên giữ epoch cũ chính là cảnh sai thứ tự — đúc mới là lựa chọn an toàn.
  const cu = epochBen();
  writeFileSync(process.env.GROKBOT2_REPLICA_EPOCH_FILE!, "{ khong phai json");
  khoiDongLai();
  const moi = epochBen();
  assert.ok(moi.length > 0);
  assert.notEqual(moi, cu);
  assert.equal(mocSeq("transcript:agent-1078"), 0, "kho mới thì mốc về 0 cùng epoch mới");
});

test("EPOCH của sản phẩm không còn là `Date.now()` mỗi lần nạp", () => {
  const src = readFileSync(new URL("./chat/state.ts", import.meta.url), "utf8");
  const dong = src.split("\n").find((l) => l.includes("export const EPOCH"));
  assert.ok(dong, "không thấy dòng EPOCH");
  assert.ok(!dong!.includes("Date.now()"),
    "EPOCH lấy `Date.now()` lúc nạp module là đúng lỗi 08/09: mỗi lần nạp lại làm mồ côi mọi replica");
  assert.match(dong!, /epochBen\(\)/);
});
