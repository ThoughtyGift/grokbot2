/**
 * Kênh cập nhật của app local — máy chủ trả lời "có bản mới không".
 *
 * Client (đã vá `update-feed`) hỏi đúng một đường, hình dạng lấy từ `buildUpdateRequestUrl` trong
 * `electron-main` 0.30:
 *
 *     GET /updates/api/update/{nền}/{tênKênh}/{phiênBảnĐangChạy}/{máy}/stable
 *
 * Trả lời chỉ có hai dạng — trích từ `fetchUpdate` + schema zod của client:
 *
 *     204 No Content                      → "không có gì mới" (đường đi 99% thời gian)
 *     { url, version, sha256hash? }       → Windows (`iupdate`): tải .exe rồi cài lúc thoát
 *     { url, name }                       → macOS (`squirrel`): tải .zip
 *
 * Sai schema là client ném `feed_malformed`; sai `sha256hash` là nó bỏ gói đã tải. Nên trả THIẾU
 * còn hơn trả bừa.
 *
 * ── Điều quan trọng nhất về file này ──────────────────────────────────────────────────────────
 *
 * Nó đọc **manifest**, không đọc kho code. Sửa code, xoá tính năng, commit hỏng rồi sửa lại — không
 * dòng nào ở đây đổi. Chỉ khi `phat-hanh.mjs` ghi manifest thì máy người dùng mới thấy banner. Đó
 * là toàn bộ điểm của thiết kế: `docs/plan/quy-trinh-phat-hanh-app-local.md`.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { dataDir } from "./store.js";

/** Ba kênh của client (`appNameForTrack`): stable→sand · nightly→sand-nightly · dogfood→sand-dogfood. */
const KENH: Record<string, string> = { sand: "stable", "sand-nightly": "nightly", "sand-dogfood": "dogfood" };

export interface BanPhatHanh {
  version: string;
  url: string;
  sha256hash?: string;
  /** macOS dùng `name` thay cho `version` trong phản hồi (schema squirrel). */
  name?: string;
}

/** Đường tới manifest. Env cho phép trỏ chỗ khác khi chạy test hoặc khi VPS để nơi riêng. */
export const manifestPath = (): string =>
  process.env.GROKBOT2_RELEASE_MANIFEST ?? join(dataDir(), "phat-hanh.json");

/** Toàn bộ manifest, hoặc `{}` khi chưa phát hành lần nào. Hỏng cú pháp cũng coi như chưa có. */
export function docManifest(): Record<string, BanPhatHanh> {
  const p = manifestPath();
  if (!existsSync(p)) return {};
  try {
    const j = JSON.parse(readFileSync(p, "utf8")) as Record<string, BanPhatHanh>;
    return j && typeof j === "object" ? j : {};
  } catch {
    // Manifest hỏng = không phát hành gì, KHÔNG phải phát bừa bản gần nhất.
    console.warn(`[grokbot2] update-feed: manifest hỏng, coi như chưa phát hành: ${p}`);
    return {};
  }
}

/**
 * So hai chuỗi phiên bản kiểu `0.29.3`.
 *
 * Không dùng so sánh chuỗi: `"0.29.10" < "0.29.9"` theo thứ tự chữ, nên một bản vá thứ mười sẽ
 * không bao giờ được phát. Cắt phần hậu tố (`-beta.1`) rồi so từng số.
 */
export function moiHon(a: string, b: string): boolean {
  const so = (v: string) => v.split("-")[0].split(".").map((x) => Number.parseInt(x, 10) || 0);
  const [x, y] = [so(a), so(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

export interface KetQua {
  status: 204 | 200 | 400;
  body?: BanPhatHanh;
}

/**
 * Quyết định trả gì cho một lượt hỏi.
 *
 * Tách khỏi phần HTTP để test được mà không cần dựng server — và vì đây là chỗ DUY NHẤT quyết định
 * ai thấy banner, nó xứng đáng có test riêng.
 */
export function traLoi(duong: string): KetQua {
  // /updates/api/update/{nền}/{tênKênh}/{ver}/{máy}/stable
  const m = /^\/updates\/api\/update\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(duong);
  if (!m) return { status: 400 };
  const [, nen, tenKenh, verDangChay] = m;
  const kenh = KENH[tenKenh];
  if (!kenh) return { status: 400 };

  const ban = docManifest()[kenh];
  if (!ban?.version || !ban?.url) return { status: 204 };
  if (!moiHon(ban.version, verDangChay)) return { status: 204 };

  // macOS chờ `{url, name}`; Windows chờ `{url, version, sha256hash?}`. Trả đúng hình dạng của nền
  // đang hỏi, vì client kiểm bằng zod và một trường thừa/thiếu là `feed_malformed`.
  return nen.startsWith("darwin")
    ? { status: 200, body: { url: ban.url, name: ban.name ?? ban.version, version: ban.version } }
    : { status: 200, body: { url: ban.url, version: ban.version, ...(ban.sha256hash ? { sha256hash: ban.sha256hash } : {}) } };
}
