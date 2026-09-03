/**
 * Launcher của bản CHỞ CẢ APP (`startBundled`) — nó quyết định máy cài bản 105 MB có bao giờ lên bản
 * mới không.
 *
 *   npx tsx --test services/grokbot-backend/src/launcher-cap-nhat.test.ts
 *
 * Lịch sử ngắn của file này, vì nó đảo luật hai lần trong một ngày (03/09):
 *
 *   sáng  — "khoá updater gốc CÓ ĐIỀU KIỆN: app đã vá feed thì mở". Hướng sai: updater gốc dò chữ
 *           ký Authenticode và đòi tên người ký của HÃNG, nên mở nó chỉ được một banner dẫn tới nút
 *           Install luôn thất bại.
 *   chiều — updater gốc TẮT hẳn (mở lại bằng GROKBOT2_NATIVE_UPDATES=1 cho ngày có chứng chỉ), và
 *           launcher TỰ cập nhật qua `/updates/ban-moi?k=`, đọc token từ `token.txt` cạnh app.
 *
 * Đo E2E cùng ngày: bản cài từ web khớp từng byte bản đang chạy — nhưng launcher của nó là bản
 * sáng, không có tự cập nhật. File này khoá bản chiều.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error — script .mjs thuần, không có khai báo kiểu; đây là chỗ duy nhất TS chạm vào nó.
import { startBundled, coVaUpdateFeed } from "../scripts/setup-exe.mjs";

const s: string = startBundled();

test("updater gốc TẮT mặc định, mở lại được bằng GROKBOT2_NATIVE_UPDATES=1", () => {
  assert.match(s, /if not "%GROKBOT2_NATIVE_UPDATES%"=="1" set "SAND_DISABLE_UPDATES=1"/,
    "updater gốc không cài được bản của mình — mở nó chỉ dựng một nút Install luôn thất bại");
  assert.doesNotMatch(s, /^set "SAND_DISABLE_UPDATES=1"$/m, "không còn dòng đặt CỨNG vô điều kiện");
});

test("tự cập nhật: hỏi đúng cửa, kèm token, kiểm hash, tiết chế, fail-open", () => {
  assert.match(s, /updates\/ban-moi\?nen=windows&ver=/, "phải hỏi cửa launcher của backend mình");
  assert.match(s, /token\.txt/, "phải đọc token — không có thì bản 50 KB sẽ được cài lên máy này, sai gói");
  assert.match(s, /'&k='\+\[uri\]::EscapeDataString\(\$k\)/, "token đi trong query, đã escape");
  assert.match(s, /if\(-not \(Test-Path \$tk\)\)\{ exit 0 \}/, "không có token thì im lặng mở app, không thử gói khác");
  assert.match(s, /Get-FileHash/, "phải kiểm sha256 trước khi CHẠY file tải về");
  assert.match(s, /if\(\$h -ne \$b\.sha256hash\.ToLower\(\)\)\{ Remove-Item \$tmp -Force; exit 0 \}/, "hash lệch ⇒ xoá file, mở app như thường");
  assert.match(s, /TotalHours -lt 24/, "gói ~105 MB: hỏi một lần mỗi ngày là đủ");
  assert.match(s, /catch\{ exit 0 \}/, "hỏng thì MỞ APP — lớp cập nhật tự chặn đường vào sản phẩm là lớp sẽ bị gỡ");
  assert.match(s, /GROKBOT2_NO_SELF_UPDATE/, "phải tắt được");
});

test("HAI PHA: pha 1 chỉ ghi script ra %TEMP% rồi thoát; pha 2 chạy tách rời", () => {
  // Bộ cài ghi đè chính start-bot.cmd. cmd đọc batch theo từng dòng từ đĩa, nên cài ĐỒNG BỘ từ trong
  // launcher là đọc dòng kế từ file mới ở offset cũ. Pha 2 phải chạy sau khi cmd đã thoát.
  assert.match(s, /bot-noi-bo-cap-nhat\.ps1/, "pha 2 là một script riêng trong %TEMP%");
  assert.match(s, /Start-Process -FilePath 'powershell' -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',\$pha2/, "pha 2 phải được khởi chạy TÁCH RỜI");
  assert.match(s, /'Start-Sleep -Seconds 2'/, "pha 2 chờ cmd thoát trước khi cài");
  assert.match(s, /\/VERYSILENT.*\/SUPPRESSMSGBOXES.*\/NORESTART.*\/DIR=/, "cài im lặng, đúng vào thư mục đang cài");
  assert.match(s, /'Start-Process -FilePath \(Join-Path \$d ''start-bot\.cmd''\)/, "cài xong pha 2 phải mở lại app — [Run] của Inno có skipifsilent");
  assert.match(s, /if errorlevel 7 exit \/b 0/, "mã 7 ⇒ cmd thoát ngay, không mở app lần hai");
  assert.doesNotMatch(s, /& cmd \/c \$tmp/, "không còn nhánh cài ĐỒNG BỘ trong launcher");
});

test("bốn biến hợp đồng với client còn đủ", () => {
  for (const bien of ["CURSOR_API_BASE_URL", "SAND_BACKEND_URL", "CURSOR_WEBSITE_URL", "SAND_DISABLE_UPDATES"]) {
    assert.match(s, new RegExp(`set "${bien}=`), bien);
  }
});

test("coVaUpdateFeed vẫn đo được dấu vá — giữ làm chẩn đoán, không còn quyết định gì", () => {
  const root = mkdtempSync(join(tmpdir(), "gb2-feed-"));
  try {
    const dir = join(root, "resources", "app", "dist", "electron-main");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "main.cjs"), 'var X="http://be"/*grokbot2:update-feed*/');
    assert.equal(coVaUpdateFeed(root), true);
    assert.equal(coVaUpdateFeed(join(tmpdir(), "khong-ton-tai-gb2")), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
