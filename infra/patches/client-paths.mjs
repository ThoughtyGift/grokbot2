/**
 * Client desktop nằm ở đâu, và làm sao biết nó đang chạy — theo từng hệ điều hành.
 *
 * Tách khỏi `patch-client.mjs` vì hai lý do. Một: script đó chạy ngay khi import (nó là công cụ
 * dòng lệnh), nên không kiểm thử được nếu logic nằm trong đó. Hai: đây đúng là chỗ dễ sai nhất khi
 * thêm macOS — Electron xếp `resources/` ở hai vị trí khác hẳn nhau, và đoán sai thì bộ vá ghi vào
 * một thư mục không ai đọc.
 *
 *   Windows:  %LOCALAPPDATA%\\Programs\\Grok Bot\\resources\\app.asar
 *   macOS:    /Applications/Grok Bot.app/Contents/Resources/app.asar
 *
 * Chốt "app đang chạy" quan trọng ngang phần đường dẫn: một client đang mở giữ `app.asar`, và một
 * lần vá dở dang để lại asar gốc nằm cạnh `resources/app` đã vá — app vẫn boot bản gốc, im lặng.
 * Bản cũ chỉ kiểm trên `win32`, nghĩa là trên máy Mac chốt đó **không tồn tại** chứ không phải
 * "không cần" — nên mỗi hệ có một lệnh kiểm riêng ở đây.
 */
import { join } from "node:path";

/** @typedef {{ appDir: string, res: string, asar: string, asarAside: string, appUnpacked: string,
 *              running: { cmd: string, args: string[], match: RegExp } | null,
 *              supported: boolean, platform: string }} ClientPaths */

export const ASIDE_NAME = "app.asar.disabled-by-grokbot2";

/**
 * @param {{ platform?: string, env?: Record<string, string | undefined> }} [opts]
 * @returns {ClientPaths}
 */
export function clientPaths(opts = {}) {
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;

  // Ghi đè bằng tay luôn thắng: người dùng cài chỗ khác, hoặc đang thử trên một bản sao.
  const override = env.GROKBOT2_CLIENT_DIR;

  let appDir, res, supported = true;
  if (platform === "darwin") {
    appDir = override ?? "/Applications/Grok Bot.app";
    // Bó .app: mọi thứ nằm dưới Contents/, và chữ R viết hoa. macOS thường không phân biệt hoa
    // thường nhưng ổ định dạng case-sensitive thì có — nên viết đúng ngay từ đầu.
    res = join(appDir, "Contents", "Resources");
  } else if (platform === "win32") {
    appDir = override ?? join(env.LOCALAPPDATA ?? "", "Programs", "Grok Bot");
    res = join(appDir, "resources");
  } else {
    // Linux: nhà phát hành không phát hành bản Linux nào mình thấy được. Cho phép ghi đè bằng tay
    // để còn thử, nhưng không đoán một đường dẫn mặc định không có thật.
    appDir = override ?? "";
    res = appDir ? join(appDir, "resources") : "";
    supported = Boolean(override);
  }

  return {
    platform,
    supported,
    appDir,
    res,
    asar: res ? join(res, "app.asar") : "",
    asarAside: res ? join(res, ASIDE_NAME) : "",
    appUnpacked: res ? join(res, "app") : "",
    running: runningProbe(platform),
  };
}

/**
 * Lệnh hỏi "client có đang chạy không". `null` = hệ này chưa có cách kiểm, và người gọi phải coi đó
 * là **không biết**, không phải "không chạy".
 *
 * @param {string} platform
 */
function runningProbe(platform) {
  if (platform === "win32") {
    return { cmd: "tasklist", args: ["/FI", "IMAGENAME eq Grok Bot.exe", "/NH"], match: /Grok Bot\.exe/i };
  }
  if (platform === "darwin") {
    // -f khớp cả dòng lệnh; tên tiến trình thật là "Grok Bot" nằm trong bó .app.
    return { cmd: "pgrep", args: ["-f", "Grok Bot.app"], match: /\d/ };
  }
  return null;
}
