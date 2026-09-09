/**
 * Bài đo cho kho thuê bao. Cửa mạng tiêm được nên bài này **không mở socket nào** — và chính điều
 * đó là một trong những thứ nó ghim: chưa bật thì kho phải im, không phải "im mà vẫn gọi".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { taoKho, idCinapi, khoaDichVu, KHOA_TOI_THIEU } from "./thue-bao-kho.js";
import type { Lay } from "./cinapi-danh-tinh.js";

const KHOA = "k".repeat(KHOA_TOI_THIEU);
const AI = "cinapi|nguoi-thu-nghiem-01";

const THAN = JSON.stringify({
  code: 0, msg: "ok",
  data: { subscription: {
    plan_key: "pro", status: "ACTIVE",
    period_start: "2026-09-01T00:00:00Z", period_end: "2026-10-01T00:00:00Z",
    credits_remaining: 400,
    window_used: 0, window_remaining: 0, window_cycle_end: null,
    week_used: 0, week_remaining: 0, week_cycle_end: null,
    plan: { plan_key: "pro", name: "Pro", monthly_credits: 1000, window_hours: 5, window_credits: 0, week_credits: 0 },
  } },
});

/** Cửa mạng giả: ghi lại mọi URL + header đã đi qua, trả thân do bài đo chọn. */
function cuaGia(than: () => { ok: boolean; body: string }) {
  const di: { url: string; headers: Record<string, string> }[] = [];
  const lay: Lay = async (url, init) => {
    di.push({ url, headers: init.headers });
    const r = than();
    return { ok: r.ok, status: r.ok ? 200 : 500, text: async () => r.body };
  };
  return { lay, di };
}

const nhip = () => new Promise<void>((r) => setImmediate(r));

test("chưa bật (vắng gốc hoặc vắng khoá) ⇒ null và KHÔNG mở socket nào", async () => {
  for (const [goc, khoa] of [[null, KHOA], ["http://x", null], [null, null]] as const) {
    const g = cuaGia(() => ({ ok: true, body: THAN }));
    const kho = taoKho({ lay: g.lay, goc, khoa });
    assert.equal(kho.doc(AI), null);
    await nhip();
    assert.equal(kho.soLuot(), 0, `goc=${goc} khoa=${khoa ? "co" : "vang"} — kho đã gọi mạng khi chưa bật`);
    assert.equal(g.di.length, 0);
  }
});

test("khoá ngắn hơn ngưỡng thì coi như chưa đặt — cùng ngưỡng với phía Go", async () => {
  const g = cuaGia(() => ({ ok: true, body: THAN }));
  const kho = taoKho({ lay: g.lay, goc: "http://x", khoa: "k".repeat(KHOA_TOI_THIEU - 1) });
  kho.doc(AI);
  await nhip();
  assert.equal(kho.soLuot(), 0);
});

test("danh tính KHÔNG phải cinapi thì không hỏi ai", async () => {
  const g = cuaGia(() => ({ ok: true, body: THAN }));
  const kho = taoKho({ lay: g.lay, goc: "http://x", khoa: KHOA });
  for (const ai of ["auth0|grokbot2-user", "local|a@b.c", "", "cinapi|", "cinapi|co|gach"]) {
    assert.equal(kho.doc(ai), null);
  }
  await nhip();
  assert.equal(kho.soLuot(), 0);
});

test("lượt đầu null rồi có số; khoá đi trong HEADER, không trong URL", async () => {
  const g = cuaGia(() => ({ ok: true, body: THAN }));
  const kho = taoKho({ lay: g.lay, goc: "http://cinapi.test", khoa: KHOA });

  assert.equal(kho.doc(AI), null, "lượt đầu phải null — app không vẽ thanh nào");
  await nhip();
  const tb = kho.doc(AI);
  assert.equal(tb?.planTen, "Pro");
  assert.equal(tb?.tuiConLai, 400);

  assert.equal(g.di.length, 1);
  assert.equal(g.di[0].url, "http://cinapi.test/api/v1/internal/me/subscription");
  assert.doesNotMatch(g.di[0].url, /k{10}/, "khoá lọt vào URL — nó sẽ nằm trong access log của nginx");
  assert.equal(g.di[0].headers["x-service-token"], KHOA);
  assert.equal(g.di[0].headers["x-service-user-id"], "nguoi-thu-nghiem-01");
});

test("còn hạn thì KHÔNG hỏi lại; quá hạn thì hỏi lại", async () => {
  let t = 1_000_000;
  const g = cuaGia(() => ({ ok: true, body: THAN }));
  const kho = taoKho({ lay: g.lay, goc: "http://x", khoa: KHOA, ttlMs: 1000, now: () => t });

  kho.doc(AI); await nhip();
  assert.equal(kho.soLuot(), 1);

  t += 500; kho.doc(AI); await nhip();
  assert.equal(kho.soLuot(), 1, "còn hạn mà vẫn hỏi lại");

  t += 600; kho.doc(AI); await nhip();
  assert.equal(kho.soLuot(), 2, "quá hạn mà không hỏi lại");
});

test("một lượt bay mỗi người — nhiều lượt đọc liên tiếp không thành lụt", async () => {
  const g = cuaGia(() => ({ ok: true, body: THAN }));
  const kho = taoKho({ lay: g.lay, goc: "http://x", khoa: KHOA });
  for (let i = 0; i < 20; i++) kho.doc(AI);
  await nhip();
  assert.equal(kho.soLuot(), 1);
});

test("lượt làm mới HỎNG không xoá số cũ — thanh đo không nhấp nháy theo mạng", async () => {
  let t = 1_000_000;
  let tot = true;
  const g = cuaGia(() => (tot ? { ok: true, body: THAN } : { ok: false, body: "" }));
  const kho = taoKho({ lay: g.lay, goc: "http://x", khoa: KHOA, ttlMs: 1000, now: () => t });

  kho.doc(AI); await nhip();
  assert.equal(kho.doc(AI)?.planTen, "Pro");

  tot = false;
  t += 2000; kho.doc(AI); await nhip();
  assert.equal(kho.doc(AI)?.planTen, "Pro", "một lượt hỏng đã xoá mất số cũ");
  assert.equal(kho.soLuot(), 3);
});

test("thân lạ ⇒ không dựng ra gói nào, và cũng không xoá số cũ", async () => {
  const g = cuaGia(() => ({ ok: true, body: '{"data":{"khong":"phai"}}' }));
  const kho = taoKho({ lay: g.lay, goc: "http://x", khoa: KHOA });
  kho.doc(AI); await nhip();
  assert.equal(kho.doc(AI), null);
});

test("lamMoi chờ được, cho đường đăng nhập dùng", async () => {
  const g = cuaGia(() => ({ ok: true, body: THAN }));
  const kho = taoKho({ lay: g.lay, goc: "http://x", khoa: KHOA });
  const tb = await kho.lamMoi(AI);
  assert.equal(tb?.planKey, "pro");
  assert.equal(kho.doc(AI)?.planKey, "pro", "lamMoi phải nạp luôn vào kho");
});

test("idCinapi + khoaDichVu: hình dạng, không phải ý định", () => {
  assert.equal(idCinapi("cinapi|abc"), "abc");
  assert.equal(idCinapi("  cinapi|abc  "), "abc");
  assert.equal(idCinapi("cinapi|a b"), null);
  assert.equal(idCinapi("auth0|x"), null);

  const cu = process.env.GROKBOT2_CINAPI_SERVICE_TOKEN;
  try {
    delete process.env.GROKBOT2_CINAPI_SERVICE_TOKEN;
    assert.equal(khoaDichVu(), null);
    process.env.GROKBOT2_CINAPI_SERVICE_TOKEN = "ngan";
    assert.equal(khoaDichVu(), null);
    process.env.GROKBOT2_CINAPI_SERVICE_TOKEN = KHOA;
    assert.equal(khoaDichVu(), KHOA);
  } finally {
    if (cu === undefined) delete process.env.GROKBOT2_CINAPI_SERVICE_TOKEN;
    else process.env.GROKBOT2_CINAPI_SERVICE_TOKEN = cu;
  }
});
