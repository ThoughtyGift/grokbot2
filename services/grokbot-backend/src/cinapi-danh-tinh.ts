/**
 * Hỏi cinAPI *"cookie này là ai"* — cách **(C)** của [cinapi-merge.md](../../../docs/plan/cinapi-merge.md) §4.
 *
 * Vì sao HỎI chứ không tự xác minh: grokbot2 đọc bí mật JWT của mình từ `shared/data/jwt-secret.txt`,
 * và nó **khác** `JWT_SECRET` của cinapi — đo 09/09 trên VPS bằng cách so `sha256sum` hai giá trị
 * (so rồi bỏ; băm của một khoá ký là máy xác minh phỏng đoán nên không chép vào tài liệu). Nên
 * `verifyJwt` **từ chối** mọi cookie `cinapi_at` thật, và đó chính là lý do P1 "đã xong" trong bản kế
 * hoạch cũ chưa bao giờ chạy ngoài sản xuất: phép nghiệm 23/08 dựng token bằng secret của CHÍNH
 * grokbot2, nên nó chứng minh *mã nhận cookie đúng hình* — không chứng minh cookie thật đi qua.
 *
 * Cách chép secret sang đây thì rẻ hơn một dòng, và **không làm**: một bí mật ở hai nơi là hai chỗ
 * rò, và nó còn buộc grokbot2 phải theo mọi lần cinapi xoay khoá. Hỏi thì grokbot2 **không cầm gì**.
 *
 * Ba tính chất được bảo đảm bằng HÌNH DẠNG HÀM, không bằng lời dặn:
 *
 *  1. **Token không bao giờ vào URL.** Nó đi trong header `Cookie`. Một URL thì rơi vào access log
 *     của nginx (đúng chỗ 09/09 tôi đọc được cả query string của launcher); một header thì không.
 *     `duongMe()` không nhận token làm đối số nên viết sai chuyện này là không viết ra được.
 *  2. **Module này không có một lời gọi log nào.** Cùng luật đã ghi ở `update-feed`: *"một dòng log
 *     là một chỗ rò. Chỉ log 'có trình token hay không'"*. Có unit ghim điều phủ định ấy.
 *  3. **Không CACHE.** Cache theo token là chỗ một phiên đã bị thu hồi vẫn mở được cửa trong TTL,
 *     và nó giữ bí mật trong RAM lâu hơn cần thiết. Người gọi duy nhất là lúc ĐĂNG NHẬP (một lần
 *     cho một phiên desktop, xem `login-page.ts`), nên cache không mua được gì — đúng YAGNI, và
 *     tránh luôn cái bẫy *"một cơ chế dựng cho không ai"*.
 *
 * Vì sao `authId` mang tiền tố `cinapi|` chứ không dùng thẳng `id`: chuỗi danh tính của dự án này
 * ngăn bằng `|` (`auth0|grokbot2-user`, `local|<email>`), nên một tiền tố riêng làm sổ máy và log
 * đọc ra được *ai từ đâu*, và **`id` mang `|` thì bị TỪ CHỐI** — không thì một id bịa
 * `x|grokbot2-user` mạo được danh tính mặc định. Dùng `id` (UUID) chứ không dùng email vì email đổi
 * được, còn khoá sở hữu thì không nên đổi theo.
 */

/** Gốc API của cinAPI. Vắng biến ⇒ tính năng TẮT — không nhánh nào tự đoán một URL. */
export function cinapiGoc(): string | null {
  const raw = (process.env.GROKBOT2_CINAPI_BASE ?? "").trim().replace(/\/+$/, "");
  if (!raw) return null;
  // Cùng phép kiểm `upgradeUrl()` đã có: một `javascript:` hay `file:` lọt vào đây là một lời gọi
  // đi chỗ khác hẳn. Chỉ http/https.
  if (!/^https?:\/\//i.test(raw)) return null;
  return raw;
}

/**
 * Đường `/me`. KHÔNG nhận token — xem tính chất (1) ở đầu tệp.
 * `router.go:121` của cinapi: `api.With(RequireAuthOrAPIKey(...)).Get("/me", meH.Me)`.
 */
export const duongMe = (goc: string): string => `${goc}/api/v1/me`;

export interface DanhTinhCinai {
  /** Khoá sở hữu bên grokbot2, dạng `cinapi|<id>`. */
  authId: string;
  email: string;
}

/**
 * Đọc thân reply của cinapi. THUẦN — không mạng, không thời gian, nên chạy được trước khi nối dây.
 *
 * Hình dạng đo trên VPS 09/09, không đoán: `pkg/response/envelope.go` bọc mọi reply thành
 * `{code, msg, data}`, và `me.go:22` đặt `data = {"user": toUserDTO(user)}` với `userDTO.ID` mang
 * thẻ `json:"id"` (`handler/auth.go:35`). Một lượt 401 thật trả `{"code":401,"msg":"unauthorized","data":null}`.
 *
 * Nhận thêm dạng KHÔNG bọc (`{user:{…}}`) vì đó là chi phí bằng không và cinapi có ngày bỏ envelope;
 * nhưng **không** nhận `{id:…}` trần: một thân lạ mà đoán ra danh tính là chỗ tệ nhất để dễ tính.
 */
export function docDanhTinh(than: string): DanhTinhCinai | null {
  let j: unknown;
  try {
    j = JSON.parse(than);
  } catch {
    return null;
  }
  const g = j as Record<string, unknown> | null;
  if (!g || typeof g !== "object") return null;
  const data = (g["data"] ?? g) as Record<string, unknown> | null;
  if (!data || typeof data !== "object") return null;
  const u = data["user"] as Record<string, unknown> | null;
  if (!u || typeof u !== "object") return null;

  const id = typeof u["id"] === "string" ? u["id"].trim() : "";
  // Rỗng thì trả THIẾU chứ không trả `cinapi|` — một khoá sở hữu rỗng gom mọi người vào một chủ.
  if (!id) return null;
  // `|` ngăn các phần của chuỗi danh tính, khoảng trắng thì làm log khó đọc lại. Cả hai là từ chối,
  // không phải "dọn cho sạch": dọn xong vẫn là một id KHÁC id cinapi phát ra.
  if (/[|\s]/.test(id)) return null;

  const email = typeof u["email"] === "string" ? u["email"].trim() : "";
  return { authId: `cinapi|${id}`, email };
}

/** Cửa mạng tiêm được — bài đo không mở socket nào. */
export type Lay = (
  url: string,
  init: { headers: Record<string, string>; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export interface HoiTuyChon {
  lay?: Lay;
  goc?: string | null;
  /** Trần chờ. Đường đăng nhập có một con người đang đứng xem, nên không được chờ vô hạn. */
  tranMs?: number;
}

export const TRAN_MS = 4000;

/**
 * `cookie` → danh tính, hoặc `null`.
 *
 * `null` gộp mọi lý do (vắng gốc · 401 · mạng đứt · thân lạ) **có chủ ý**: người gọi ở cửa đăng nhập
 * chỉ có đúng hai đường đi, và một câu lỗi chi tiết ở cửa ấy là bản đồ cho người đang dò — cùng
 * quyết định đã ghi ở `giayDuChoOps` (§6 mục 43).
 */
export async function hoiCinapiMe(cookieToken: string, tuyChon: HoiTuyChon = {}): Promise<DanhTinhCinai | null> {
  const token = (cookieToken ?? "").trim();
  if (!token) return null;
  const goc = tuyChon.goc !== undefined ? tuyChon.goc : cinapiGoc();
  if (!goc) return null;

  const lay = tuyChon.lay ?? ((u, i) => fetch(u, i as RequestInit) as unknown as ReturnType<Lay>);
  const bo = new AbortController();
  const dongHo = setTimeout(() => bo.abort(), tuyChon.tranMs ?? TRAN_MS);
  try {
    const r = await lay(duongMe(goc), {
      headers: {
        // Đúng tên cookie của cinapi (`middleware/auth.go:14` `CookieAccess`).
        cookie: `cinapi_at=${token}`,
        accept: "application/json",
      },
      signal: bo.signal,
    });
    if (!r.ok) return null;
    return docDanhTinh(await r.text());
  } catch {
    // Không nuốt im lặng ở tầng NGHĨA: người gọi phân biệt được "không phải người cinai" với
    // "không hỏi được" bằng cách đo cửa của mình, chứ không bằng một câu chữ đi qua đây.
    return null;
  } finally {
    clearTimeout(dongHo);
  }
}
