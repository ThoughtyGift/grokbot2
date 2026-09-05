#!/usr/bin/env node
/**
 * Bộ định tuyến của box — **một daemon cho mỗi người dùng**, thay vì một daemon đổi danh tính.
 *
 * Vì sao có file này. Đo ngày 26/08 bằng `e2e-box-leak.mjs`: **0/7 chỗ kín**. Mọi bot của mọi người
 * chạy dưới cùng một tài khoản `box`, cùng một `/home/box/workspace`, cùng một hồ sơ Chrome — nên
 * bot của A đọc, liệt kê, `cat`, **ghi đè** được file của B, và duyệt web bằng cookie của B.
 *
 * Bản thử đầu tiên cho daemon tự đổi danh tính theo từng request. Nó chạy được phần shell, rồi vấp
 * đúng chỗ đáng lẽ phải thấy trước: **tám handler còn dùng `fs` trực tiếp**, mà tiến trình thì vẫn
 * là `box` — kernel từ chối, và ghi file hỏng hẳn. Muốn đi tiếp phải viết lại cả tám.
 *
 * Nên đổi hình: daemon **không biết gì** về người dùng, nó chỉ làm việc trong đúng một thư mục gốc.
 * File này đứng trước, và với mỗi người thì **bật một daemon riêng chạy dưới tài khoản của họ**.
 * Kết quả:
 *
 *   - tám handler kia không phải sửa một dòng
 *   - cách ly do **tiến trình khác uid** lo, không do một hàm kiểm đường dẫn lo
 *   - giống cách hãng làm: họ lấy chính cái box làm ranh giới giữa người với người
 *
 * Hợp đồng nhìn từ ngoài **không đổi**: vẫn cổng 1337, vẫn `Bearer <token>`, vẫn `POST /<op>`.
 * Backend chỉ thêm một header nói ai đang gọi.
 *
 *   GROKBOT2_EXEC_TOKEN=<secret> node exec-router.mjs [port]
 *
 * Cần trước (bước 0, một lần bằng root — xem docs/plan/per-user-on-one-box.md):
 *   groupadd gb2users · useradd -m -g gb2users gb2uNNN · chmod 700 /home/gb2uNNN
 *   /etc/sudoers.d/grokbot2:  box ALL=(%gb2users) NOPASSWD: ALL
 *   install -d -o box -g box -m 700 /var/lib/grokbot2
 */
import { createServer, request } from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.argv[2] ?? process.env.GROKBOT2_EXEC_PORT ?? 1337);
const TOKEN = process.env.GROKBOT2_EXEC_TOKEN ?? "";
if (!TOKEN) {
  console.error("refusing to start without GROKBOT2_EXEC_TOKEN");
  process.exit(1);
}

/** Daemon con là chính file cạnh đây — một bản mã, hai vai. */
const DAEMON = join(dirname(fileURLToPath(import.meta.url)), "exec-daemon.mjs");

/**
 * Tắt thì mọi người dùng chung một daemon, y như trước file này.
 *
 * Mặc định TẮT, và đó là chủ ý: box đang chạy thật, nên bản này phải bật được sau khi đã đo chứ
 * không đổi hành vi ngay lúc cài.
 */
const PER_USER = (process.env.GROKBOT2_PER_USER ?? "").trim() === "1";

/** Cổng của daemon con: cách xa 1337 để không đụng ai, mỗi người một số. */
const BASE_PORT = Number(process.env.GROKBOT2_CHILD_PORT_BASE ?? 13400);

/**
 * Sổ ghép người dùng grokbot2 → tài khoản hệ điều hành.
 *
 * `/var/lib/grokbot2` chứ không phải `/opt`: tiến trình này chạy dưới `box`, còn `/opt` thuộc root —
 * bản đầu đặt ở đó nên lượt cấp tài khoản đầu tiên chết với `EACCES`.
 *
 * Sổ chứ không phải băm owner ra số: hai người trùng ô băm sẽ **dùng chung một tài khoản**, và đó là
 * hỏng cách ly mà không có dấu hiệu nào. Sổ thì trùng là nhìn thấy.
 */
const MAP_FILE = process.env.GROKBOT2_USER_MAP ?? "/var/lib/grokbot2/users.json";

/**
 * Dải tài khoản: đọc từ `/etc/passwd` MỖI LẦN cấp, không đóng cứng.
 *
 * Bản đầu ghi cứng `gb2u001…005` làm mặc định, và cái mặc định ấy sống lâu hơn thực tế: tới 06/09 box
 * đã có 10 tài khoản `gb2u*` (tạo tay đúng như kế hoạch), sổ ghép đã cấp hết 10, mà router vẫn tin
 * dải là 5 — nên người tiếp theo nhận "pool exhausted" trong khi việc thêm tài khoản đã làm rồi.
 * Một danh sách phải nhớ đồng bộ ở hai nơi (hệ điều hành và biến môi trường) thì sẽ lệch; nguồn
 * sự thật là passwd, nên đọc thẳng ở đó. `GROKBOT2_USER_POOL` vẫn thắng nếu ai đặt — để khoá dải
 * hẹp hơn có chủ ý.
 */
const POOL_ENV = (process.env.GROKBOT2_USER_POOL ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const PASSWD = process.env.GROKBOT2_PASSWD_FILE ?? "/etc/passwd";
export function poolAccounts() {
  if (POOL_ENV.length) return POOL_ENV;
  try {
    return readFileSync(PASSWD, "utf8").split("\n")
      .map((l) => l.split(":")[0])
      .filter((u) => /^gb2u\d{3,}$/.test(u))
      .sort();
  } catch { return []; }
}

/** Lỗi có MÃ để đầu gọi (`box-exec.ts`) nói được câu cho người dùng thay vì câu cho quản trị viên. */
export class PoolExhausted extends Error {
  constructor(used, size) {
    super(`per-user mode: pool exhausted (${used} in use, ${size} accounts) — create more gb2u* accounts`);
    this.code = "pool-exhausted"; this.used = used; this.size = size;
  }
}

export function osUserFor(owner, mapFile = MAP_FILE) {
  const key = String(owner ?? "").trim();
  if (!key) throw new Error("per-user mode: request carried no owner");

  let map = {};
  try { map = JSON.parse(readFileSync(mapFile, "utf8")); } catch { /* sổ chưa có */ }
  if (map[key]) return map[key];

  const pool = poolAccounts();
  const taken = new Set(Object.values(map));
  const free = pool.find((u) => !taken.has(u));
  // Hết dải thì ném lỗi. KHÔNG lùi về tài khoản dùng chung: lùi về nghĩa là im lặng bỏ cách ly đúng
  // vào lúc cần nó nhất.
  if (!free) throw new PoolExhausted(taken.size, pool.length);

  map[key] = free;
  writeFileSync(mapFile, `${JSON.stringify(map, null, 2)}\n`);
  console.log(`[router] ${key} -> ${free} (${taken.size + 1}/${pool.length})`);
  return free;
}

/** Daemon con đang sống, khoá theo tài khoản hệ điều hành. */
const children = new Map();

/**
 * Nghỉ lâu hơn mức này thì thu daemon con lại.
 *
 * Mỗi con là một tiến trình Node — không lớn, nhưng năm người ngồi không thì vẫn là năm tiến trình
 * nằm ăn RAM trên một máy chủ đang chạy 17 site khác. Cùng con số và cùng lý lẽ với `IDLE_MS` của
 * `displays.ts`: mười phút.
 *
 * Thu là **an toàn**: lượt gọi sau tự bật lại, và thư mục của người đó vẫn nguyên trên đĩa — chỉ
 * tiến trình bị thu, không phải dữ liệu.
 */
const IDLE_MS = Number(process.env.GROKBOT2_CHILD_IDLE_MS ?? 600_000);
const SWEEP_MS = Number(process.env.GROKBOT2_CHILD_SWEEP_MS ?? 60_000);

/**
 * Dừng một daemon con — **qua chính tài khoản của người đó**.
 *
 * Hai lần sai trước khi đúng, và cả hai đều im lặng:
 *
 * 1. `kill` vào tiến trình `sudo`. Nhưng `sudo` **fork** rồi chờ `node`, nên chỉ một tiến trình chết
 *    và `node` **mồ côi vẫn ôm cổng**. Log in "đã thu", RAM không trả lại, lượt gọi sau bật daemon
 *    mới trên cổng đã bị chiếm rồi trả về rỗng — cơ chế thu hồi làm đúng cái ngược với việc của nó.
 * 2. `detached: true` + `kill(-pid)` để hạ cả nhóm. Cây tiến trình đúng như mong đợi, mà vẫn không
 *    chết: router chạy dưới `box`, còn `sudo` là của `root` và `node` là của `gb2uNNN`. **`box` không
 *    có quyền gửi tín hiệu cho tiến trình của người khác** — `kill` trả EPERM và không ai đọc.
 *
 * Nên giết qua đúng cái quyền ta có: chạy `pkill` **dưới danh nghĩa người đó**. Khoá theo cả user và
 * cổng, để không bao giờ chạm vào daemon của người khác.
 */
function stopChild(user, c, why) {
  console.log(`[router] thu daemon ${user} (${why})`);
  try {
    execFileSync("sudo", ["-n", "-u", user, "pkill", "-u", user, "-f", `exec-daemon.mjs ${c.port}`],
                 { stdio: "pipe" });
  } catch {
    // `pkill` trả mã 1 khi không khớp gì — tức nó đã chết rồi. Không phải lỗi.
  }
  children.delete(user);
}

/** Thu những daemon nghỉ quá lâu. Nói ra tên, để log trả lời được "sao lượt đó chậm". */
function reapIdle(now = Date.now()) {
  for (const [user, c] of [...children]) {
    if (now - c.lastUsedMs < IDLE_MS) continue;
    stopChild(user, c, `nghỉ ${Math.round((now - c.lastUsedMs) / 1000)}s`);
  }
}

// `unref` để cái hẹn giờ này không giữ tiến trình sống khi mọi thứ khác đã xong.
setInterval(() => reapIdle(), SWEEP_MS).unref();

const waitPort = (port, ms = 8000) => new Promise((res, rej) => {
  const t0 = Date.now();
  const tick = () => {
    const req = request({ host: "127.0.0.1", port, path: "/health", method: "POST",
                          headers: { authorization: `Bearer ${TOKEN}` } }, (r) => { r.resume(); res(); });
    req.on("error", () => (Date.now() - t0 > ms ? rej(new Error(`daemon con không lên sau ${ms}ms`)) : setTimeout(tick, 150)));
    req.end("{}");
  };
  tick();
});

/**
 * Bật (hoặc dùng lại) daemon của một người, trả về cổng của nó.
 *
 * Thư mục được tạo **dưới danh nghĩa chính người đó** rồi mới `chmod 700`, nên nó thuộc về họ chứ
 * không thuộc `box` — đó là chỗ kernel bắt đầu làm việc thay cho code.
 */
async function daemonFor(user) {
  const live = children.get(user);
  if (live && !live.proc.killed && live.proc.exitCode === null) {
    // Chạm vào mỗi lần dùng, nếu không thì một người đang làm việc liên tục vẫn bị thu sau mười phút.
    live.lastUsedMs = Date.now();
    return live.port;
  }

  // Cổng theo SỐ trong tên (`gb2u011` → BASE+11), không theo vị trí trong danh sách: danh sách nay đọc
  // từ passwd nên vị trí có thể đổi khi thêm tài khoản, còn số trong tên thì không.
  const port = BASE_PORT + Number(user.replace(/^gb2u/, ""));
  const home = join("/home", user);
  const root = join(home, "workspace");
  const memory = join(home, "grok-memory");

  execFileSync("sudo", ["-n", "-u", user, "/bin/bash", "-lc",
    `mkdir -p ${JSON.stringify(root)} ${JSON.stringify(memory)} && chmod 700 ${JSON.stringify(home)}`],
    { stdio: "pipe" });

  /*
   * `--preserve-env=` là chỗ bản đầu vấp.
   *
   * `sudo` **xoá sạch môi trường** theo mặc định, nên tiến trình con khởi động không thấy token và tự
   * dừng với "refusing to start without GROKBOT2_EXEC_TOKEN" — nhìn từ ngoài chỉ thấy "daemon con
   * không lên", không nói gì về nguyên nhân.
   *
   * Giữ đúng ba biến cần, và **không** đưa token lên dòng lệnh: `ps` là ai cũng đọc được.
   */
  const proc = spawn("sudo", [
    "-n", "-u", user,
    "--preserve-env=GROKBOT2_EXEC_TOKEN,GROKBOT2_MEMORY_DIR,GROKBOT2_EXEC_SHELL",
    "/usr/bin/node", DAEMON, String(port), root,
  ], {
    env: { ...process.env, GROKBOT2_EXEC_TOKEN: TOKEN, GROKBOT2_MEMORY_DIR: memory },
    stdio: ["ignore", "inherit", "inherit"],
    // Trưởng nhóm riêng, để `kill(-pid)` hạ được cả `sudo` lẫn `node` — xem `stopChild`.
    detached: true,
  });
  proc.on("exit", (code) => {
    console.log(`[router] daemon ${user} thoát (${code})`);
    children.delete(user);
  });
  children.set(user, { proc, port, lastUsedMs: Date.now() });

  await waitPort(port);
  console.log(`[router] daemon ${user} sẵn sàng ở 127.0.0.1:${port} root=${root}`);
  return port;
}

/** Daemon dùng chung, cho khi chưa bật tách — giữ nguyên hành vi cũ. */
let sharedPort = null;
async function sharedDaemon() {
  if (sharedPort) return sharedPort;
  const port = BASE_PORT - 1;
  const root = process.env.GROKBOT2_EXEC_ROOT ?? "/home/box/workspace";
  const proc = spawn("/usr/bin/node", [DAEMON, String(port), root], {
    env: { ...process.env, GROKBOT2_EXEC_TOKEN: TOKEN },
    stdio: ["ignore", "inherit", "inherit"],
  });
  proc.on("exit", (code) => { console.log(`[router] daemon chung thoát (${code})`); sharedPort = null; });
  await waitPort(port);
  console.log(`[router] daemon chung sẵn sàng ở 127.0.0.1:${port} root=${root}`);
  sharedPort = port;
  return port;
}

const server = createServer(async (req, res) => {
  const fail = (code, body) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  // Kiểm token Ở ĐÂY, trước khi đọc thân hay bật tiến trình nào: một lời gọi không có giấy tờ không
  // được phép làm ta tốn dù một `spawn`.
  if (req.headers.authorization !== `Bearer ${TOKEN}`) return fail(401, { error: "unauthorized" });

  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", async () => {
    const body = Buffer.concat(chunks);
    let port;
    try {
      port = PER_USER ? await daemonFor(osUserFor(req.headers["x-grokbot2-owner"])) : await sharedDaemon();
    } catch (e) {
      // Trả 200 kèm `error` — đúng hình dạng daemon vẫn trả, để phía gọi không phải học thêm một
      // kiểu lỗi thứ hai. `code` là phần THÊM: có nó thì `box-exec.ts` nói được câu cho người dùng.
      return fail(200, { error: String(e?.message ?? e), ...(e?.code ? { code: e.code, used: e.used, size: e.size } : {}) });
    }

    const up = request(
      { host: "127.0.0.1", port, method: req.method, path: req.url, headers: { ...req.headers, host: `127.0.0.1:${port}` } },
      (ur) => { res.writeHead(ur.statusCode ?? 500, ur.headers); ur.pipe(res); },
    );
    up.on("error", (e) => fail(200, { error: `box unavailable: ${e.message}` }));
    up.end(body);
  });
});

// Chỉ nghe khi được CHẠY, không phải khi được IMPORT — bài test nạp `osUserFor`/`poolAccounts` mà không mở cổng.
const LA_CHINH = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (LA_CHINH) server.listen(PORT, "127.0.0.1", () => {
  console.log(`[router] nghe 127.0.0.1:${PORT} · tách người dùng: ${PER_USER ? "BẬT" : "tắt"}`);
  if (PER_USER) { const p = poolAccounts(); console.log(`[router] dải tài khoản: ${p.length} (${p[0] ?? "—"}…${p[p.length - 1] ?? "—"}) · sổ: ${MAP_FILE}`); }
});

// Tắt router thì tắt luôn daemon con, đừng để lại tiến trình mồ côi giữ cổng.
if (LA_CHINH) for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    for (const [user, c] of children) stopChild(user, c, "router tắt");
    process.exit(0);
  });
}
