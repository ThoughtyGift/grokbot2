/**
 * Hai lệnh ảnh client hỏi mà backend chưa trả lời được: vẽ avatar, và tải hộ logo plugin.
 *
 * ── Vì sao đúng hai lệnh này, không phải hai mươi ───────────────────────────────────────────────
 *
 * Đối chiếu hợp đồng 0.30 (147 lệnh) với bảng lệnh của mình, còn 20 lệnh chưa có handler. Nhưng
 * 14 trong số đó nằm sau cờ tính năng TẮT ở chính client — `grok_bot_multiplayer` chắn 9 lệnh
 * phòng chung, `sand_voice_call` chắn 5 lệnh gọi thoại — nên viết chúng ra thì client cũng không
 * gọi. Hai lệnh nữa (`getBotTemplateExportPolicy`, `resolveVirtualCardApproval`) không xuất hiện
 * một lần nào trong bundle 0.29 đang chạy: chúng chỉ có trong hợp đồng 0.30.
 *
 * Còn lại là nhóm ảnh, và renderer nhắc tới mỗi lệnh 3 lần, không cờ nào chắn.
 *
 * ── Vì sao logo phải đi vòng qua đây ────────────────────────────────────────────────────────────
 *
 * Không phải tiện nghi: renderer KHÔNG tải nổi ảnh từ origin lạ (parity.md §2u — mọi link CDN hiện
 * "Couldn't load image"), nên host phải tải hộ rồi trả data URL. Đúng lý do `attach_image` bên tool
 * cũng phải làm vậy, và ở đây dùng lại chính hàng rào của nó.
 */
import { config, loadPoolKey } from "./config.js";
// Hàng rào địa chỉ nội bộ dùng LẠI của `attach_image`, không viết bản thứ hai: một hàng rào
// an ninh có hai bản là một bản sẽ lạc hậu mà không ai biết.
import { isInternalHost } from "./runtime/tools.js";
import { imageSize } from "./attachments.js";

/** Ảnh lớn hơn ngần này thì thôi — data URL đi thẳng vào bộ nhớ renderer. */
const TOI_DA = 4_000_000;

/**
 * Vẽ một avatar từ mô tả. `null` khi không vẽ được — người gọi đổi thành avatar rỗng.
 *
 * Cùng đường với tool `generate_image`: một POST tới `config.imagesUrl`. Không gọi lại tool đó vì
 * tool trả về CÂU CHỮ cho model đọc, còn ở đây client cần BYTES.
 */
export async function veAvatar(moTa: string): Promise<string | null> {
  const key = loadPoolKey();
  if (!key) return null;
  try {
    const res = await fetch(config.imagesUrl, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: config.imageModel, prompt: moTa }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { images?: { url?: string }[] };
    const url = j.images?.[0]?.url;
    return url ? await taiAnh(url) : null;
  } catch {
    return null;
  }
}

/**
 * Tải một ảnh ngoài về dạng data URL. `null` nếu không hợp lệ.
 *
 * Ba hàng rào, và cả ba đều có lý do đã trả giá ở chỗ khác: chỉ http/https (một `url` từ catalog là
 * dữ liệu ngoài), chặn địa chỉ nội bộ (một proxy mở là cửa dò mạng LAN), và chặn ảnh quá lớn
 * (data URL nằm nguyên trong bộ nhớ renderer).
 */
export async function taiAnh(raw: string): Promise<string | null> {
  let target: URL;
  try { target = new URL(raw); } catch { return null; }
  if (target.protocol !== "http:" && target.protocol !== "https:") return null;
  if (await isInternalHost(target.hostname)) return null;
  try {
    const res = await fetch(target, { redirect: "follow", signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    // Sau khi theo chuyển hướng, đích có thể đã khác — kiểm lại, đúng như `attachOneImage` làm.
    const landed = new URL(res.url || target.href);
    if (await isInternalHost(landed.hostname)) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > TOI_DA) return null;
    // `imageSize` đọc định dạng từ BYTES, không từ đuôi file hay Content-Type — một CDN trả
    // `logo.png` mà ruột là WebP là chuyện thường, và đoán theo tên là cách gửi cho renderer một
    // bức ảnh vỡ mà không ai lần ra được.
    const do_ = imageSize(bytes);
    if (do_) return `data:${do_.mime};base64,${bytes.toString("base64")}`;

    /*
     * Không nhận ra PNG/JPEG/GIF thì mới hỏi tới Content-Type — và chỉ trong một danh sách trắng.
     *
     * Cần nhánh này vì logo plugin trong catalog rất hay là ICO hoặc WebP: đo được, favicon của
     * Google trả về rỗng ở bản đầu. Nhưng Content-Type là do MÁY CHỦ LẠ tự khai, nên nó chỉ được
     * dùng để CHỌN trong danh sách mình đã duyệt, không được dùng để mở thêm cửa.
     *
     * SVG bị loại có chủ ý dù nó cũng là `image/*`: một tệp SVG chạy được `<script>`, và data URL
     * này đi thẳng vào renderer. Một cái logo không đáng để đổi lấy chuyện đó.
     */
    const ct = String(res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const CHO_PHEP = new Set(["image/webp", "image/avif", "image/x-icon", "image/vnd.microsoft.icon", "image/bmp"]);
    if (CHO_PHEP.has(ct)) return `data:${ct};base64,${bytes.toString("base64")}`;
    return null;
  } catch {
    return null;
  }
}
