/**
 * Icon MẶC ĐỊNH của bot — chép đúng cách renderer 0.43 suy hình và màu từ `agent.id` khi bản ghi không có
 * `avatarShape`/`avatarColor`.
 *
 * Đo 06/09: bản ghi `agent-984` (New Bot) không lưu hình/màu; sidebar client vẽ viên thuốc CAM (client tự suy từ id), còn thẻ
 * mẫu bên ta rơi về mặc định "blob"/"blue" → tròn XANH. App gốc thì thẻ và sidebar cùng một icon, vì cùng một hàm. Hàm ấy nằm
 * trong `index-Df98_wE4.js`:
 *
 *     Sp(t) = qIe.find(n => n === t.avatarShape) ?? mR(t.id)          // hình: có lưu và hợp lệ thì dùng, không thì suy
 *     Af(t) = S2.find(n => n.id === t.avatarColor)?.id ?? x2(t.id)     // màu: như trên
 *     $ee   = FNV-1a 32 bit trên chuỗi id
 *     mR    = w2[ZRe(id) % 8]         ZRe = murmur-fmix($ee) — chỉ 8 hình được suy (không phải cả bảng 18)
 *     x2    = zee[XRe(WRe(id))]       WRe = $ee ^ (1·0x9E3779B9) · KRe = mulberry32 · zee = 10 màu, KHÔNG có "black"
 *
 * Bất kỳ chỗ nào bên ta cần "icon của bot này" (thẻ mẫu, hộp View Details, trang /bot/<id>, avatar thông báo) phải đi qua đây,
 * không được rơi về hằng "blob"/"blue" — hằng ấy chỉ đúng cho bot mà client cũng KHÔNG suy được, tức không có bot nào.
 */

/** `w2` — 8 hình renderer chọn khi suy từ id (tập con của bảng `SB` 18 hình). */
const HINH_SUY = ["blob", "pebble", "squircle", "tablet", "wedge", "hex", "cloud", "teardrop"] as const;
/** `zee` = `S2` bỏ "black" — thứ tự đúng như bảng của renderer. */
const MAU_SUY = ["brown", "red", "orange", "yellow", "green", "cyan", "blue", "violet", "magenta", "gray"] as const;
const MOI_HINH = new Set(["blob", "pebble", "bean", "egg", "squircle", "tablet", "capsule", "cylinder", "hex", "gem", "crystal", "wedge", "shield", "dome", "arch", "cloud", "teardrop", "leaf"]);
const MOI_MAU = new Set(["black", ...MAU_SUY]);

/** `$ee` — FNV-1a 32 bit. */
function fnv1a(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** `ZRe` — fmix của murmur3 trên $ee. */
function fmix(s: string): number {
  let e = fnv1a(s) | 0;
  e = Math.imul(e ^ (e >>> 16), 73244475);
  e = Math.imul(e ^ (e >>> 13), 3266489909);
  return (e ^ (e >>> 16)) >>> 0;
}

/** `KRe` — mulberry32, chỉ cần một lần rút. */
function mulberry32(seed: number): () => number {
  let e = seed >>> 0;
  return () => {
    e = (e + 1831565813) | 0;
    let n = Math.imul(e ^ (e >>> 15), 1 | e);
    n = (n + Math.imul(n ^ (n >>> 7), 61 | n)) ^ n;
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

/** `mR(id)` */
export const hinhSuyTuId = (id: string): string => HINH_SUY[fmix(id) % HINH_SUY.length] ?? "blob";

/** `x2(id)` — `VRe = HRe = 1` trong bundle 0.43. */
export function mauSuyTuId(id: string): string {
  const wre = (fnv1a(id) ^ Math.imul(1, 2654435769)) >>> 0;
  const rng = mulberry32((wre ^ Math.imul(1, 2654435769)) >>> 0);
  return MAU_SUY[Math.floor(rng() * MAU_SUY.length)] ?? "black";
}

export interface AvatarBot { shape: string; color: string }

/**
 * `Sp`/`Af` gộp: icon client SẼ VẼ cho bản ghi này — giá trị đã lưu nếu hợp lệ, không thì suy từ id.
 * Nhận cả bản ghi thiếu trường (`avatarShape`/`avatarColor` là `unknown`).
 */
export function avatarCuaBot(rec: { id: string; avatarShape?: unknown; avatarColor?: unknown }): AvatarBot {
  const shape = typeof rec.avatarShape === "string" && MOI_HINH.has(rec.avatarShape) ? rec.avatarShape : hinhSuyTuId(rec.id);
  const color = typeof rec.avatarColor === "string" && MOI_MAU.has(rec.avatarColor) ? rec.avatarColor : mauSuyTuId(rec.id);
  return { shape, color };
}
