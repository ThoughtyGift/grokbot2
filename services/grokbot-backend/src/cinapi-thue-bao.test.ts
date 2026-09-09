/**
 * Bài đo cho khối quyết định của Bước 4. Module THUẦN nên bài này chạy được **trước khi nối dây** —
 * §7: *"một bài đo cho module thuần thì chạy được TRƯỚC khi nối dây, hãy chạy nó ở đó"*.
 *
 * Nó ghim những điều PHỦ ĐỊNH là chính: hết cửa sổ **không** phải `payment_required`; một trạng thái
 * lạ **không** chặn người đang trả tiền; thiếu `plan_key` thì **không** dựng ra một gói.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  docThueBao, cuaChanTruoc, oCamTuThueBao, phanDung, conHieuLuc, moc, type Cua,
} from "./cinapi-thue-bao.js";

/** Thân dựng theo `mySubscriptionDTO` (`internal/handler/subscription.go:168`) + `planDTO` (`:37`). */
function than(sua: Record<string, unknown> = {}, suaGoi: Record<string, unknown> = {}): string {
  return JSON.stringify({
    code: 0,
    msg: "ok",
    data: {
      plan_key: "pro",
      status: "active",
      period_start: "2026-09-01T00:00:00Z",
      period_end: "2026-10-01T00:00:00Z",
      credits_remaining: 8000,
      window_used: 100,
      window_remaining: 900,
      week_used: 500,
      week_remaining: 4500,
      window_cycle_end: "2026-09-10T18:00:00Z",
      week_cycle_end: "2026-09-15T00:00:00Z",
      plan: {
        plan_key: "pro",
        name: "Pro",
        monthly_credits: 10000,
        window_hours: 5,
        window_credits: 1000,
        week_credits: 5000,
        ...suaGoi,
      },
      ...sua,
    },
  });
}

const cuaTen = (tb: ReturnType<typeof docThueBao>) => (tb?.cua ?? []).map((c) => c.ten);

test("đọc được envelope {code,msg,data} và dựng đủ ba cửa", () => {
  const tb = docThueBao(than());
  assert.ok(tb);
  assert.equal(tb.planKey, "pro");
  assert.equal(tb.planTen, "Pro");
  assert.equal(tb.tuiConLai, 8000);
  assert.deepEqual(cuaTen(tb), ["gói tháng", "cửa sổ 5 giờ", "tuần"]);
  assert.deepEqual(
    tb.cua.map((c) => [c.dung, c.tran]),
    [[2000, 10000], [100, 1000], [500, 5000]],
  );
});

test("đọc được cả thân TRẦN (không envelope) — cinapi có ngày bỏ bọc", () => {
  const g = JSON.parse(than()) as { data: unknown };
  const tb = docThueBao(JSON.stringify(g.data));
  assert.equal(tb?.planKey, "pro");
});

test("thiếu plan_key ⇒ null, không dựng ra một gói rỗng", () => {
  assert.equal(docThueBao(JSON.stringify({ data: { status: "active" } })), null);
  assert.equal(docThueBao("khong-phai-json"), null);
  assert.equal(docThueBao("null"), null);
});

test("trần cửa sổ lấy từ dùng+còn lại, KHÔNG lấy số danh nghĩa của gói", () => {
  // Gói khai 1000 nhưng số sống nói 100+400 — số sống thắng (đã trừ mọi lần đặt lại).
  const tb = docThueBao(than({ window_used: 100, window_remaining: 400 }));
  const cs = tb?.cua.find((c) => c.ten.startsWith("cửa sổ"));
  assert.deepEqual([cs?.dung, cs?.tran], [100, 500]);
});

test("thiếu remaining thì mới rơi về số của gói", () => {
  const tb = docThueBao(than({ window_used: 100, window_remaining: undefined }));
  const cs = tb?.cua.find((c) => c.ten.startsWith("cửa sổ"));
  assert.deepEqual([cs?.dung, cs?.tran], [100, 1000]);
});

test("cửa có trần 0 KHÔNG được dựng — gói không bật hạn mức ấy", () => {
  const tb = docThueBao(than({ window_used: 0, window_remaining: 0 }, { window_credits: 0 }));
  assert.ok(!cuaTen(tb).some((t) => t.startsWith("cửa sổ")));
});

test("moc: nhận RFC3339, epoch giây, epoch mili — và từ chối rác", () => {
  assert.equal(moc("2026-09-10T18:00:00Z"), Date.parse("2026-09-10T18:00:00Z"));
  assert.equal(moc(1788_000_000), 1788_000_000_000);
  assert.equal(moc(1788_000_000_000), 1788_000_000_000);
  assert.equal(moc("1788000000"), 1788_000_000_000);
  assert.equal(moc("hom qua"), null);
  assert.equal(moc(null), null);
});

test("cuaChanTruoc lấy cửa DÙNG NHIỀU NHẤT theo tỉ lệ, bỏ cửa không bật", () => {
  const c = (ten: string, dung: number, tran: number): Cua =>
    ({ ten, dung, tran, batDauMs: null, ketThucMs: null });
  assert.equal(cuaChanTruoc([c("a", 1, 10), c("b", 9, 10), c("c", 5, 10)])?.ten, "b");
  assert.equal(cuaChanTruoc([c("tat", 0, 0), c("a", 1, 10)])?.ten, "a");
  assert.equal(cuaChanTruoc([c("tat", 5, 0)]), null);
  assert.equal(cuaChanTruoc([]), null);
  // hoà ⇒ cửa đứng TRƯỚC thắng, để thanh đo không nhảy tên giữa hai lượt
  assert.equal(cuaChanTruoc([c("truoc", 1, 2), c("sau", 5, 10)])?.ten, "truoc");
  assert.equal(phanDung(c("tat", 5, 0)), -1);
});

test("so bằng TỈ LỆ nên hai cửa khác đơn vị vẫn so được", () => {
  // Cửa cục bộ tính bằng token (số to), cửa cinapi bằng tín dụng (số nhỏ). Cửa bó hơn phải thắng
  // dù con số của nó nhỏ hơn hàng nghìn lần.
  const cinapi: Cua = { ten: "cửa sổ 5 giờ", dung: 950, tran: 1000, batDauMs: null, ketThucMs: null };
  const cucBo: Cua = { ten: "trần cục bộ", dung: 20_000, tran: 100_000, batDauMs: null, ketThucMs: null };
  assert.equal(cuaChanTruoc([cinapi, cucBo])?.ten, "cửa sổ 5 giờ");
  assert.equal(cuaChanTruoc([{ ...cinapi, dung: 100 }, cucBo])?.ten, "trần cục bộ");
});

test("HẾT CỬA SỔ LÀ CHỜ, KHÔNG PHẢI MUA — vẫn granted", () => {
  const tb = docThueBao(than({ window_used: 1000, window_remaining: 0 }));
  const o = oCamTuThueBao(tb);
  assert.equal(o.access, "granted");
  assert.match(o.usage?.message ?? "", /cửa sổ 5 giờ/);
});

test("túi gói cạn ⇒ payment_required", () => {
  assert.equal(oCamTuThueBao(docThueBao(than({ credits_remaining: 0 }))).access, "payment_required");
});

test("thuê bao hết hiệu lực ⇒ payment_required; trạng thái LẠ thì CHO QUA", () => {
  assert.equal(oCamTuThueBao(docThueBao(than({ status: "canceled" }))).access, "payment_required");
  assert.equal(oCamTuThueBao(docThueBao(than({ status: "EXPIRED" }))).access, "payment_required");
  // Chặn người đang trả tiền vì một enum mình chưa đọc là cái sai nặng hơn.
  assert.equal(oCamTuThueBao(docThueBao(than({ status: "dang_thu_nghiem_moi" }))).access, "granted");
  assert.equal(oCamTuThueBao(docThueBao(than({ status: "" }))).access, "granted");
  assert.equal(conHieuLuc("Active"), true);
});

test("credits_remaining VẮNG khác với bằng 0", () => {
  const tb = docThueBao(than({ credits_remaining: undefined }));
  assert.equal(tb?.tuiConLai, null);
  assert.equal(oCamTuThueBao(tb).access, "granted");
});

test("nhãn nói ĐANG VẼ CỬA NÀO và bao giờ đặt lại", () => {
  const now = Date.parse("2026-09-10T12:00:00Z");
  const o = oCamTuThueBao(docThueBao(than({ window_used: 900, window_remaining: 100 })), { now });
  assert.match(o.usage?.message ?? "", /cửa sổ 5 giờ/);
  assert.match(o.usage?.message ?? "", /đặt lại/);
  assert.equal(o.usage?.cycleEndMs, Date.parse("2026-09-10T18:00:00Z"));
  assert.equal(o.plan, "Pro");
});

test("mốc đã qua thì KHÔNG hứa một lần đặt lại trong quá khứ", () => {
  const now = Date.parse("2026-09-11T00:00:00Z");   // sau window_cycle_end
  const o = oCamTuThueBao(docThueBao(than({ window_used: 900, window_remaining: 100 })), { now });
  assert.doesNotMatch(o.usage?.message ?? "", /đặt lại/);
});

test("không có thuê bao ⇒ chỉ còn cửa cục bộ, plan để trống", () => {
  const cucBo: Cua = { ten: "trần cục bộ", dung: 30, tran: 100, batDauMs: 1, ketThucMs: 2 };
  const o = oCamTuThueBao(null, { cucBo });
  assert.equal(o.access, "granted");
  assert.equal(o.plan, undefined);
  assert.deepEqual([o.usage?.used, o.usage?.limit], [30, 100]);
});

test("không thuê bao và không cửa cục bộ ⇒ usage null, app không vẽ thanh nào", () => {
  const o = oCamTuThueBao(null);
  assert.equal(o.usage, null);
  assert.equal(o.plan, undefined);
});

test("cửa cục bộ thắng thì nhãn nói đúng tên nó, không đội lốt cinapi", () => {
  const cucBo: Cua = { ten: "trần cục bộ", dung: 99, tran: 100, batDauMs: null, ketThucMs: null };
  const o = oCamTuThueBao(docThueBao(than()), { cucBo });
  assert.match(o.usage?.message ?? "", /trần cục bộ/);
});

/**
 * Thân THẬT của gói `free`, chép nguyên hình dạng đo được trên sản xuất 10/09 ngay sau khi cửa dịch
 * vụ lên (giá trị nhận dạng không có trong DTO này). Bài đo trước đó dùng thân tôi tự dựng theo trí
 * nhớ, và nó lồng THIẾU một tầng — nên bộ đọc xanh 18/18 mà vẫn trả `null` với thân thật.
 */
const THAN_THAT = JSON.stringify({
  code: 0,
  msg: "ok",
  data: {
    subscription: {
      plan_key: "free",
      status: "ACTIVE",
      period_start: "2026-09-06T22:28:19.768163Z",
      period_end: "2026-10-06T22:28:19.768163Z",
      credits_remaining: 100,
      next_plan_key: null,
      cancel_at_period_end: false,
      window_used: 0, window_remaining: 0, window_cycle_end: null, window_reset_at: null,
      window_resets_used: 0, window_resets_left: 0,
      week_used: 0, week_remaining: 0, week_cycle_end: null,
      cycle_requests: 0, cycle_tokens: 0, cycle_credits_spent: 0, cycle_usd: 0,
      plan: {
        plan_key: "free", name: "Free", price_usd: 0, monthly_credits: 100,
        credits_per_usd: 0, est_conversations: 15, window_hours: 5,
        window_credits: 0, week_credits: 0, window_resets_per_month: 0,
        rpm_limit: 30, model_scope: ["*"], benefit_end_date: null, sort_order: 0,
      },
    },
  },
});

test("THÂN THẬT: đọc được qua tầng data.subscription", () => {
  const tb = docThueBao(THAN_THAT);
  assert.ok(tb, "bộ đọc trả null với thân thật — nó đang tìm sai tầng");
  assert.equal(tb.planKey, "free");
  assert.equal(tb.planTen, "Free");
  assert.equal(tb.trangThai, "ACTIVE");
  assert.equal(tb.tuiConLai, 100);
});

test("THÂN THẬT gói free: đúng MỘT cửa, vì window/week đều có trần 0", () => {
  const tb = docThueBao(THAN_THAT);
  assert.deepEqual((tb?.cua ?? []).map((c) => c.ten), ["gói tháng"]);
  const o = oCamTuThueBao(tb, { now: Date.parse("2026-09-10T00:00:00Z") });
  assert.equal(o.access, "granted");
  assert.equal(o.plan, "Free");
  assert.deepEqual([o.usage?.used, o.usage?.limit], [0, 100]);
  assert.equal(o.usage?.cycleEndMs, Date.parse("2026-10-06T22:28:19.768163Z"));
  assert.match(o.usage?.message ?? "", /gói tháng/);
});

test("THÂN THẬT: *_cycle_end là null thì KHÔNG bịa ra mốc đặt lại", () => {
  const tb = docThueBao(THAN_THAT);
  assert.equal(tb?.cua.every((c) => c.ten !== "tuần"), true);
  assert.equal(moc(null), null);
});
