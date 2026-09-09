/**
 * Kho thuê bao cinai — cái cầu giữa **một lượt mạng** và **bốn ổ cắm đồng bộ**.
 *
 * `index.ts` dựng ctx cho mọi lượt bootstrap RPC bằng các hàm không `await`
 * (`accessVerdict`, `currentPeriodUsage`). Hỏi cinapi ngay tại đó là buộc mỗi lượt bootstrap
 * chờ một vòng mạng — và app hỏi những lượt ấy liên tục. Nên: **đọc trả ngay từ kho, làm mới
 * chạy nền**. Lượt đầu của một người trả `null` (app không vẽ thanh nào, đúng hành vi cũ), lượt
 * sau đã có số.
 *
 * Vì sao ở đây CÓ kho trong khi `cinapi-danh-tinh.ts` cố ý KHÔNG có: cái nó giữ là một **token
 * của người dùng**, và cache token là chỗ một phiên đã bị thu hồi vẫn mở được cửa trong TTL. Kho
 * này giữ một **bản sao số liệu gói** — không phải giấy tờ, không mở được cửa nào — và khoá theo
 * `authId` chứ không theo token. Hai chuyện khác hẳn nhau.
 *
 * Ba tính chất giữ bằng hình dạng hàm:
 *
 *  1. **TẮT theo mặc định.** Thiếu `GROKBOT2_CINAPI_BASE` hoặc `GROKBOT2_CINAPI_SERVICE_TOKEN` thì
 *     mọi lượt trả `null` và **không mở socket nào** — đưa mã này lên là việc trơ.
 *  2. **Khoá ngắn không bật được**, đúng ngưỡng của phía Go (`minTokenLen = 24`). Một hằng số
 *     sống ở hai nơi thì sẽ lệch, nên nó được ghim bằng bài đo ở cả hai bên.
 *  3. **Một lượt bay mỗi người**, và một lượt hỏng KHÔNG xoá số cũ — thà vẽ số hơi cũ còn hơn
 *     thanh đo nhấp nháy mỗi lần mạng chớp.
 */
import { docThueBao, type ThueBao } from "./cinapi-thue-bao.js";
import { cinapiGoc, type Lay } from "./cinapi-danh-tinh.js";

/** Cùng ngưỡng với `minTokenLen` bên `internal/middleware/service.go` của cinapi. */
export const KHOA_TOI_THIEU = 24;

/** Bao lâu thì số được coi là cũ. 60 s: đủ để thanh đo nhúc nhích, đủ thưa để không thành lụt. */
export const TTL_MS = 60_000;

/** Trần chờ — có một con người đang nhìn màn hình phía sau lượt bootstrap này. */
export const TRAN_MS = 4000;

export function khoaDichVu(): string | null {
  const raw = (process.env.GROKBOT2_CINAPI_SERVICE_TOKEN ?? "").trim();
  return raw.length >= KHOA_TOI_THIEU ? raw : null;
}

/** `cinapi|<id>` → `<id>`. Danh tính khác (`auth0|…`, `local|…`) không có gói bên cinai. */
export function idCinapi(authId: string): string | null {
  const m = /^cinapi\|(.+)$/.exec((authId ?? "").trim());
  const id = m?.[1]?.trim();
  return id && !/[|\s]/.test(id) ? id : null;
}

interface O { tb: ThueBao | null; luc: number; dangBay: boolean }

export interface KhoTuyChon {
  lay?: Lay;
  goc?: string | null;
  khoa?: string | null;
  ttlMs?: number;
  now?: () => number;
}

export interface Kho {
  /** Đọc ĐỒNG BỘ. Cũ hay vắng thì tự hẹn một lượt làm mới, nhưng không chờ nó. */
  doc(authId: string): ThueBao | null;
  /** Cho bài đo và cho lúc đăng nhập: chờ lượt làm mới xong. */
  lamMoi(authId: string): Promise<ThueBao | null>;
  /** Số lượt đã bay — để bài đo chứng minh "không mở socket nào khi chưa bật". */
  soLuot(): number;
}

export function taoKho(tuyChon: KhoTuyChon = {}): Kho {
  const bang = new Map<string, O>();
  let luot = 0;
  const gio = () => (tuyChon.now ?? Date.now)();
  const ttl = tuyChon.ttlMs ?? TTL_MS;

  function batDuoc(): { goc: string; khoa: string } | null {
    const goc = tuyChon.goc !== undefined ? tuyChon.goc : cinapiGoc();
    const khoa = tuyChon.khoa !== undefined ? tuyChon.khoa : khoaDichVu();
    if (!goc || !khoa || khoa.length < KHOA_TOI_THIEU) return null;
    return { goc, khoa };
  }

  async function bay(authId: string, id: string, bat: { goc: string; khoa: string }): Promise<ThueBao | null> {
    const lay = tuyChon.lay ?? ((u, i) => fetch(u, i as RequestInit) as unknown as ReturnType<Lay>);
    const bo = new AbortController();
    const dongHo = setTimeout(() => bo.abort(), TRAN_MS);
    luot++;
    try {
      const r = await lay(`${bat.goc}/api/v1/internal/me/subscription`, {
        headers: {
          // Khoá đi trong HEADER, không bao giờ trong URL — cùng luật `cinapi-danh-tinh.ts`:
          // một URL thì rơi vào access log của nginx, một header thì không.
          "x-service-token": bat.khoa,
          "x-service-user-id": id,
          accept: "application/json",
        },
        signal: bo.signal,
      });
      if (!r.ok) return null;
      return docThueBao(await r.text());
    } catch {
      return null;
    } finally {
      clearTimeout(dongHo);
    }
  }

  function hen(authId: string): void {
    const o = bang.get(authId);
    if (o?.dangBay) return;                       // một lượt bay mỗi người
    const bat = batDuoc();
    const id = idCinapi(authId);
    if (!bat || !id) return;
    const moi: O = { tb: o?.tb ?? null, luc: o?.luc ?? 0, dangBay: true };
    bang.set(authId, moi);
    void bay(authId, id, bat).then((tb) => {
      // Lượt hỏng KHÔNG xoá số cũ: thà vẽ số hơi cũ còn hơn thanh đo nhấp nháy theo mạng.
      bang.set(authId, { tb: tb ?? moi.tb, luc: tb ? gio() : moi.luc, dangBay: false });
    });
  }

  return {
    doc(authId) {
      const o = bang.get(authId);
      if (!o || gio() - o.luc >= ttl) hen(authId);
      return o?.tb ?? null;
    },
    async lamMoi(authId) {
      const bat = batDuoc();
      const id = idCinapi(authId);
      if (!bat || !id) return null;
      const tb = await bay(authId, id, bat);
      const cu = bang.get(authId);
      bang.set(authId, { tb: tb ?? cu?.tb ?? null, luc: tb ? gio() : (cu?.luc ?? 0), dangBay: false });
      return tb;
    },
    soLuot: () => luot,
  };
}

/** Kho dùng chung của tiến trình. Bài đo dựng kho riêng bằng `taoKho`. */
export const khoThueBao: Kho = taoKho();
