/**
 * Script chạy TRÊN MÁY NGƯỜI DÙNG để lái Chrome ở đó — nguồn của nó là một chuỗi trong file này.
 *
 * ── Vì sao là một chuỗi, không phải một file ────────────────────────────────────────────────────
 *
 * Daemon local-exec chỉ cho ba việc: `shell`, `read`, `ls`. Không có "ghi file". Nên muốn chạy mã
 * trên máy người dùng thì chỉ còn đường nhét mã vào chính dòng lệnh — và mọi cách nhét thẳng đều
 * chết vì escaping: dấu nháy, `%`, backslash đường dẫn Windows, xuống dòng. Đóng gói base64 rồi
 * `node -e "eval(...)"` là đường duy nhất không phụ thuộc shell nào đang chạy.
 *
 * Máy có Node v22 (đo 31/08), và v22 đã có sẵn `fetch` lẫn `WebSocket` toàn cục — nên script này
 * nói chuyện CDP mà không cần cài gói nào. Đó là lý do nó viết được thành một mẩu tự chứa.
 *
 * ── Vì sao cần nó, khi bot đã chạy được lệnh ───────────────────────────────────────────────────
 *
 * Đo 31/08: bảo bot "mở Chrome vào 24h.com.vn rồi đọc tiêu đề bài đầu", nó MỞ được trang trên máy
 * người dùng nhưng không đọc được cửa sổ đó — nó tự tải trang về đọc rồi thành thật khai ra. Mở
 * một cửa sổ mà không nhìn vào được thì mới là nửa việc: không bấm được nút, không điền được form,
 * không đọc được thứ chỉ hiện ra sau khi đăng nhập.
 *
 * ── Cửa sổ riêng, không mượn cửa sổ đang mở ────────────────────────────────────────────────────
 *
 * Chrome chỉ mở cổng gỡ lỗi khi được khởi động KÈM cờ đó, và một tiến trình Chrome đang chạy sẵn
 * (12 cái, đo được) sẽ không nhận cờ ấy. Nên script tự bật một cửa sổ riêng với `--user-data-dir`
 * riêng.
 *
 * Nghĩa là: KHÔNG có cookie, không có phiên đăng nhập của người dùng. Đấy là cái giá, và cũng là
 * hàng rào — bot không vô tình thao tác trong phiên ngân hàng đang mở. Muốn bot làm việc trong một
 * tài khoản thì người dùng đăng nhập trong chính cửa sổ ấy một lần, và phiên nằm lại trong hồ sơ
 * riêng đó.
 *
 * ── Vì sao đuôi .cjs ───────────────────────────────────────────────────────────────────────────
 *
 * Script dùng `require("node:child_process")` để bật Chrome. Ghi ra `.mjs` thì Node coi là ESM và
 * `require` không tồn tại — lỗi đúng chữ "require is not defined", đã gặp. Đuôi `.cjs` buộc Node
 * đọc nó như CommonJS, và đó là điều kiện để giữ script ở dạng một mẩu tự chứa không cần build.
 */

/**
 * Cổng CDP trên máy người dùng.
 *
 * KHÔNG dùng 9222: đó là cổng `Grok Bot.exe` đang mở cho chính nó, và trùng vào đó thì hai bên
 * giành nhau — triệu chứng sẽ là "bot lái nhầm cửa sổ app". Ghi rõ ở đây để đừng ai dọn nó về mặc
 * định.
 */
export const CONG_CDP = 9333;

/** Hồ sơ Chrome riêng cho bot, tách khỏi hồ sơ thật của người dùng. */
export const HO_SO = "%LOCALAPPDATA%\\grokbot2-chrome";

/**
 * Nguồn script, dạng chuỗi. Nhận một lệnh JSON qua `process.argv[1]` (base64) và in JSON ra stdout.
 *
 * Viết bằng JS thuần, không import gì: nó chạy qua `node -e`, nơi không có module resolution nào
 * ngoài lõi Node.
 */
export const NGUON_SCRIPT = String.raw`
const CONG = __CONG__;
// Đối số CUỐI, không phải argv[1]: chạy bằng \`node -e\` thì tham số là argv[1], còn chạy bằng
// \`node <file>\` thì argv[1] là đường dẫn script và tham số lùi xuống argv[2]. Script này đi cả hai
// đường (bản đầu nhét thẳng vào -e, bản sau chở thành file), và bản sau đã nhận nguyên một đường
// dẫn Windows rồi đem base64-decode nó — ra rác, rồi JSON.parse ném.
const lenh = JSON.parse(Buffer.from(process.argv[process.argv.length - 1] || "", "base64").toString("utf8"));
const nghi = (ms) => new Promise((r) => setTimeout(r, ms));
const ra = (o) => { process.stdout.write("GB2JSON" + JSON.stringify(o)); process.exit(0); };

const cdp = async (duong) => {
  const r = await fetch("http://127.0.0.1:" + CONG + duong, { signal: AbortSignal.timeout(4000) });
  return r.json();
};

/** Chrome đã mở cổng gỡ lỗi chưa. */
const song = async () => { try { await cdp("/json/version"); return true; } catch { return false; } };

/** Bật một cửa sổ Chrome riêng có cổng gỡ lỗi, rồi chờ nó lên. */
const bat = async () => {
  const { spawn } = require("node:child_process");
  const path = require("node:path");
  const fs = require("node:fs");
  const ung = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe"),
  ];
  const exe = ung.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
  if (!exe) return { ok: false, loi: "không tìm thấy chrome.exe trên máy này" };
  const hoSo = path.join(process.env.LOCALAPPDATA || process.env.TEMP || ".", "grokbot2-chrome");
  const con = spawn(exe, [
    "--remote-debugging-port=" + CONG,
    "--user-data-dir=" + hoSo,
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-allow-origins=*",
    "about:blank",
  ], { detached: true, stdio: "ignore" });
  con.unref();
  for (let i = 0; i < 40; i++) { await nghi(500); if (await song()) return { ok: true, hoSo }; }
  return { ok: false, loi: "Chrome bật rồi nhưng cổng " + CONG + " không lên sau 20 giây" };
};

/** Tab đang dùng — tab thường đầu tiên, hoặc mở mới nếu chưa có. */
const tab = async () => {
  const ds = await cdp("/json/list");
  const t = ds.find((x) => x.type === "page" && !String(x.url).startsWith("devtools://"));
  if (t) return t;
  await cdp("/json/new?about:blank");
  await nghi(600);
  return (await cdp("/json/list")).find((x) => x.type === "page");
};

/** Một phiên CDP trên tab, đóng lại khi xong. */
const phien = async (t) => {
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("không mở được websocket CDP")); });
  let n = 0; const cho = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); const f = cho.get(m.id); if (f) { cho.delete(m.id); f(m); } };
  const goi = (method, params = {}) => new Promise((res) => { const id = ++n; cho.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  return { goi, dong: () => { try { ws.close(); } catch {} } };
};

const danhGia = async (p, bieuThuc) => {
  const r = await p.goi("Runtime.evaluate", { expression: bieuThuc, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) return { loi: JSON.stringify(r.result.exceptionDetails).slice(0, 300) };
  return { gia: r.result && r.result.result ? r.result.result.value : undefined };
};

(async () => {
  try {
    if (!(await song())) {
      const b = await bat();
      if (!b.ok) return ra({ ok: false, loi: b.loi });
    }
    const t = await tab();
    if (!t) return ra({ ok: false, loi: "không có tab nào để lái" });
    const p = await phien(t);
    try {
      const v = lenh.viec;

      if (v === "mo") {
        await p.goi("Page.enable", {});
        await p.goi("Page.navigate", { url: lenh.url });
        // Chờ trang đứng yên: đủ để DOM có nội dung, không chờ mọi ảnh.
        for (let i = 0; i < 30; i++) {
          await nghi(400);
          const s = await danhGia(p, "document.readyState");
          if (s.gia === "complete" || s.gia === "interactive") break;
        }
        await nghi(700);
        const tieuDe = await danhGia(p, "document.title");
        return ra({ ok: true, url: lenh.url, tieuDe: tieuDe.gia });
      }

      if (v === "doc") {
        const gioiHan = Number(lenh.gioiHan) || 6000;
        const r = await danhGia(p, "document.body ? document.body.innerText : ''");
        if (r.loi) return ra({ ok: false, loi: r.loi });
        const chu = String(r.gia || "").replace(/\n{3,}/g, "\n\n");
        const u = await danhGia(p, "location.href");
        return ra({ ok: true, url: u.gia, chu: chu.slice(0, gioiHan), doDaiThat: chu.length });
      }

      if (v === "bam") {
        // Bấm theo CHỮ trên nút, không theo selector: chữ là thứ người dùng nói được, còn selector
        // thì bot phải đoán — và đoán sai thì im lặng không bấm gì.
        const r = await danhGia(p, "(()=>{const t=" + JSON.stringify(String(lenh.chu || "")) + ";"
          + "const ds=[...document.querySelectorAll('a,button,[role=button],input[type=submit],[role=link]')];"
          + "const b=ds.find(x=>((x.textContent||'')+' '+(x.value||'')+' '+(x.getAttribute('aria-label')||'')).trim().toLowerCase().includes(t.toLowerCase()));"
          + "if(!b) return 'KHONG-THAY'; b.scrollIntoView({block:'center'}); b.click(); return 'DA-BAM:'+((b.textContent||b.value||'').trim().slice(0,60));})()");
        if (r.loi) return ra({ ok: false, loi: r.loi });
        await nghi(1200);
        const u = await danhGia(p, "location.href");
        if (r.gia === "KHONG-THAY") return ra({ ok: false, loi: "không thấy nút/liên kết nào mang chữ " + JSON.stringify(lenh.chu) });
        return ra({ ok: true, ketQua: r.gia, url: u.gia });
      }

      if (v === "go") {
        const r = await danhGia(p, "(()=>{const nhan=" + JSON.stringify(String(lenh.o || "")) + ";"
          + "const ds=[...document.querySelectorAll('input,textarea,[contenteditable=true]')];"
          + "const o=ds.find(x=>((x.placeholder||'')+' '+(x.name||'')+' '+(x.getAttribute('aria-label')||'')+' '+(x.id||'')).toLowerCase().includes(nhan.toLowerCase()))||ds[0];"
          + "if(!o) return 'KHONG-THAY'; o.focus(); return 'OK';})()");
        if (r.gia === "KHONG-THAY") return ra({ ok: false, loi: "không thấy ô nhập nào khớp " + JSON.stringify(lenh.o) });
        await p.goi("Input.insertText", { text: String(lenh.chu || "") });
        if (lenh.enter) {
          for (const type of ["rawKeyDown", "char", "keyUp"]) {
            await p.goi("Input.dispatchKeyEvent", { type, windowsVirtualKeyCode: 13, key: "Enter", code: "Enter", text: "\r" });
          }
          await nghi(1500);
        }
        const u = await danhGia(p, "location.href");
        return ra({ ok: true, url: u.gia });
      }

      if (v === "anh") {
        const r = await p.goi("Page.captureScreenshot", { format: "jpeg", quality: 70 });
        const d = r.result && r.result.data;
        if (!d) return ra({ ok: false, loi: "không chụp được màn hình tab" });
        const u = await danhGia(p, "location.href");
        return ra({ ok: true, url: u.gia, anhBase64: d });
      }

      return ra({ ok: false, loi: "việc không hiểu: " + String(v) });
    } finally { p.dong(); }
  } catch (e) {
    ra({ ok: false, loi: String((e && e.message) || e).slice(0, 400) });
  }
})();
`;

/** Nguồn đã thay hằng số, sẵn sàng đóng gói base64. */
export const scriptDaThay = (): string => NGUON_SCRIPT.replace("__CONG__", String(CONG_CDP));
