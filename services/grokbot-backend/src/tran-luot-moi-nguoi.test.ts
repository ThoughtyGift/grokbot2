/**
 * Trần lượt song song theo CHỦ — phép đếm, và chỗ nó được cắm vào.
 *
 * Hai nửa, cố ý:
 *
 * 1. Phép đếm đo trực tiếp (`runtime/tran-luot.ts` thuần, tiêm được hai nguồn) — nạp module này
 *    KHÔNG kéo pool/box/SQLite, nên bài đo không có đường nào tới kho thật (§7 "bộ test xoá kho").
 * 2. Chỗ CẮM đọc bằng mã nguồn, đúng nếp `luot-noi-tiep-bat-co-chay.test.ts`: điều đáng khoá không
 *    phải "hàm trả đúng số" mà là "trần chặn lượt MỚI và KHÔNG chặn lượt nối tiếp". Cái đó nằm ở
 *    việc nó đứng trong `startTurn` chứ không trong `runTurn` — một sự thật về cấu trúc, không phải
 *    về giá trị trả về.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { quaTranLuot, tranLuotMoiNguoi, cauQuaTran } from "./runtime/tran-luot.js";

const BIEN = "GROKBOT2_MAX_TURNS_PER_USER";
/** Đặt trần cho MỘT phép đo rồi trả lại nguyên trạng — bài sau không được thừa hưởng env của bài trước. */
const voiTran = (tran: string | undefined, f: () => void): void => {
  const cu = process.env[BIEN];
  if (tran === undefined) delete process.env[BIEN]; else process.env[BIEN] = tran;
  try { f(); } finally { if (cu === undefined) delete process.env[BIEN]; else process.env[BIEN] = cu; }
};

/** Sổ chủ giả: bot nào của ai. Bot không có trong sổ coi như của "khach". */
const SO: Record<string, string> = {
  "a1": "chu-A", "a2": "chu-A", "a3": "chu-A", "a4": "chu-A", "a5": "chu-A",
  "b1": "chu-B", "b2": "chu-B",
};
const chuCua = (id: string): string => SO[id] ?? "khach";

test("mặc định là 4 — bằng số bot con của một 'đội' mà chính dự án dựng", () => {
  voiTran(undefined, () => assert.equal(tranLuotMoiNguoi(), 4));
});

test("dưới trần thì cho chạy, và `dang` KHÔNG tính bot đang gửi", () => {
  voiTran("4", () => {
    // a1 đang gửi (đã nằm trong inflight vì sendPrompt vừa đặt), a2 a3 đang chạy thật.
    const k = quaTranLuot("a1", chuCua, ["a1", "a2", "a3"]);
    assert.equal(k.qua, false);
    assert.equal(k.dang, 2, "phải đếm a2 a3, bỏ a1");
    assert.equal(k.tran, 4);
  });
});

test("đủ trần thì từ chối — đếm theo CHỦ, không theo bot", () => {
  voiTran("2", () => {
    const k = quaTranLuot("a1", chuCua, ["a1", "a2", "a3"]);
    assert.equal(k.qua, true, "chủ A đã có 2 lượt khác chạy, trần 2");
    assert.equal(k.dang, 2);
  });
});

test("lượt của người KHÁC không tính vào trần của mình", () => {
  voiTran("2", () => {
    // Chủ B đang chạy hai lượt; chủ A mới có một mình a1 → phải được đi.
    const k = quaTranLuot("a1", chuCua, ["a1", "b1", "b2"]);
    assert.equal(k.qua, false, "trần theo chủ, không phải trần toàn hệ");
    assert.equal(k.dang, 0);
  });
});

test("trần 1 KHÔNG tự chặn lượt đầu của chính người mở nó", () => {
  voiTran("1", () => {
    // Chỉ a1 trong inflight — chính nó. Nếu phép đếm không loại nó thì trần 1 chặn mọi lượt đầu.
    assert.equal(quaTranLuot("a1", chuCua, ["a1"]).qua, false);
    // Nhưng có thêm một lượt khác của cùng chủ thì chặn.
    assert.equal(quaTranLuot("a1", chuCua, ["a1", "a2"]).qua, true);
  });
});

test("0 là TẮT — và số rác cũng là tắt, không phải trần 0 chặn mọi thứ", () => {
  for (const v of ["0", "-3", "khong-phai-so", ""]) {
    voiTran(v, () => {
      assert.equal(tranLuotMoiNguoi(), 0, `"${v}" phải là tắt`);
      const k = quaTranLuot("a1", chuCua, ["a1", "a2", "a3", "a4", "a5"]);
      assert.equal(k.qua, false, `"${v}" phải cho qua`);
      assert.equal(k.tran, 0);
    });
  }
});

test("câu từ chối nói ĐỦ hai con số và một lối đi tiếp", () => {
  const s = cauQuaTran({ qua: true, dang: 4, tran: 4 });
  assert.match(s, /4 lượt/, "phải nêu số lượt đang chạy");
  assert.match(s, /trần là 4/, "phải nêu trần");
  assert.match(s, /gửi lại|dừng/i, "phải có lối đi tiếp, không được là ngõ cụt");
  assert.doesNotMatch(s, /quota|limit|owner|inflight/i, "câu cho người dùng, không phải cho quản trị viên");
});

// ── nửa thứ hai: chỗ CẮM ────────────────────────────────────────────────────────────────────────

const nguon = readFileSync(new URL("./runtime/turn.ts", import.meta.url), "utf8");
const thanHam = (ten: string): string => {
  const i = nguon.indexOf(`function ${ten}(`);
  assert.ok(i >= 0, `không thấy hàm ${ten}`);
  const j = nguon.indexOf("\nasync function ", i + 1);
  const k = nguon.indexOf("\nfunction ", i + 1);
  const het = [j, k].filter((n) => n > 0).sort((x, y) => x - y)[0];
  return nguon.slice(i, het ?? undefined);
};

test("trần được gọi trong `startTurn` — nơi một lượt MỚI được vũ trang", () => {
  const than = thanHam("startTurn");
  assert.match(than, /quaTranLuot\(/, "startTurn phải hỏi trần");
  assert.match(than, /postNotice\(agentId, cauQuaTran\(/, "từ chối phải đi bằng notice, không bằng bong bóng của bot");
  assert.match(than, /ownerOf\(id\) \?\? DEFAULT_USER\.authId/,
    "chủ phải lấy từ ownerOf — lượt chạy tách khỏi request nên currentOwner() ở đây là danh tính mặc định");
});

test("`runTurn` KHÔNG hỏi trần — lượt nối tiếp phải chạy hết, không bị cắt giữa đường", () => {
  const than = thanHam("runTurn");
  assert.doesNotMatch(than, /quaTranLuot\(/,
    "đặt trần trong runTurn là chặn cả continueAfterTool: bot dừng giữa lượt sau khi người dùng đã bấm widget");
});

test("trần phải quyết TRƯỚC dấu `await` đầu tiên — đây là thứ làm nó không có đua", () => {
  /*
   * `sendPrompt` đặt `inflight` rồi gọi `void startTurn(...)`. Vì startTurn là `async`, phần thân
   * TRƯỚC `await` đầu tiên chạy đồng bộ ngay trong cùng nhịp ấy — nên hai lời gọi song song được
   * quyết lần lượt, người thứ hai thấy người thứ nhất đã nằm trong `inflight` VÀ đã qua cửa.
   *
   * Đẩy cửa trần xuống sau một `await` là phá đúng tính chất đó: hai lượt gửi cùng lúc sẽ cùng đếm
   * "0 lượt khác đang chạy" rồi cùng đi qua, hoặc (tệ hơn, khi đã đông) cùng đếm thấy nhau rồi
   * CÙNG bị từ chối — trần lẽ ra cho 4 qua thì chặn cả 5.
   */
  const than = thanHam("startTurn");
  const iTran = than.indexOf("quaTranLuot(");
  const iAwait = than.indexOf("await ");
  assert.ok(iTran >= 0, "phải thấy cửa trần");
  assert.ok(iAwait >= 0, "startTurn phải có await, nếu không bài đo này vô nghĩa");
  assert.ok(iTran < iAwait,
    "cửa trần phải nằm trong phần đồng bộ của startTurn, trước await đầu tiên");
});

test("trần phải quyết TRƯỚC khi đặt cờ đang-chạy, không phải sau", () => {
  const than = thanHam("startTurn");
  const iTran = than.indexOf("quaTranLuot(");
  const iPresence = than.indexOf("setPresence(agentId, { isRunning: true");
  assert.ok(iTran >= 0 && iPresence >= 0, "phải thấy cả hai mốc");
  assert.ok(iTran < iPresence,
    "quay spinner rồi mới từ chối là hai lần nói ngược nhau trên cùng một màn hình");
});
