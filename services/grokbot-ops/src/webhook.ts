/**
 * Webhook của routine — `POST /hooks/automation/<automationId>`.
 *
 * Địa chỉ và khoá do `getAutomationWebhookCredential` phát ra; người dùng dán chúng vào một hệ
 * thống khác (Zapier, một job CI, một form) để hệ thống đó gọi routine chạy.
 *
 * Cửa này nằm ở ops chứ không ở BFF, giống Slack và GitHub: ops là tiến trình phơi ra ngoài, BFF
 * chỉ nghe loopback. Nhưng KHOÁ thì nằm ở BFF (trong sqlite), và ops không được đụng sqlite
 * (ADR-P4-2) — nên ops chỉ chuyển tiếp, còn việc so khoá làm ở BFF.
 *
 * Khác Slack/GitHub ở một điểm đáng nói: hai cái kia ký bằng bí mật của HỌ và phần xác thực còn là
 * TODO, nên chưa được phơi ra NIC công khai. Cửa này thì bí mật là của TA, đúc bằng
 * `randomBytes(32)` và so bằng `timingSafeEqual`, nên nó tự đứng được.
 */
const bffBase = (): string => (process.env.GROKBOT2_BFF_URL ?? "http://127.0.0.1:8788").replace(/\/$/, "");

export interface WebhookResult { status: number; body: unknown }

/** Thân yêu cầu dài bao nhiêu thì còn đưa vào lời nhắc. Dài hơn thì cắt — model không đọc hết một MB. */
const MAX_CONTEXT = 4000;

/**
 * Khoá nằm ở đâu trong yêu cầu.
 *
 * Nhận cả hai kiểu vì hai loại người gọi khác nhau: `Authorization: Bearer` là thứ một API client
 * viết ra theo phản xạ, còn `X-Webhook-Key` là thứ các bảng cấu hình webhook (Zapier, n8n) cho gõ
 * vào ô "custom header" mà không đụng tới ô Authorization.
 */
function keyOf(headers: Record<string, string | string[] | undefined>): string {
  const auth = String(headers["authorization"] ?? "");
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  if (m) return m[1].trim();
  const x = headers["x-webhook-key"];
  return String(Array.isArray(x) ? x[0] : x ?? "").trim();
}

/** `/hooks/automation/<id>` → id, hoặc "" nếu đường dẫn không phải dạng đó. */
export function automationIdFromPath(url: string): string {
  const path = url.split("?")[0] ?? "";
  const m = /^\/hooks\/automation\/([^/]+)\/?$/.exec(path);
  return m ? decodeURIComponent(m[1]) : "";
}

/**
 * Đoạn văn model sẽ đọc khi routine chạy.
 *
 * `context` đi kèm chứ không thay lời nhắc của routine: routine nói LÀM GÌ, còn đoạn này nói lần
 * này dữ liệu gì vừa tới.
 */
export function contextFrom(body: unknown, from: string): string {
  let data: string;
  try {
    data = typeof body === "string" ? body : JSON.stringify(body ?? {}, null, 2);
  } catch {
    data = "(không đọc được dữ liệu)";
  }
  const cut = data.length > MAX_CONTEXT ? `${data.slice(0, MAX_CONTEXT)}\n… (cắt bớt)` : data;
  return [
    "[Webhook] Một webhook vừa đánh thức bạn.",
    from ? `từ: ${from}` : "",
    "dữ liệu:",
    cut,
  ].filter(Boolean).join("\n");
}

export async function handleAutomationWebhook(
  url: string,
  headers: Record<string, string | string[] | undefined>,
  body: unknown,
): Promise<WebhookResult> {
  const automationId = automationIdFromPath(url);
  if (!automationId) return { status: 404, body: { error: "not found" } };

  const key = keyOf(headers);
  // Không có khoá thì dừng ngay tại ops. Chuyển tiếp một yêu cầu trống chỉ tốn một vòng tới BFF để
  // nhận về đúng câu trả lời này.
  if (!key) return { status: 401, body: { error: "thiếu khoá webhook (Authorization: Bearer …)" } };

  const from = String(headers["user-agent"] ?? "").slice(0, 120);
  let r: Response;
  try {
    r = await fetch(`${bffBase()}/internal/ops/fire-webhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ automationId, key, context: contextFrom(body, from) }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    // 502 chứ không phải 500: người gọi không làm gì sai, BFF mới là bên không với tới được. Nhiều
    // hệ thống webhook thử lại 5xx, và đây đúng là trường hợp đáng thử lại.
    return { status: 502, body: { error: `không gọi được BFF: ${(e as Error).message}` } };
  }
  const j = await r.json().catch(() => ({})) as { reason?: string };
  if (r.status === 200) return { status: 200, body: { ok: true, fired: 1 } };
  // Chuyển nguyên mã của BFF ra ngoài — 401 sai khoá, 404 không có routine, 409 routine đang tắt.
  // Gộp cả ba thành một mã là bắt người ta ngồi đoán vì sao webhook im.
  return { status: r.status, body: { ok: false, reason: j.reason ?? "không rõ" } };
}
