/**
 * Chạy THẬT khối tự cập nhật của launcher ĐÃ RENDER, với một máy chủ giả trên loopback.
 *
 *   npx tsx services/grokbot-backend/scripts/do-khoi-cap-nhat.mts
 *
 * Vì sao không đọc mã: khối ấy là PowerShell nằm trong cmd nằm trong một template literal của JS —
 * ba lớp nháy và một lớp backslash. §7 đã trả giá đúng chỗ này ba lần (`\B` mất trong launcher ĐÃ
 * PHÁT ra ngoài; `String.raw` lồng làm ISCC hỏng; và 10/09 một dấu backtick trong chú thích REM cắt
 * đôi cả template). Đọc lên "trông đúng" không phải bằng chứng.
 *
 * Bài đo chạy TRỌN BỘ hai lần:
 *   · `curl`      — đường chính (curl.exe của Windows, có từ build 17063)
 *   · `khong-curl` — ép nhánh dự phòng bằng cách trỏ `SystemRoot` vào một thư mục rỗng, nên
 *                    `Test-Path` không thấy curl. Không cần thêm một cái knob nào vào sản phẩm,
 *                    và bài đo vẫn chạy đúng những byte sẽ phát ra ngoài.
 *
 * Và nó ghim một tính chất mà hai tệp cách xa nhau cùng phụ thuộc: sổ kiểm kê đội máy khoá hàng
 * theo `ua`, `chuanUa()` nhận launcher bằng chuỗi `PowerShell/<số>`, còn launcher thì tự đặt
 * `User-Agent`. Đổi ngăn xếp HTTP mà quên `-A` là mọi hàng launcher THẬT thành `curl/8.x` ⇒
 * `laLauncher:false` ⇒ thẻ Đội máy về 0/0 mà không lỗi nào nổi lên.
 *
 * Không chạm bản cài nào: thư mục app là đồ giả trong `mkdtemp`, "bộ cài" là một .cmd tự trả mã.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, mkdtempSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import { startBundled } from "./setup-exe.mjs";
import { chuanUa, KET_QUA } from "../src/so-doi-may.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAY_GIA = join(HERE, "do-khoi-cap-nhat-may-gia.mjs");
const CMD = process.env.ComSpec ?? "cmd.exe";

// Mọi đường dữ liệu trỏ `mkdtemp` VÔ ĐIỀU KIỆN — không `??=` theo env, vì env của runner là lưới
// bảo vệ `.data` thật, không phải hàng rào giữa các lượt chạy (§7).
const GOC = mkdtempSync(join(tmpdir(), "gb2-do-khoi-"));
const D = join(GOC, "dieu-khien");
const MAY = join(GOC, "may");
const KHONG_CURL = join(GOC, "khong-co-curl");
mkdirSync(D, { recursive: true });
mkdirSync(join(KHONG_CURL, "System32"), { recursive: true });

const GOI = "do-khoi-goi-gia.cmd";
const thanGoi = (ma: number) => `@echo off\r\nexit /b ${ma}\r\n`;
const bam = (s: string) => createHash("sha256").update(s).digest("hex");
const PHA2 = join(process.env.TEMP ?? tmpdir(), "bot-noi-bo-cap-nhat.ps1");

// Cắt khối cập nhật khỏi bản RENDER, không khỏi mã nguồn.
const day = startBundled().split(/\r?\n/);
const dau = day.findIndex((l: string) => l.startsWith("powershell -NoProfile"));
const cuoi = day.findIndex((l: string, i: number) => i > dau && l.includes("}catch{ G $giaiDoan"));
if (dau < 0 || cuoi < 0) throw new Error("không cắt được khối cập nhật khỏi bản render");
const khoi = day.slice(dau, cuoi + 1).join("\r\n");

// Hàng rào cmd nằm SAU khối, và nó đo một thứ khác hẳn: cái duy nhất còn nói được khi chính khối
// kia bị giết từ bên ngoài. Cắt riêng vì `.cmd` của mười ca dưới cố ý KHÔNG có nó — ở đó thứ đang
// đo là mã thoát của chính pha 1, mà hàng rào thì nuốt mã 7 thành 0.
const iSau = day.findIndex((l: string, i: number) => i > cuoi && l.trim() === ":sau_cap_nhat");
if (iSau < 0) throw new Error("không cắt được hàng rào cmd sau khối cập nhật");
const hangRao = day.slice(cuoi + 1, iSau).join("\r\n");

const moc: { ok: boolean; ten: string }[] = [];
const ghim = (ten: string, that: unknown, mong: unknown) => {
  const ok = String(that) === String(mong);
  moc.push({ ok, ten });
  console.log(`    ${ok ? "v" : "X"} ${ten}: ${that}${ok ? "" : ` (mong ${mong})`}`);
};

/** Một lượt chạy trọn bộ kịch bản, với hoặc không có curl. */
function luotDo(nhan: "curl" | "khong-curl") {
  console.log(`\n########## ${nhan} ##########`);
  rmSync(MAY, { recursive: true, force: true });
  mkdirSync(join(MAY, "resources", "app"), { recursive: true });
  writeFileSync(join(MAY, "resources", "app", "package.json"), JSON.stringify({ version: "0.29.20260903" }));
  writeFileSync(join(MAY, "token.txt"), "ve-gia-chi-de-qua-cua");
  writeFileSync(join(MAY, "start-bot.cmd"), "@echo off\r\nexit /b 0\r\n");

  const datKichBan = (kb: unknown) => {
    writeFileSync(join(D, "dem-goi.txt"), "0");
    writeFileSync(join(D, "kich-ban.json"), JSON.stringify(kb));
  };

  rmSync(join(D, "cong.txt"), { force: true });
  rmSync(join(D, "nhat-ky.jsonl"), { force: true });
  datKichBan({ status: 204, than: "" });
  const con = spawn(process.execPath, [MAY_GIA, D], { stdio: "ignore" });
  for (let i = 0; i < 200 && !existsSync(join(D, "cong.txt")); i++) {
    execFileSync(process.execPath, ["-e", "setTimeout(()=>{},25)"]);
  }
  const BE = `http://127.0.0.1:${readFileSync(join(D, "cong.txt"), "utf8").trim()}`;
  console.log(`  máy giả: ${BE}`);

  const bcPath = join(MAY, ".cap-nhat-cuoi.txt");
  // Đọc có thử lại: pha 2 chạy TÁCH RỜI nên nó có thể đang ghi đúng lúc mình đọc (EBUSY trên
  // Windows). Một bộ đo không được đỏ vì một nhịp khoá tệp của chính nó.
  const doc = (): string => {
    if (!existsSync(bcPath)) return "(VANG)";
    for (let i = 0; i < 40; i++) {
      try { return readFileSync(bcPath, "utf8").trim(); }
      catch { execFileSync(process.execPath, ["-e", "setTimeout(()=>{},100)"]); }
    }
    throw new Error("không đọc nổi vệt bánh mì sau 40 nhịp");
  };
  const kqCua = (s: string) => (s.match(/kq=([a-z0-9-]+)/) ?? [])[1] ?? "(không có)";
  const lanCua = (s: string) => (s.match(/lan=(\d+)/) ?? [])[1] ?? "(không có)";
  const nhatKy = (): { ver: string; kq: string; coK: boolean; ua: string }[] =>
    existsSync(join(D, "nhat-ky.jsonl"))
      ? readFileSync(join(D, "nhat-ky.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
      : [];

  const cmdTep = join(MAY, "thu.cmd");
  writeFileSync(cmdTep, `@echo off\r\nset "BE=${BE}"\r\n${khoi}\r\nexit /b %errorlevel%\r\n`);
  // Ép nhánh dự phòng bằng SystemRoot, không bằng một cờ của sản phẩm. Đo 10/09: PowerShell vẫn
  // chạy bình thường với SystemRoot bịa đặt (PATH là biến khác nên cmd/powershell vẫn tìm được).
  const env = nhan === "khong-curl" ? { ...process.env, SystemRoot: KHONG_CURL } : process.env;

  const chay = (ten: string) => {
    rmSync(join(MAY, ".lan-hoi-cuoi"), { force: true });
    let ma = 0;
    try { execFileSync(CMD, ["/c", cmdTep], { stdio: "pipe", env }); } catch (e: any) {
      ma = e.status ?? -1;
      // Một lượt chạy hỏng phải NÓI RA vì sao. Không in thì mọi mốc sau đỏ với "(VANG)" và bộ đo
      // trỏ sang sản phẩm cho một lỗi của chính nó (§7).
      const loi = String(e.stderr ?? "").trim();
      if (loi) console.log(`      [stderr] ${loi.slice(0, 300)}`);
    }
    console.log(`  ${ten.padEnd(32)} exit=${String(ma).padEnd(2)} | ${doc()}`);
    return { ma, kq: kqCua(doc()) };
  };

  /**
   * Một lượt `da-giao-pha2` để lại pha 2 CHẠY NỀN — chính khối vừa phát nó ra, và nó ngủ 2 giây
   * trước khi ghi. Không chờ nó thì lượt ghi ấy rơi vào ô đo của ca SAU: đúng thế đã xảy ra khi
   * `Hidden` thành `Minimized` (nhịp mở cửa sổ đổi) và ca 5 báo *"vệt bánh mì bị bôi"* cho một
   * việc sản phẩm làm đúng. Cùng họ §7 *"cửa sổ đo không khớp với LƯỢT"*.
   *
   * Chờ nó cũng là phép đo MẠNH HƠN: nó chứng minh khối THẬT SỰ chạy được pha 2, chứ không chỉ
   * ghi ra một tệp .ps1 — nên bản trước tự chạy `PHA2` một lần nữa là thừa, và chính lượt thừa ấy
   * là kẻ đua với lượt nền.
   */
  const choPha2Xong = (mongKq: string) => {
    for (let i = 0; i < 200; i++) {
      if (["cai-xong", "cai-hong"].includes(kqCua(doc()))) return;
      execFileSync(process.execPath, ["-e", "setTimeout(()=>{},100)"]);
    }
    throw new Error(`pha 2 chạy nền không bao giờ ghi lại (chờ ${mongKq})`);
  };

  console.log("1) feed trả 204 — ca LÀNH");
  let r = chay("204 không có bản mới");
  ghim("kq ghi lại", r.kq, "khong-co-ban-moi");
  ghim("lượt hỏi mang kq cũ (chưa có)", nhatKy().at(-1)?.kq, "");
  ghim("lượt hỏi có mang token", nhatKy().at(-1)?.coK, "true");
  ghim("lượt hỏi khai đúng ver", nhatKy().at(-1)?.ver, "0.29.20260903");
  // Khoá của sổ đội máy KHÔNG được đổi khi ngăn xếp HTTP đổi.
  const ua = nhatKy().at(-1)?.ua ?? "";
  const chuan = chuanUa(ua);
  ghim("sổ đội máy vẫn nhận là launcher", chuan.laLauncher, "true");
  ghim("khoá sổ vẫn là PowerShell/<số>", chuan.ua.startsWith("PowerShell/"), "true");

  console.log("2) 200 + BĂM LỆCH — đúng ca máy 26100.9168 nghi mắc");
  datKichBan({ status: 200, than: thanGoi(3), body: { ten: GOI, url: `${BE}/goi`, sha256hash: "0".repeat(64), version: "9.9.9" } });
  r = chay("200 + sha không khớp");
  ghim("kq ghi lại", r.kq, "bam-lech");
  ghim("lượt hỏi mang kq lần trước", nhatKy().at(-1)?.kq, "khong-co-ban-moi");

  console.log("3) băm KHỚP -> giao pha 2; rồi CHẠY pha 2 với bộ cài trả mã 3");
  datKichBan({ status: 200, than: thanGoi(3), body: { ten: GOI, url: `${BE}/goi`, sha256hash: bam(thanGoi(3)), version: "9.9.9" } });
  r = chay("200 + sha khớp");
  ghim("exit code pha 1", r.ma, 7);
  ghim("kq ghi lại", r.kq, "da-giao-pha2");
  ghim("pha 2 có trên đĩa", existsSync(PHA2), true);
  choPha2Xong("cai-hong");
  ghim("kq sau pha 2", kqCua(doc()), "cai-hong");
  ghim("mã bộ cài được ghi", (doc().match(/ma=(-?\d+)/) ?? [])[1], "3");

  console.log("4) bộ cài trả 0 -> cai-xong");
  datKichBan({ status: 200, than: thanGoi(0), body: { ten: GOI, url: `${BE}/goi`, sha256hash: bam(thanGoi(0)), version: "9.9.9" } });
  chay("200 + sha khớp (lần 2)");
  choPha2Xong("cai-xong");
  ghim("kq sau pha 2", kqCua(doc()), "cai-xong");
  ghim("mã bộ cài được ghi", (doc().match(/ma=(-?\d+)/) ?? [])[1], "0");

  console.log("5) TIẾT CHẾ không được bôi mất chẩn đoán");
  writeFileSync(join(MAY, ".lan-hoi-cuoi"), new Date().toISOString());
  const truoc = doc();
  const nTruoc = nhatKy().length;
  try { execFileSync(CMD, ["/c", cmdTep], { stdio: "pipe", env }); } catch { /* exit 0 */ }
  ghim("vệt bánh mì giữ nguyên", doc() === truoc, true);
  ghim("không hỏi feed", nhatKy().length === nTruoc, true);

  console.log("6) tải ĐỨT 2 lần rồi OK -> phải cài được, không bỏ cuộc");
  datKichBan({ status: 200, than: thanGoi(0), hongLan: 2, kieuHong: "cat", body: { ten: GOI, url: `${BE}/goi`, sha256hash: bam(thanGoi(0)), version: "9.9.9" } });
  r = chay("đứt 2 lần rồi trọn vẹn");
  ghim("exit code pha 1", r.ma, 7);
  ghim("số lượt tải đã dùng", readFileSync(join(D, "dem-goi.txt"), "utf8"), "3");
  // Ca này cũng giao pha 2, nên cũng phải chờ nó xong trước khi ca 7 mở ô đo của mình.
  choPha2Xong("cai-xong");

  console.log("7) tải ĐỨT cả 3 lần (kiểu CẮT: sha lệch) -> bam-lech lan=3");
  datKichBan({ status: 200, than: thanGoi(0), hongLan: 9, kieuHong: "cat", body: { ten: GOI, url: `${BE}/goi`, sha256hash: bam(thanGoi(0)), version: "9.9.9" } });
  r = chay("cắt cả 3 lần");
  ghim("kq ghi lại", r.kq, "bam-lech");
  ghim("số lần ghi vào vệt bánh mì", lanCua(doc()), "3");
  ghim("không giao pha 2", r.ma, 0);

  console.log("8) socket bị PHÁ cả 3 lần -> tai-hong lan=3");
  datKichBan({ status: 200, than: thanGoi(0), hongLan: 9, kieuHong: "dut", body: { ten: GOI, url: `${BE}/goi`, sha256hash: bam(thanGoi(0)), version: "9.9.9" } });
  r = chay("đứt socket cả 3 lần");
  ghim("kq ghi lại", r.kq, "tai-hong");
  ghim("số lần ghi vào vệt bánh mì", lanCua(doc()), "3");

  console.log("9) MẤT token -> thieu-giay");
  rmSync(join(MAY, "token.txt"), { force: true });
  r = chay("không có token.txt");
  ghim("kq ghi lại", r.kq, "thieu-giay");

  console.log("10) feed CHẾT -> giai đoạn feed-loi qua catch");
  // Trả token lại: cửa token đứng TRƯỚC cửa feed, nên thiếu nó thì lượt này không bao giờ tới feed.
  writeFileSync(join(MAY, "token.txt"), "ve-gia-chi-de-qua-cua");
  con.kill();
  r = chay("không tới được feed");
  ghim("kq ghi lại", r.kq, "feed-loi");

  rmSync(join(process.env.TEMP ?? tmpdir(), GOI), { force: true });
  rmSync(PHA2, { force: true });
  return nhatKy().map((l) => chuanUa(l.ua).ua);
}

/**
 * Ca thứ 11, và nó không chạy được trong `luotDo` vì ở đây pha 1 phải KHÔNG chạy.
 *
 * Đo 11/09: Defender chấm điểm cả dòng lệnh của pha 1 và giết `powershell` ngay ở `CreateProcess`
 * (`Trojan:Win32/PowhidSubExec.B`, cmd in *"Access is denied."*, `errorlevel` 5). Mọi chỗ ghi vệt
 * bánh mì của mục 52 nằm BÊN TRONG tiến trình ấy, nên cả tám cửa của nó câm cùng lúc — lần câm thứ
 * TƯ của đường giao hàng. Thứ còn nói được chỉ có mấy dòng cmd này.
 *
 * Đứng thay chỗ pha 1 là một lệnh trả đúng mã cần đo: thứ ĐANG ĐO là hàng rào, và hàng rào thì lấy
 * NGUYÊN VĂN từ bản render — không phải một bản chép tay của nó.
 */
function doHangRao() {
  console.log("\n########## hàng rào cmd: pha 1 bị giết từ NGOÀI ##########");
  const MAY2 = join(GOC, "may-hang-rao");
  mkdirSync(MAY2, { recursive: true });
  const bc = join(MAY2, ".cap-nhat-cuoi.txt");
  const tep = join(MAY2, "thu.cmd");
  const CU = "2026-01-01T00:00:00 ver=0.0.0 kq=khong-co-ban-moi";

  const chay = (ma: number) => {
    writeFileSync(bc, CU + "\r\n");
    writeFileSync(tep, `@echo off\r\ncmd /c exit ${ma}\r\n${hangRao}\r\necho DEN-SAU-CAP-NHAT\r\nexit /b 0\r\n`);
    let out = "";
    try { out = String(execFileSync(CMD, ["/c", tep], { stdio: "pipe" })); }
    catch (e: any) { out = String(e.stdout ?? ""); }
    const vet = readFileSync(bc, "utf8").trim();
    console.log(`  pha 1 thoát ${String(ma).padEnd(2)} | mở app tiếp: ${String(out.includes("DEN-SAU-CAP-NHAT")).padEnd(5)} | ${vet}`);
    return { vet, kq: (vet.match(/kq=([a-z0-9-]+)/) ?? [])[1] ?? "(không có)", tiep: out.includes("DEN-SAU-CAP-NHAT") };
  };

  let r = chay(5);
  ghim("mã 5 (bị giết) ghi kq=bi-chan", r.kq, "bi-chan");
  ghim("và ghi cả mã thoát", /\bma=5\b/.test(r.vet), true);
  ghim("vẫn mở app — hàng rào fail-open", r.tiep, true);
  ghim("từ này nằm trong từ điển đóng", (KET_QUA as readonly string[]).includes("bi-chan"), true);

  r = chay(7);
  ghim("mã 7 = giao pha 2 -> THOÁT, không mở app", r.tiep, false);
  ghim("mã 7 không bôi mất chẩn đoán của pha 1", r.kq, "khong-co-ban-moi");

  r = chay(0);
  ghim("mã 0 không ghi đè vệt bánh mì", r.vet, CU);
  ghim("mã 0 vẫn mở app", r.tiep, true);
}

const khoaCurl = luotDo("curl");
const khoaIwr = luotDo("khong-curl");
doHangRao();

console.log("\n########## hai đường phải cho CÙNG một khoá sổ ##########");
ghim("khoá qua curl", [...new Set(khoaCurl)].join(","), [...new Set(khoaIwr)].join(","));

rmSync(GOC, { recursive: true, force: true });
const xanh = moc.filter((m) => m.ok).length;
console.log(`\n=== ${xanh}/${moc.length} mốc ===`);
if (xanh !== moc.length) {
  for (const m of moc.filter((x) => !x.ok)) console.log(`  ĐỎ: ${m.ten}`);
  process.exit(1);
}
