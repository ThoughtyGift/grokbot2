/**
 * Vé cổng theo người — chỗ hai tài khoản đã thật sự dùng chung dữ liệu.
 *
 * Mỗi khẳng định dưới đây là một cách lỗ rò quay lại mà không ai thấy: vé không mang danh tính,
 * vé của người khác bịa được, hay vé cũ bị từ chối làm chết app đang chạy.
 *
 *   npx tsx --test src/gateway-ticket.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const BI_MAT = "gw-bi-mat-de-thu-1234567890abcdef";
process.env.GROKBOT2_GATEWAY_TOKEN = BI_MAT;

const { mintTicket, ownerOfTicket, looksLikeUserTicket } = await import("./gateway-ticket.js");

test("vé đọc ngược ra đúng chủ", () => {
  for (const ai of ["auth0|grokbot2-user", "local|ngoclongdz96@gmail.com", "local|có-dấu@ví-dụ.vn"]) {
    assert.equal(ownerOfTicket(mintTicket(ai)), ai, ai);
  }
});

test("hai người hai vé khác nhau", () => {
  // Nếu hai vé bằng nhau thì `/gw` không phân biệt được ai với ai — đúng tình trạng cũ.
  assert.notEqual(mintTicket("local|a@x.vn"), mintTicket("local|b@x.vn"));
});

test("đổi chủ mà giữ chữ ký cũ thì vé chết", () => {
  const ve = mintTicket("local|a@x.vn");
  const chuKy = ve.split(".")[2];
  const b64u = (s: string) => Buffer.from(s, "utf8").toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const gia = `gwu.${b64u("local|nan-nhan@x.vn")}.${chuKy}`;
  assert.equal(ownerOfTicket(gia), null, "phai tu choi ve tu bia");
});

test("sửa một ký tự trong chữ ký là hỏng", () => {
  const ve = mintTicket("local|a@x.vn");
  const [p, id, sig] = ve.split(".");
  const doi = sig[0] === "A" ? "B" : "A";
  assert.equal(ownerOfTicket(`${p}.${id}.${doi}${sig.slice(1)}`), null);
});

test("vé ký bằng bí mật KHÁC không dùng được", () => {
  const ve = mintTicket("local|a@x.vn");
  process.env.GROKBOT2_GATEWAY_TOKEN = "mot-bi-mat-hoan-toan-khac-0987654321";
  try {
    assert.equal(ownerOfTicket(ve), null, "xoay bi mat phai vo hieu hoa ve cu");
  } finally {
    process.env.GROKBOT2_GATEWAY_TOKEN = BI_MAT;
  }
});

test("vé dùng chung cũ KHÔNG bị nhận nhầm là vé của ai đó", () => {
  // App đang chạy còn cầm vé cũ trong bản mô tả box đã cache. Nó phải rơi về danh tính mặc định
  // (đường `ownerFromAuth` xử lý), chứ tuyệt đối không được đọc ra một chủ nhân nào.
  assert.equal(ownerOfTicket(BI_MAT), null);
  assert.equal(looksLikeUserTicket(BI_MAT), false);
});

test("rác không làm nổ hàm đọc vé", () => {
  for (const rac of ["", "gwu.", "gwu.a", "gwu.a.b.c", "gwu.!!!.???", "Bearer x", "gwu..x"]) {
    assert.equal(ownerOfTicket(rac), null, JSON.stringify(rac));
  }
});

test("không có bí mật thì không phát ra vé giả vờ hợp lệ", () => {
  const giu = process.env.GROKBOT2_GATEWAY_TOKEN;
  delete process.env.GROKBOT2_GATEWAY_TOKEN;
  try {
    assert.equal(mintTicket("local|a@x.vn"), "", "khong ky duoc thi tra ve rong, khong phai chuoi vo nghia");
    assert.equal(ownerOfTicket("gwu.abc.def"), null);
  } finally {
    process.env.GROKBOT2_GATEWAY_TOKEN = giu;
  }
});

test("bản mô tả box đóng đúng vé được đưa", async () => {
  const { ensureSandBox } = await import("@grokbot2/proto");
  const ve = mintTicket("local|ngoclongdz96@gmail.com");
  assert.ok(ensureSandBox("http://x", ve).includes(Buffer.from(ve, "utf8")), "ve phai nam trong descriptor");
  // Không đưa vé ⇒ hành vi cũ, để một máy chưa nâng cấp không chết.
  assert.ok(ensureSandBox("http://x").includes(Buffer.from(BI_MAT, "utf8")));
});
