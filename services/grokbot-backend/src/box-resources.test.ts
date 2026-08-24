/**
 * Đọc sức chứa của box — xem box-resources.ts.
 *
 * Mọi dòng mẫu dưới đây là output THẬT lấy từ box ngày 24/08/2026, không phải bịa cho vừa hàm.
 * Đó là điều kiện để bài này có nghĩa: hai lỗi nghiêm trọng nhất của module đều là lỗi *đọc sai
 * dữ liệu thật* — sáu Chrome không nối được về màn hình của chúng, và một kết luận ngược về việc
 * RAM hay đĩa chặn trước. Fixture bịa ra sẽ không bắt được lỗi nào trong hai lỗi đó.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFree, parseDf, parsePs, headroomOf, displayFromProfile } from "./box-resources.js";

test("free -m đọc ra RAM khả dụng, không phải RAM 'free'", () => {
  const ram = parseFree("Mem:          22017       13205        4310         435        4501        7993");
  assert.equal(ram.totalMb, 22017);
  assert.equal(ram.freeMb, 4310);
  assert.equal(ram.availableMb, 7993,
    "cột 'available' mới là chỗ cấp được; 'free' bỏ qua buff/cache và luôn nhỏ hơn thực tế");
});

test("df -m đọc ra chỗ trống và phần trăm đã dùng", () => {
  const d = parseDf("/dev/sda2       102388   88185   14204  87% /");
  assert.equal(d.totalMb, 102388);
  assert.equal(d.freeMb, 14204);
  assert.equal(d.usedPct, 87);
  assert.equal(d.mount, "/");
});

/**
 * Sáu Chrome trên box này nhét số display vào tên hồ sơ với tiền tố `9` (`…-both-9342` là `:342`),
 * còn Chrome của grokbot2 thì không (`grok-chrome-77` là `:77`). Bản đầu chỉ khớp kiểu thứ hai,
 * nên 6.2 GB rơi vào ô "không gán được" và sáu màn hình trông như bị bỏ rơi — từ đó tôi kết luận
 * "rác thu hồi được", và đó là phần mềm khác đang chạy thật.
 */
test("tên hồ sơ nối được về màn hình theo cả hai cách box này dùng", () => {
  const known = new Set([":77", ":342", ":336", ":99"]);
  assert.equal(displayFromProfile("/home/box/.config/grok-chrome-77", known), ":77");
  assert.equal(displayFromProfile("/root/flow-profiles/ip-82-29-239-26-both-9342", known), ":342");
  assert.equal(displayFromProfile("/tmp/grokbot2/disp336/profile", known), ":336");
});

test("không nối bừa: hồ sơ trỏ vào màn hình không tồn tại thì để trống", () => {
  const known = new Set([":77"]);
  assert.equal(displayFromProfile("/root/flow-profiles/ip-1-2-3-4-both-9342", known), "",
    "thà để ở ô chưa gán hơn là gán vào một màn hình không có thật");
  assert.equal(displayFromProfile("/tmp/com.google.Chrome.scoped_dir.AaUKAD", known), "");
});

test("gom tiến trình về từng màn hình, và cộng đúng theo hồ sơ", () => {
  const lines = [
    "  1001  125000 Xvfb :77 -screen 0 1920x1080x24 -ac",
    "  1002   84000 Xvfb :342 -screen 0 1920x1080x24",
    "  1003    5200 Xvfb :99 -screen 0 1920x1080x24",
    "  1010   20500 x11vnc -display :77 -rfbport 5977 -forever",
    "  1100 1200000 /usr/bin/google-chrome --user-data-dir=/home/box/.config/grok-chrome-77 --remote-debugging-port=9223",
    "  1101 1340000 /opt/google/chrome/chrome --type=renderer --user-data-dir=/home/box/.config/grok-chrome-77",
    "  1200  990000 /usr/bin/google-chrome --user-data-dir=/root/flow-profiles/ip-82-29-239-26-both-9342",
    "  1300  200000 /opt/google/chrome/chrome --type=gpu-process --user-data-dir=/tmp/com.google.Chrome.scoped_dir.X",
  ];
  const { displays, chromeProfiles, looseChromeMb } = parsePs(lines);
  const d77 = displays.find((d) => d.display === ":77")!;
  assert.ok(d77.chromeMb > 2400 && d77.chromeMb < 2600, `chrome của :77 phải gộp cả tiến trình con, nhận ${d77.chromeMb}`);
  assert.ok(d77.vncMb >= 19, "x11vnc gắn theo cờ -display");
  assert.equal(d77.vncPort, 5977);
  assert.equal(d77.geometry, "1920x1080x24");
  assert.equal(d77.idle, false);

  const d99 = displays.find((d) => d.display === ":99")!;
  assert.equal(d99.idle, true, "chỉ có Xvfb thì đúng là đang trống");

  assert.equal(chromeProfiles[0].display, ":77", "hồ sơ nặng nhất đứng đầu và đã nối được");
  assert.ok(looseChromeMb > 150, "hồ sơ tạm không nối được thì phải hiện ra, không được biến mất");
});

/**
 * Con số quyết định kiến trúc, nên nó phải trả về CẢ HAI phía. Chính tôi đã kết luận "đĩa chặn
 * trước RAM" từ chỗ thấy 87% đĩa, trong khi tính ra thì RAM chặn trước — 14 bot so với 37.
 */
test("headroom nói rõ RAM hay đĩa đang chặn, không chọn hộ", () => {
  const h = headroomOf(
    { totalMb: 22017, usedMb: 13205, freeMb: 4310, availableMb: 8110 },
    { totalMb: 102388, usedMb: 88185, freeMb: 14204, usedPct: 87, mount: "/" },
  );
  assert.equal(h.byRamBots, 14);
  assert.equal(h.byDiskBots, 37);
  assert.equal(h.limit, "ram", "87% đĩa nghe đáng lo hơn, nhưng RAM mới là chỗ hết trước");
  assert.equal(h.bots, 14, "số cấp được là cái nhỏ hơn trong hai");
});

test("hết chỗ thì trả về 0, không trả số âm", () => {
  const h = headroomOf(
    { totalMb: 22017, usedMb: 21800, freeMb: 200, availableMb: 300 },
    { totalMb: 102388, usedMb: 102000, freeMb: 388, usedPct: 99, mount: "/" },
  );
  assert.equal(h.bots, 0);
  assert.equal(h.byRamBots, 0);
  assert.equal(h.byDiskBots, 0);
});
