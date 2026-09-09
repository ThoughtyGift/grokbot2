/**
 * E2E cửa đăng nhập cinai bằng TRÌNH DUYỆT THẬT — thứ `curl` và bài unit không với tới được.
 *
 * Vì sao cần: lỗ chiếm tài khoản của Bước 3 dựa trên MỘT tiền đề của trình duyệt —
 * cookie `cinapi_at` của cinapi là `SameSite=Lax`, nên một điều hướng GET **chéo site**
 * (nạn nhân bấm link kẻ tấn công gửi) VẪN mang cookie đi. `curl` không có khái niệm
 * SameSite nên nó không chứng minh được cả tiền đề lẫn hàng rào. Ở đây:
 *
 *   • hai SITE thật: `cinai.test` và `ke-la.test` (`--host-resolver-rules`), nên phép
 *     tính same-site của Chrome là phép tính thật, không phải mô phỏng;
 *   • một máy chủ đóng vai NGINX + cinAPI: nó tự trả `/api/v1/me` và `/vi/login`, còn
 *     mọi đường khác thì chuyển tiếp sang backend — đúng hình `proxy_pass` trên VPS;
 *   • JS của trang chờ chạy thật (vòng hỏi 2 s), và cú bấm là `Input.dispatchMouseEvent`
 *     qua Playwright, tức sự kiện TRUSTED (§7: `el.click()` không đi qua).
 *
 * Backend chạy kho CÁCH LY (§7 "bộ test xoá kho thật") và `GROKBOT2_AUTH=enforce` — vì
 * `/auth/poll` chỉ thật sự kiểm `claimLogin` ở mức ấy; `warn`/`off` cấp token vô điều
 * kiện nên đo ở đó là đo một cửa đang mở.
 *
 * 0 lượt model. Không chạm sản xuất. Không chạm `.data` thật.
 */
import { createServer } from "node:http";
import { request as httpRequest } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const CHROME = process.env.CHROME_EXE ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const HERE = dirname(fileURLToPath(import.meta.url));
const BE_DIR = join(HERE, "..");
const GOC_REPO = join(HERE, "..", "..", "..");
const TSX = join(GOC_REPO, "node_modules", ".bin", process.platform === "win32" ? "tsx.CMD" : "tsx");

/** Danh tính cinai giả — id KHÔNG có `|` (bị `docDanhTinh` từ chối) và không phải id thật của ai. */
const CINAI_ID = "e2e-cinai-0000000000000001";
const CINAI_MAIL = "nguoi-e2e@vi.du";
const TOKEN_TOT = "tok-" + randomBytes(12).toString("hex");

const sl = (ms) => new Promise((r) => setTimeout(r, ms));
const bam64 = (v) => createHash("sha256").update(v).digest("base64url");

let mocOk = 0, mocXau = 0;
function moc(ten, dat, ghi = "") {
  if (dat) { mocOk++; console.log(`  v  ${ten}${ghi ? " — " + ghi : ""}`); }
  else { mocXau++; console.log(`  X  ${ten}${ghi ? " — " + ghi : ""}`); }
}

// ── một cổng còn trống ────────────────────────────────────────────────────────
function congTrong() {
  return new Promise((ok) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => ok(p)); });
  });
}

// ── gọi HTTP từ NODE (không qua trình duyệt) ─────────────────────────────────
function goi(port, duong, { method = "GET", headers = {} } = {}) {
  return new Promise((ok, no) => {
    const r = httpRequest({ host: "127.0.0.1", port, path: duong, method, headers }, (res) => {
      let b = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (b += c));
      res.on("end", () => ok({ ma: res.statusCode, than: b, headers: res.headers }));
    });
    r.on("error", no);
    r.end();
  });
}

/**
 * Máy chủ đóng vai **nginx + cinAPI** trên `cinai.test`.
 *
 * Nó phải là MỘT máy chủ chứ không phải hai: trên sản xuất `cinai.app` phát cả trang
 * cinapi lẫn `/agent/*` của grokbot2, và chính chuyện "cùng một site" là điều kiện làm
 * cách (C) chạy được (cookie `Path=/` tự tới backend). Tách ra hai host là đo một
 * topology khác.
 */
function moCinaiTest(portBe) {
  let soMe = 0;                       // backend đã hỏi "cookie này là ai" bao nhiêu lần
  const sv = createServer((req, res) => {
    const u = new URL(req.url, "http://cinai.test");

    // ── cinAPI: /api/v1/me ────────────────────────────────────────────────────
    if (u.pathname === "/api/v1/me") {
      soMe++;
      const ck = String(req.headers.cookie ?? "");
      const co = ck.split(/;\s*/).some((p) => p === `cinapi_at=${TOKEN_TOT}`);
      if (!co) {
        res.writeHead(401, { "content-type": "application/json" });
        return res.end(JSON.stringify({ code: 401, msg: "unauthorized", data: null }));
      }
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ code: 0, msg: "ok", data: { user: { id: CINAI_ID, email: CINAI_MAIL } } }));
    }

    // ── cinAPI: trang đăng nhập, có một nút THẬT để bấm ──────────────────────
    if (u.pathname === "/vi/login") {
      const next = u.searchParams.get("next") ?? "/";
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(`<!doctype html><meta charset="utf-8"><title>cinai login (giả)</title>
<body style="font:16px system-ui;padding:3rem">
<h1>Đăng nhập cinai (giả)</h1>
<a id="dn" href="/dat-cookie?next=${encodeURIComponent(next)}"
   style="display:inline-block;font:inherit;padding:.8em 1.4em;background:#111;color:#fff;text-decoration:none"
   >Continue with Google</a></body>`);
    }

    // ── cinAPI: phát cookie ĐÚNG như `writeCookie` của họ: Path=/ + Lax ──────
    if (u.pathname === "/dat-cookie") {
      const next = u.searchParams.get("next") || "/";
      res.writeHead(302, {
        location: next,
        "set-cookie": `cinapi_at=${TOKEN_TOT}; Path=/; HttpOnly; SameSite=Lax`,
      });
      return res.end();
    }

    // ── nginx: mọi đường còn lại → backend grokbot2 ──────────────────────────
    const h = { ...req.headers, host: `127.0.0.1:${portBe}` };
    delete h["accept-encoding"];                       // khỏi phải giải nén khi chuyển tiếp
    const up = httpRequest({ host: "127.0.0.1", port: portBe, path: req.url, method: req.method, headers: h }, (ur) => {
      const ra = { ...ur.headers };
      delete ra["transfer-encoding"];
      const cuc = [];
      ur.on("data", (c) => cuc.push(c));
      ur.on("end", () => {
        const b = Buffer.concat(cuc);
        ra["content-length"] = String(b.length);
        res.writeHead(ur.statusCode, ra);
        res.end(b);
      });
    });
    up.on("error", () => { res.writeHead(502); res.end("proxy loi"); });
    req.pipe(up);
  });
  return new Promise((ok) => sv.listen(0, "127.0.0.1", () => ok({ sv, port: sv.address().port, soMe: () => soMe })));
}

/** Site của KẺ TẤN CÔNG — chỉ một cái link. Đúng thứ nạn nhân bấm trong email/chat. */
function moKeLa(link) {
  const sv = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><meta charset="utf-8"><title>trang la</title>
<body style="font:16px system-ui;padding:3rem"><h1>Nhận quà</h1>
<p><a id="bay" href="${link}" style="font-size:1.2rem">Bấm vào đây để nhận</a></p></body>`);
  });
  return new Promise((ok) => sv.listen(0, "127.0.0.1", () => ok({ sv, port: sv.address().port })));
}

// ── chạy ──────────────────────────────────────────────────────────────────────
const tam = mkdtempSync(join(tmpdir(), "e2e-cinai-"));
let be = null, cinai = null, kela = null, br = null;

async function dep() {
  if (br) await br.close().catch(() => {});
  if (be?.pid) {
    // §7: hạ CẢ CÂY — `tsx.CMD` là một vỏ, `be.kill()` chỉ hạ vỏ và để lại con giữ cổng.
    // spawnSync, KHÔNG spawn: `process.exit` ngay sau đó giết bài đo trước khi taskkill kịp chạy
    // — đo 09/09: để lại cả cây `cmd → tsx → node → node` mồ côi, giữ cả cổng lẫn kho tạm.
    try { spawnSync("taskkill", ["/PID", String(be.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* thôi */ }
  }
  cinai?.sv.close(); kela?.sv.close();
  await sl(400);
  try { rmSync(tam, { recursive: true, force: true }); } catch { /* thôi */ }
}

try {
  const portBe = await congTrong();
  cinai = await moCinaiTest(portBe);

  // Backend: kho cách ly, enforce, và trỏ cinapi vào máy chủ giả qua LOOPBACK (đúng
  // như sản xuất trỏ `http://127.0.0.1:8080`) — Node không đọc host-resolver-rules của Chrome.
  const env = {
    ...process.env,
    GROKBOT2_PORT: String(portBe),
    GROKBOT2_BIND: "127.0.0.1",
    GROKBOT2_AUTH: "enforce",
    GROKBOT2_BILLING: "off",
    GROKBOT2_CINAPI_BASE: `http://127.0.0.1:${cinai.port}`,
    GROKBOT2_STATE_FILE: join(tam, "state.json"),
    GROKBOT2_DATA_DIR: join(tam, "data"),
    GROKBOT2_WORKFLOWS_FILE: join(tam, "workflows.json"),
    GROKBOT2_SQLITE_FILE: join(tam, "g.sqlite"),
    GROKBOT2_MAY_DA_BIET_FILE: join(tam, "may.json"),
  };
  delete env.GROKBOT2_PUBLIC_PATH;   // gốc "" ⇒ cookie không `Secure` ⇒ đo được trên http
  console.log(`cinai.test → 127.0.0.1:${cinai.port} · backend 127.0.0.1:${portBe} · kho ${tam}`);

  // Node 22 từ chối spawn `.CMD` trần (bản vá CVE-2024-27980) và `shell:true` thì mất dấu
  // gốc cây; gọi qua `cmd.exe` được cả hai: hợp lệ, và có đúng một pid để `taskkill /T`.
  const vao = process.env.E2E_VAO ?? "src/index.ts";
  be = process.platform === "win32"
    ? spawn("cmd.exe", ["/c", TSX, vao], { cwd: BE_DIR, env, stdio: ["ignore", "pipe", "pipe"] })
    : spawn(TSX, [vao], { cwd: BE_DIR, env, stdio: ["ignore", "pipe", "pipe"] });
  be.stdout.setEncoding("utf8"); be.stderr.setEncoding("utf8");
  let log = "";
  be.stdout.on("data", (d) => { log += d; });
  be.stderr.on("data", (d) => { log += d; });

  let len = false;
  for (let i = 0; i < 90 && !len; i++) {
    await sl(1000);
    try { len = (await goi(portBe, "/gw/health")).ma > 0; } catch { /* chưa lên */ }
  }
  if (!len) { console.error("backend không lên:\n" + log.slice(-2000)); await dep(); process.exit(1); }
  console.log("backend lên.\n");

  // Cặp PKCE của NGƯỜI DÙNG (U1) và của KẺ TẤN CÔNG (U2) — đúng phép client dùng.
  const V1 = randomBytes(32).toString("base64url"), U1 = randomUUID(), C1 = bam64(V1);
  const V2 = randomBytes(32).toString("base64url"), U2 = randomUUID(), C2 = bam64(V2);
  const linkBay = `http://cinai.test/loginDeepControl?uuid=${U2}&challenge=${encodeURIComponent(C2)}`;
  kela = await moKeLa(linkBay);

  const poll = async (u, v) => (await goi(portBe, `/auth/poll?uuid=${u}&verifier=${encodeURIComponent(v)}`)).ma;

  br = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      `--host-resolver-rules=MAP cinai.test 127.0.0.1:${cinai.port},MAP ke-la.test 127.0.0.1:${kela.port}`,
      "--no-proxy-server",
    ],
  });
  const ctx = await br.newContext();

  // ── MỐC 1 · trang chờ vẽ, cookie buộc phiên đúng thuộc tính, chưa ai được duyệt ──
  const t1 = await ctx.newPage();
  const r1 = await t1.goto(`http://cinai.test/loginDeepControl?uuid=${U1}&challenge=${encodeURIComponent(C1)}`);
  const chuaDn = await t1.evaluate(() => ({
    cho: !document.getElementById("cho").hidden,
    xac: document.getElementById("xac").hidden,
    dau: document.querySelector("h1")?.textContent ?? "",
  }));
  const ck1 = (await ctx.cookies()).find((c) => c.name === "gb2_login");
  moc("1 · trang chờ 200 + khối 'đang chờ', chưa hiện nút nối",
    r1.status() === 200 && chuaDn.cho && chuaDn.xac && /cinai/i.test(chuaDn.dau),
    `ma=${r1.status()} cho=${chuaDn.cho} xac_an=${chuaDn.xac}`);
  moc("1b · gb2_login=uuid · HttpOnly · SameSite=Strict · 900 s",
    !!ck1 && ck1.value === U1 && ck1.httpOnly === true && ck1.sameSite === "Strict",
    ck1 ? `khop_uuid=${ck1.value === U1} httpOnly=${ck1.httpOnly} sameSite=${ck1.sameSite}` : "VẮNG cookie");
  moc("1c · /auth/poll của người dùng CHƯA cấp gì", (await poll(U1, V1)) === 404);

  // ── MỐC 2 · không có giấy cinai thì backend không hỏi cinapi ─────────────────
  await sl(2500);                                     // để vòng hỏi chạy vài nhịp
  moc("2 · chưa đăng nhập cinai ⇒ 0 lượt backend hỏi /api/v1/me", cinai.soMe() === 0, `soMe=${cinai.soMe()}`);

  // ── MỐC 3 · đăng nhập cinai bằng cú bấm THẬT, cookie Lax như của họ ─────────
  const t2 = await ctx.newPage();
  await t2.goto(`http://cinai.test/vi/login?next=${encodeURIComponent("/loginDeepControl?uuid=" + U1 + "&challenge=" + C1)}`);
  const b = await t2.locator("#dn").boundingBox();
  await t2.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await t2.mouse.down(); await sl(60); await t2.mouse.up();
  await t2.waitForLoadState("load").catch(() => {});
  const ck2 = (await ctx.cookies()).find((c) => c.name === "cinapi_at");
  moc("3 · cookie cinapi_at có mặt, Path=/ và SameSite=Lax (tiền đề của lỗ)",
    !!ck2 && ck2.path === "/" && ck2.sameSite === "Lax",
    ck2 ? `path=${ck2.path} sameSite=${ck2.sameSite}` : "VẮNG cookie");

  // ── MỐC 4 · GET (vòng hỏi của trang) BÁO đúng người mà KHÔNG duyệt ──────────
  let thay = null;
  for (let i = 0; i < 12 && !thay; i++) {
    await sl(1000);
    const s = await t1.evaluate(() => ({ xac: !document.getElementById("xac").hidden, mail: document.getElementById("mail").textContent }));
    if (s.xac) thay = s;
  }
  moc("4 · trang tự nhận ra tài khoản qua vòng hỏi GET", !!thay && thay.mail === CINAI_MAIL,
    thay ? `email=${thay.mail}` : "trang không chuyển sang khối xác nhận");
  moc("4b · backend ĐÃ hỏi cinapi", cinai.soMe() > 0, `soMe=${cinai.soMe()}`);
  moc("4c · …mà /auth/poll VẪN chưa cấp — GET không duyệt", (await poll(U1, V1)) === 404);

  // ── MỐC 5 · KỊCH BẢN TẤN CÔNG: nạn nhân bấm link chéo site của kẻ khác ─────
  const meTruoc = cinai.soMe();
  const t3 = await ctx.newPage();
  await t3.goto("http://ke-la.test/");
  const bb = await t3.locator("#bay").boundingBox();
  await t3.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await t3.mouse.down(); await sl(60); await t3.mouse.up();
  await t3.waitForLoadState("load").catch(() => {});
  let bayThay = null;
  for (let i = 0; i < 10 && !bayThay; i++) {
    await sl(1000);
    const s = await t3.evaluate(() => ({
      url: location.href,
      xac: !document.getElementById("xac")?.hidden,
      mail: document.getElementById("mail")?.textContent ?? "",
    })).catch(() => null);
    if (s?.xac) bayThay = s;
  }
  moc("5 · TIỀN ĐỀ: điều hướng CHÉO SITE vẫn mang cookie cinai (SameSite=Lax)",
    !!bayThay && bayThay.mail === CINAI_MAIL && cinai.soMe() > meTruoc,
    bayThay ? `trang của kẻ tấn công nhận ra ${bayThay.mail}, soMe ${meTruoc}→${cinai.soMe()}` : "trang bẫy không nhận ra ai");
  await sl(6000);                                      // 3 nhịp hỏi vòng nữa
  moc("5b · CỬA ĐÓNG: app của kẻ tấn công vẫn KHÔNG nhận token", (await poll(U2, V2)) === 404,
    "nạn nhân đã bấm link, trang đã biết họ là ai, phiên vẫn chờ");

  // ── MỐC 6 · một cookie buộc phiên cho CẢ SITE ⇒ link kẻ tấn công ĐÈ mất của nạn nhân ─
  //
  // Chỗ này không ai thiết kế ra, nó là hệ quả: `gb2_login` cùng tên, cùng path, cùng site,
  // nên tab mở sau ghi đè tab mở trước. Hậu quả đúng chiều AN TOÀN (làm chính người dùng
  // bị từ chối, không phải mở thêm cửa cho ai), nhưng phải đo để biết nó có thật.
  const ckSau = (await ctx.cookies()).find((c) => c.name === "gb2_login");
  moc("6 · gb2_login của nạn nhân bị link kẻ tấn công ghi đè",
    !!ckSau && ckSau.value === U2,
    ckSau ? `gb2_login = ${ckSau.value === U2 ? "uuid CỦA KẺ TẤN CÔNG" : ckSau.value === U1 ? "uuid của người dùng" : "?"}` : "VẮNG");

  // ── MỐC 7 · POST CHÉO SITE thật — tab mới, còn đứng trên `ke-la.test` ─────────
  //
  // Lượt trước tôi gọi fetch từ `t3` — nhưng `t3` đã điều hướng sang `cinai.test` ở mốc 5,
  // nên "chéo site" hoá CÙNG GỐC và mốc đó xanh vì lý do sai (§7).
  const t4 = await ctx.newPage();
  await t4.goto("http://ke-la.test/");
  const cheo = await t4.evaluate(async (u) => {
    try { const r = await fetch(u, { method: "POST", credentials: "include", mode: "cors" }); return { ma: r.status }; }
    catch (e) { return { chan: String(e).slice(0, 70) }; }
  }, `http://cinai.test/auth/cinai?uuid=${U2}`);
  moc("7 · POST chéo site không duyệt được gì", (await poll(U2, V2)) === 404,
    cheo.chan ? `trình duyệt chặn: ${cheo.chan}` : `ma=${cheo.ma}`);

  // ── MỐC 8 · nạn nhân quay lại tab của mình: cookie đã lệch ⇒ chính họ bị 403 ──
  const lech = await t1.evaluate(async (u) => (await fetch(u, { method: "POST", credentials: "same-origin" })).status,
    `/auth/cinai?uuid=${U1}`);
  moc("8 · cookie bị đè ⇒ cú bấm của chính người dùng cũng bị từ chối", lech === 403, `ma=${lech}`);

  // Họ bấm đăng nhập lại trong app — tức mở lại deep link của CHÍNH MÌNH.
  await t1.goto(`http://cinai.test/loginDeepControl?uuid=${U1}&challenge=${encodeURIComponent(C1)}`);
  let lai = false;
  for (let i = 0; i < 12 && !lai; i++) { await sl(1000); lai = await t1.evaluate(() => !document.getElementById("xac").hidden); }
  moc("8b · mở lại deep link của mình ⇒ trang lại nhận ra tài khoản", lai);
  const lech2 = await t1.evaluate(async (u) => (await fetch(u, { method: "POST", credentials: "same-origin" })).status,
    `/auth/cinai?uuid=${U2}`);
  moc("8c · POST cùng gốc mà uuid lệch cookie → 403", lech2 === 403 && (await poll(U2, V2)) === 404, `ma=${lech2}`);

  // ── MỐC 9 · cú bấm THẬT của người dùng mới mở cửa ──────────────────
  const nb = await t1.locator("#ok").boundingBox();
  await t1.mouse.move(nb.x + nb.width / 2, nb.y + nb.height / 2);
  await t1.mouse.down(); await sl(60); await t1.mouse.up();
  let xong = false;
  for (let i = 0; i < 10 && !xong; i++) {
    await sl(600);
    xong = await t1.evaluate(() => !document.getElementById("xong").hidden);
  }
  const sau = await goi(portBe, `/auth/poll?uuid=${U1}&verifier=${encodeURIComponent(V1)}`);
  let ai = "";
  try { ai = JSON.parse(sau.than).authId ?? ""; } catch { /* thân lạ */ }
  moc("9 · bấm 'Nối tài khoản này' → trang báo xong", xong);
  moc("9b · /auth/poll cấp token, danh tính là cinapi|<id>",
    sau.ma === 200 && ai === `cinapi|${CINAI_ID}`, `ma=${sau.ma} authId=${ai || "(vắng)"}`);

  // ── MỐC 9 · mã đăng nhập dùng một lần ──────────────────────────────────────
  moc("10 · poll lần hai cùng uuid → không cấp lại", (await poll(U1, V1)) === 404);

  console.log(`\n${mocXau === 0 ? "XANH" : "ĐỎ"} — ${mocOk} đạt · ${mocXau} sai`);
  await dep();
  process.exit(mocXau === 0 ? 0 : 1);
} catch (e) {
  console.error("\nbài đo ngã:", e?.stack ?? e);
  await dep();
  process.exit(2);
}
