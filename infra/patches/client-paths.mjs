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
    running: runningProbe(platform, appDir),
  };
}

/**
 * Lệnh hỏi "client có đang chạy không". `null` = hệ này chưa có cách kiểm, và người gọi phải coi đó
 * là **không biết**, không phải "không chạy".
 *
 * @param {string} platform
 */
function runningProbe(platform, appDir = "") {
  if (platform === "win32") {
    /*
     * Hỏi theo ĐƯỜNG DẪN, không theo tên ảnh — vì máy này có HAI bản cài.
     *
     * `tasklist /FI "IMAGENAME eq Grok Bot.exe"` chỉ biết tên tiến trình, nên nó trả về "đang chạy"
     * khi bản của HÃNG (`C:\Program Files\Grok Bot`) đang mở, dù ta đang vá bản ở `C:\cai029`.
     * Đo 02/09: app local đã đóng sạch (0 tiến trình), app gốc còn 10, và `--apply` vẫn từ chối.
     * Guard trả lời đúng nhưng trả lời SAI CÂU HỎI: cái giữ `app.asar` là bản đang vá, không phải
     * bản trùng tên.
     *
     * Không có `appDir` thì quay về chốt theo tên: thà từ chối quá rộng còn hơn vá lên một app đang
     * mở — nửa lần vá để lại asar gốc cạnh `resources/app` và app boot bản gốc trong im lặng.
     */
    /*
     * Đòi đường TUYỆT ĐỐI, không chỉ đòi "không rỗng".
     *
     * `appDir` dựng bằng `join(env.LOCALAPPDATA ?? "", "Programs", "Grok Bot")`, nên khi không có
     * `LOCALAPPDATA` nó ra `"Programs\Grok Bot"` — tương đối, vô nghĩa, mà **không rỗng**. Chốt
     * path-aware với đường đó sẽ khớp KHÔNG tiến trình nào, tức báo "app đã đóng" trong khi nó đang
     * mở, và `--apply` vá đè lên một client đang chạy. Bài test bắt được đúng chỗ này.
     */
    if (!/^[A-Za-z]:[\\/]/.test(appDir)) {
      return { cmd: "tasklist", args: ["/FI", "IMAGENAME eq Grok Bot.exe", "/NH"], match: /Grok Bot\.exe/i };
    }
    return {
      cmd: "powershell",
      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
        `$p = Get-Process -Name 'Grok Bot' -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '${appDir.replace(/'/g, "''")}\*' }; if ($p) { 'DANG-CHAY' } else { 'KHONG' }`],
      match: /DANG-CHAY/,
    };
  }
  if (platform === "darwin") {
    // -f khớp cả dòng lệnh; tên tiến trình thật là "Grok Bot" nằm trong bó .app.
    return { cmd: "pgrep", args: ["-f", "Grok Bot.app"], match: /\d/ };
  }
  return null;
}
