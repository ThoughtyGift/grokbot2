/**
 * `injectChromeCookies` — chở phiên đăng nhập từ Chrome của NGƯỜI DÙNG sang Chrome của BOX.
 *
 * ── Việc này giải quyết cái gì ──────────────────────────────────────────────────────────────────
 *
 * Bot làm việc trong trình duyệt trên box, và box là một máy trắng: không tài khoản nào đăng nhập
 * sẵn. Nên mọi việc thật — mở Kênh Người Bán, đọc đơn, xem quảng cáo — đều dừng ở màn hình đăng
 * nhập. Người dùng thì đã đăng nhập sẵn trên Chrome máy mình từ lâu.
 *
 * Lệnh này là cây cầu: client đọc cookie từ hồ sơ Chrome trên máy người dùng, rồi gửi xuống host,
 * host tiêm vào Chrome của box.
 *
 * ── Vì sao làm lệnh này mà không phải 16 lệnh khác ─────────────────────────────────────────────
 *
 * Đo 31/08: hợp đồng 0.30 còn 17 lệnh chưa có handler, nhưng 15 trong số đó client KHÔNG GỌI ĐƯỢC
 * (9 sau cờ `grok_bot_multiplayer` TẮT, 5 sau `sand_voice_call` TẮT, 2 không tồn tại trong bundle
 * 0.29 đang chạy). `injectChromeCookies` là món duy nhất còn mở thật — `main.cjs` nhắc nó 7 lần.
 *
 * ── Hợp đồng, trích từ bundle chứ không đoán ────────────────────────────────────────────────────
 *
 *     injectChromeCookies: v().args({ cookies: Ie(xkr) })
 *     xkr = $({ name, value, domain, path, expires, httpOnly, secure,
 *               sameSite?: "Strict"|"Lax"|"None", session?, priority?, partitionKey? })
 *
 * Phía client đọc kết quả như sau — nên hình dạng trả về không được tuỳ tiện:
 *
 *     let m = d === 0 ? undefined : await n.injectChromeCookies({ cookies: a });
 *     let f = m?.injected ?? 0;
 *     let p = f > 0 ? m?.sites ?? 0 : NGt(a);
 *
 * Tức: `{ injected: number, sites: number }`. `injected = 0` làm client tự đếm site theo cách của
 * nó và báo "empty" — nên trả 0 khi hỏng là đúng, không phải ném.
 *
 * Shape ấy gần như 1:1 với CDP `Network.setCookies`, và đó không phải trùng hợp: cả hai đều mô tả
 * cookie của Chrome. Chỗ lệch duy nhất là `expires` — xem chú thích trong `doiSangCdp`.
 */
import { cdpForAgent, isBrowserConfigured } from "./browser.js";

/** Cookie như client gửi xuống. Trường tuỳ chọn đúng theo `xkr`. */
export interface CookieVao {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: "Strict" | "Lax" | "None";
  session?: boolean;
  priority?: "Low" | "Medium" | "High";
  partitionKey?: unknown;
}

export interface KetQuaTiem {
  injected: number;
  sites: number;
}

/**
 * Đổi một cookie sang tham số `Network.setCookies` của CDP.
 *
 * Hai chỗ phải cẩn thận, và cả hai đều là nguồn của "tiêm xong mà vẫn phải đăng nhập lại":
 *
 * · `expires` — CDP tính bằng GIÂY từ epoch, còn Chrome ở nhiều chỗ khác lại dùng mili-giây. Gửi
 *   nhầm đơn vị thì cookie hoặc hết hạn ngay (chia nhầm) hoặc hết hạn năm 56000 (nhân nhầm), và cả
 *   hai đều KHÔNG báo lỗi — `setCookies` vẫn trả về thành công. Đoán đơn vị theo độ lớn: mốc
 *   ~2.001-01-01 tính bằng giây là 978.307.200, nên bất cứ số nào lớn hơn 10^11 chắc chắn là
 *   mili-giây.
 *
 * · `session` — cookie phiên KHÔNG được có `expires`. Gửi kèm là biến nó thành cookie thường, sống
 *   lâu hơn thứ người dùng đã đồng ý.
 */
const doiSangCdp = (c: CookieVao): Record<string, unknown> => {
  const het = Number(c.expires);
  const laPhien = c.session === true || !Number.isFinite(het) || het <= 0;
  return {
    name: String(c.name ?? ""),
    value: String(c.value ?? ""),
    domain: String(c.domain ?? ""),
    path: String(c.path ?? "/"),
    httpOnly: c.httpOnly === true,
    secure: c.secure === true,
    ...(c.sameSite ? { sameSite: c.sameSite } : {}),
    ...(laPhien ? {} : { expires: het > 1e11 ? Math.floor(het / 1000) : Math.floor(het) }),
  };
};

/** Tên site để đếm — bỏ dấu chấm đầu của cookie domain (`.shopee.vn` → `shopee.vn`). */
const site = (domain: string): string => String(domain ?? "").replace(/^\./, "").toLowerCase();

/**
 * Tiêm cookie vào trình duyệt của box.
 *
 * Trả `{injected: 0, sites: 0}` chứ KHÔNG ném khi chưa cấu hình trình duyệt hay khi CDP hỏng:
 * client đọc `m?.injected ?? 0` rồi tự báo "empty" cho người dùng — một ngoại lệ ở đây chỉ biến
 * một thông báo hiểu được thành một lỗi đỏ không ai đọc nổi.
 */
export async function tiemCookieVaoBox(cookies: CookieVao[], agentId = "default"): Promise<KetQuaTiem> {
  const ds = Array.isArray(cookies) ? cookies.filter((c) => c && c.name && c.domain) : [];
  if (ds.length === 0 || !isBrowserConfigured()) return { injected: 0, sites: 0 };

  const goi = ds.map(doiSangCdp);
  try {
    /*
     * `Network.setCookies` nhận CẢ MẢNG trong một lần gọi — không lặp từng cái.
     *
     * Không phải để nhanh: gọi từng cookie một thì một cookie hỏng sẽ làm hỏng nửa chừng, và ta
     * còn lại một trình duyệt có nửa phiên đăng nhập — trạng thái tệ hơn cả không tiêm gì, vì nó
     * trông như đã đăng nhập.
     */
    await cdpForAgent(agentId, "Network.enable", {});
    await cdpForAgent(agentId, "Network.setCookies", { cookies: goi });
  } catch {
    return { injected: 0, sites: 0 };
  }

  return { injected: goi.length, sites: new Set(ds.map((c) => site(c.domain))).size };
}
