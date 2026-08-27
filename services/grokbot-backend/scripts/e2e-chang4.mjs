/**
 * E2E chặng 4 — backend đã ra Internet, và ra một cách an toàn.
 *
 * Chạy qua **HTTPS thật, từ ngoài vào**, không mock gì. Đây là bài chốt chặng, nên nó phải trả lời
 * được cả ba câu: cửa nào mở, cửa nào đóng, và những gì của người khác trên cùng máy chủ có còn nguyên.
 *
 *   node scripts/e2e-chang4.mjs
 *   node scripts/e2e-chang4.mjs --base https://cinai.app/agent
 *
 * Bài này TẠO một tài khoản để chạy được luồng đăng nhập thiết bị. Đăng ký chỉ mở khi chưa ai có mật
 * khẩu, nên trên một cài đặt đã có người dùng thật thì truyền `--email`/`--password` của tài khoản đó
 * thay vì để nó tự đăng ký.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { recordRun } from "./run-history.mjs";

const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : d;
};

/** Gốc backend nhìn từ Internet, KHÔNG gạch chéo cuối — bài này thử cả hai dạng. */
const BASE = arg("--base", "https://cinai.app/agent").replace(/\/$/, "");
/** Gốc tên miền, để thử những đường client gọi tuyệt đối và để kiểm site của người khác. */
const ROOT = new URL(BASE).origin;

const EMAIL = arg("--email", `e2e-chang4-${Date.now()}@vi.du`);
const PASS = arg("--password", `matkhau-e2e-${randomBytes(4).toString("hex")}`);

const results = [];
const step = (name, pass, detail = "") => {
  results.push({ name, pass, ...(pass ? {} : { detail }) });
  console.log(`  ${pass ? "ĐẬU" : "HỎNG"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const b64u = (b) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
const code = async (url, init) => {
  try { return (await fetch(url, init)).status; } catch (e) { return `LỖI MẠNG: ${e.message}`; }
};
const proto = { method: "POST", headers: { "content-type": "application/proto" }, body: new Uint8Array(5) };

console.log(`\n── E2E chặng 4 · ${BASE} ──\n`);

// ── 4.3 HTTPS, và backend KHÔNG phơi cổng nào ───────────────────────────────────
{
  const c = await code(`${BASE}/v1/health`);
  step("4.3 backend trả lời qua HTTPS", c === 200, `HTTP ${c}`);
  step("4.3 đúng là TLS, không phải HTTP", BASE.startsWith("https://"), BASE);

  /*
   * Cổng 8788 phải KÍN từ ngoài. Backend nghe `127.0.0.1`, nginx là cửa duy nhất — nên gọi thẳng
   * cổng đó từ Internet phải không nối được. Nối được nghĩa là có một cửa thứ hai không ai canh.
   */
  const host = new URL(BASE).hostname;
  const direct = await code(`http://${host}:8788/v1/health`).catch(() => "khong noi duoc");
  step("4.3 cổng 8788 KÍN từ ngoài", typeof direct !== "number",
       typeof direct === "number" ? `gọi thẳng được, HTTP ${direct}` : "không nối được — đúng");
}

// ── 4.6 cửa cấp token phải hỏi giấy tờ ──────────────────────────────────────────
{
  const empty = await code(`${ROOT}/oauth/token`, {
    method: "POST", headers: { "content-type": "application/json" }, body: "{}",
  });
  step("4.6 /oauth/token thân rỗng bị từ chối", empty === 401, `HTTP ${empty}`);

  const forged = `${Buffer.from('{"alg":"HS256"}').toString("base64url")}.`
    + `${Buffer.from('{"sub":"auth0|ai-do"}').toString("base64url")}.chu-ky-bia`;
  const bad = await code(`${ROOT}/oauth/token`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant_type: "refresh_token", refresh_token: forged }),
  });
  step("4.6 refresh_token bịa ra bị từ chối", bad === 401, `HTTP ${bad}`);

  const noTok = await code(`${BASE}/v1/agents`);
  step("4.6 /v1/agents không token là 401", noTok === 401, `HTTP ${noTok}`);
}

// ── luồng đăng nhập thiết bị, đủ vòng ───────────────────────────────────────────
let liveToken = "";
{
  const verifier = b64u(randomBytes(32));
  const challenge = b64u(createHash("sha256").update(verifier).digest());
  const uuid = randomUUID();
  const poll = async (v = verifier) => {
    const r = await fetch(`${ROOT}/auth/poll?uuid=${uuid}&verifier=${encodeURIComponent(v)}`);
    return { code: r.status, body: await r.text() };
  };

  step("hỏi vòng trước khi mở trình duyệt → 404", (await poll()).code === 404);

  const page = await fetch(
    `${ROOT}/loginDeepControl?challenge=${encodeURIComponent(challenge)}&uuid=${uuid}&mode=login&redirectTarget=sand`,
    { redirect: "manual" },
  );
  const loc = page.headers.get("location") ?? "";
  const prefix = new URL(BASE).pathname.replace(/\/$/, "");
  step("/loginDeepControl chuyển hướng MANG THEO nhánh", page.status === 302 && loc.startsWith(`${prefix}/app/`),
       `${page.status} → ${loc}`);

  // Tài khoản: dùng cái được truyền vào, hoặc tự đăng ký nếu đăng ký còn mở.
  const reg = await fetch(`${BASE}/v1/register`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASS }),
  });
  const login = await fetch(`${BASE}/v1/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASS }),
  });
  const lj = await login.json().catch(() => ({}));
  step("đăng nhập bằng email + mật khẩu", login.status === 200 && Boolean(lj.token),
       `đăng ký ${reg.status} · đăng nhập ${login.status} ${lj.error ?? ""}`);

  if (lj.token) {
    /*
     * `/auth/approve` đi dưới NHÁNH, không phải gốc.
     *
     * Bốn cửa client gọi tuyệt đối (`/oauth/token`, `/auth/poll`, `/loginDeepControl`,
     * `/sand/feedback`) phải mở ở gốc vì client tự ghép URL như thế. Nhưng `/auth/approve` là
     * cửa của **trang web của ta**, và trang đó biết nhánh nó đang đứng — nên nó thuộc `/agent/`.
     * Gọi ở gốc thì rơi vào Next.js của cinAPI và trả 404: đúng cái bài này vừa tự vấp.
     */
    const ap = await fetch(`${BASE}/auth/approve`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ uuid, token: lj.token }),
    });
    step("trang duyệt được phiên đang chờ", ap.status === 200, `HTTP ${ap.status}`);

    step("kẻ khác biết uuid mà đoán verifier → 404", (await poll("doan-bua")).code === 404);

    const ok = await poll();
    const got = ok.code === 200 ? JSON.parse(ok.body) : null;
    liveToken = got?.access_token ?? "";
    step("app nhận token, và là ĐÚNG tài khoản vừa đăng nhập",
         ok.code === 200 && String(got?.authId ?? "").includes(EMAIL.split("@")[0]),
         `HTTP ${ok.code} · authId ${got?.authId ?? "?"}`);

    step("một lượt duyệt chỉ đổi được token MỘT lần", (await poll()).code === 404);
  } else {
    step("trang duyệt được phiên đang chờ", false, "không có token để duyệt");
    step("kẻ khác biết uuid mà đoán verifier → 404", false, "bỏ qua");
    step("app nhận token, và là ĐÚNG tài khoản vừa đăng nhập", false, "bỏ qua");
    step("một lượt duyệt chỉ đổi được token MỘT lần", false, "bỏ qua");
  }
}

// ── 4.6 token thật thì làm mới ĐƯỢC — nửa còn lại của bài siết ───────────────────
if (liveToken) {
  const r = await fetch(`${ROOT}/oauth/token`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant_type: "refresh_token", refresh_token: liveToken }),
  });
  const j = await r.json().catch(() => ({}));
  step("4.6 token THẬT thì làm mới được", r.status === 200 && Boolean(j.access_token), `HTTP ${r.status}`);
  const roster = await code(`${BASE}/v1/agents`, { headers: { authorization: `Bearer ${liveToken}` } });
  step("token đó đọc được roster của chính mình", roster === 200, `HTTP ${roster}`);
} else {
  step("4.6 token THẬT thì làm mới được", false, "không lấy được token thật");
  step("token đó đọc được roster của chính mình", false, "bỏ qua");
}

// ── 4.5 giao diện web do backend phát ───────────────────────────────────────────
{
  const html = await fetch(`${BASE}/app/`).then((r) => r.text()).catch(() => "");
  step("4.5 giao diện web phát ở /app/", /<!doctype html/i.test(html), `${html.length} byte`);
  const asset = (html.match(/(?:src|href)="\.?\/?(assets\/[^"]+\.js)"/) ?? [])[1];
  const ac = asset ? await code(`${BASE}/app/${asset}`) : "khong tim thay";
  step("4.5 tài nguyên của giao diện tải được", ac === 200, `${asset ?? "?"} → ${ac}`);
  step("4.5 file thiếu trong bản dựng trả 404, không trả HTML",
       (await code(`${BASE}/app/assets/khong-co-that.js`)) === 404);
}

// ── ghép URL: cả hai dạng base đều phải chạy ─────────────────────────────────────
{
  const withSlash = await code(`${BASE}/aiserver.v1.GrokBotService/EnsureSandBox`, proto);
  const atRoot = await code(`${ROOT}/aiserver.v1.GrokBotService/EnsureSandBox`, proto);
  step("RPC chạy khi base CÓ gạch chéo cuối", withSlash === 200, `HTTP ${withSlash}`);
  // Thiếu một ký tự này từng hiện ra là "Can't reach your computer" trên máy 2 (26/08).
  step("RPC vẫn chạy khi base THIẾU gạch chéo cuối", atRoot === 200, `HTTP ${atRoot}`);
}

// ── không có cửa nào để dò ───────────────────────────────────────────────────────
{
  for (const p of ["/agent/../../../etc/passwd", "/agent/app/%2e%2e/%2e%2e/.env"]) {
    const body = await fetch(`${ROOT}${p}`).then((r) => r.text()).catch(() => "");
    step(`đi ngang không lộ file: ${p}`, !/GROKBOT2_|root:x:/.test(body), body.slice(0, 40));
  }
  const admin = await code(`${BASE}/admin`);
  step("bảng quản trị không mở trần", admin !== 200, `HTTP ${admin}`);
}

// ── 4.2b hàng xóm trên cùng máy chủ phải còn nguyên ─────────────────────────────
{
  const neighbours = [
    ["cinai.app gốc", `${ROOT}/`, [200, 307, 308]],
    ["cinai.app /api/", `${ROOT}/api/`, [200, 401, 404, 404]],
    ["trang tải /tai/", `${ROOT}/tai/`, [200]],
    ["admin.halcion.vn", "https://admin.halcion.vn/", [200]],
    ["foodaymart.vn", "https://foodaymart.vn/", [200, 301]],
  ];
  for (const [name, url, okCodes] of neighbours) {
    const c = await code(url);
    step(`không làm hỏng ${name}`, okCodes.includes(c), `HTTP ${c}`);
  }
}

const pass = results.filter((r) => r.pass).length;
console.log(`\n  ${pass}/${results.length} đậu\n`);
if (EMAIL.startsWith("e2e-chang4-")) {
  console.log(`  Đã tạo tài khoản thử "${EMAIL}" — xoá nó thì đăng ký mở lại cho người đầu tiên.\n`);
}
recordRun("e2e-chang4.mjs", results);
process.exit(pass === results.length ? 0 : 1);
