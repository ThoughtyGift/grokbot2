/**
 * Nói chuyện với MCP server ở xa qua HTTP — hai phương ngữ, một đường vào.
 *
 * STREAMABLE HTTP (2025-03-26 trở đi), mặc định:
 *   - POST kèm `accept: application/json, text/event-stream`; server tự chọn trả kiểu nào.
 *   - Trả lời có thể là một object JSON, hoặc một luồng SSE nhiều object — server nào muốn báo tiến
 *     độ trước khi ra kết quả thì chọn luồng.
 *   - `Mcp-Session-Id` về ở `initialize` và phải lặp lại ở mọi request sau.
 *   - Thông báo (không `id`) được đáp 202 và không có thân, nên không có gì để giao.
 *
 * HTTP+SSE CŨ (2024-11-05): hai đầu mối. GET vào URL, giữ luồng đó mở, đọc sự kiện đầu tiên
 * `event: endpoint` để biết URL THỨ HAI; POST vào đó và nhận 202, còn trả lời thật thì chảy về theo
 * luồng vẫn đang mở. Vào nhánh này khi cấu hình ghi `"type": "sse"`, hoặc khi gặp 404/405 — đó là
 * thứ một server cũ đáp lại khi bị POST kiểu Streamable HTTP.
 *
 * 401 được báo đúng như nó là. Server ở xa quảng cáo OAuth qua `WWW-Authenticate`, và lặp lại header
 * đó chính là chỉ ra cách sửa; đoán một token ở đây chỉ đẻ ra một lỗi thứ hai mơ hồ hơn.
 *
 * Tách khỏi `mcp.ts` vì đây là **giao thức**, còn bên kia là **vòng đời server**: hai thứ đổi vì hai
 * lý do khác nhau, và gộp lại thì mcp.ts vượt 800 dòng.
 */
import { MCP_PROTOCOL_VERSION, START_TIMEOUT_MS, CALL_TIMEOUT_MS, type Transport } from "./mcp-shared.js";

/** Trạng thái đổi được của một phiên HTTP. Gom lại để các hàm dưới nhận đúng một chỗ để sửa. */
interface Session {
  readonly name: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly deliver: (msg: any) => void;
  readonly failAll: (why: string) => void;
  /** Nhận lý do khi gặp 401, và nhận `null` ngay khi một request thành công. */
  readonly onAuth: (why: string | null) => void;
  readonly legacyAbort: AbortController;
  sessionId: string | null;
  negotiated: string | null;
  closed: string | null;
  mode: "unknown" | "streamable" | "legacy";
  postUrl: string;
  legacyReady: Promise<void> | null;
}

/**
 * Mở đầu bằng phương ngữ nào.
 *
 * `"type": "sse"` trong cấu hình là nói thẳng. Không có thì một đường dẫn tận cùng `/sse` là quy ước
 * mọi server cũ đều theo (supergateway, mcp-proxy, và những server viết trước khi transport bị thay)
 * — đoán theo nó là đáng, vì phép rơi-về 404/405 bên dưới **không đủ tin**: đo với supergateway, một
 * POST vào `/sse` của nó không trả lời cũng không từ chối — nó treo, nên chẳng có mã nào để phản ứng.
 */
function openingMode(url: string, typeHint: string | undefined): "unknown" | "legacy" {
  const looksLegacy = /sse/i.test(typeHint ?? "") || /\/sse\/?$/i.test(new URL(url).pathname);
  return looksLegacy ? "legacy" : "unknown";
}

function unauthorized(s: Session, res: Response): Error {
  const how = res.headers.get("www-authenticate");
  s.onAuth(how ?? "The server requires authentication (401)");
  return new Error(
    `MCP server "${s.name}" refused the request (401)` +
    (how ? ` — it wants OAuth: ${how}` : "") +
    ". Set its credential in the plugin setup, or give it an Authorization header.",
  );
}

/**
 * Đọc thân SSE, giao từng sự kiện trọn vẹn cho `on`.
 *
 * Cả hai phương ngữ đều cần, nhưng với hai khoảng thời gian khác nhau: Streamable HTTP dùng cho một
 * lần trả lời, bản cũ dùng cho cả phiên — nên **tên sự kiện** ở đây mới có nghĩa, còn trước thì không.
 */
async function readSse(res: Response, on: (event: string, data: string) => void): Promise<void> {
  const reader = res.body?.getReader();
  if (!reader) return;
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let sep: number;
    // Sự kiện cách nhau bằng một dòng trống; CRLF cũng hợp lệ.
    while ((sep = buf.search(/\r?\n\r?\n/)) !== -1) {
      const raw = buf.slice(0, sep);
      buf = buf.slice(sep).replace(/^\r?\n\r?\n/, "");
      const lines = raw.split(/\r?\n/);
      const event = lines.find((l) => l.startsWith("event:"))?.slice(6).trim() || "message";
      const data = lines.filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
      if (data) on(event, data);
    }
  }
}

/** Mở luồng của phương ngữ cũ, và chỉ hoàn tất khi nó đã nói ra đầu mối để POST. */
function openLegacyStream(s: Session): Promise<void> {
  if (s.legacyReady) return s.legacyReady;
  s.legacyReady = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`MCP server "${s.name}" sent no endpoint event`)),
      START_TIMEOUT_MS,
    );
    void (async () => {
      try {
        const res = await fetch(s.url, {
          headers: { accept: "text/event-stream", ...s.headers },
          signal: s.legacyAbort.signal,
        });
        if (res.status === 401) { clearTimeout(timer); reject(unauthorized(s, res)); return; }
        if (!res.ok) { clearTimeout(timer); reject(new Error(`MCP server "${s.name}" answered HTTP ${res.status}`)); return; }
        // Chạy suốt đời phiên: mọi câu trả lời đi về theo luồng này.
        await readSse(res, (event, data) => {
          if (event === "endpoint") {
            // Thường là đường dẫn tương đối có mang session id, nên phải nối vào base.
            s.postUrl = new URL(data, s.url).toString();
            clearTimeout(timer);
            resolve();
            return;
          }
          try { s.deliver(JSON.parse(data)); } catch { /* chú thích hoặc keep-alive */ }
        });
        if (!s.closed) s.failAll(`MCP server "${s.name}" closed the stream`);
      } catch (e) {
        clearTimeout(timer);
        reject(e as Error);
      }
    })();
  });
  return s.legacyReady;
}

/** POST của phương ngữ cũ: chỉ cần được nhận, câu trả lời về theo luồng đang mở. */
async function postLegacy(s: Session, msg: any): Promise<void> {
  await openLegacyStream(s);
  const res = await fetch(s.postUrl, {
    method: "POST",
    headers: { "content-type": "application/json", ...s.headers },
    body: JSON.stringify(msg),
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  if (res.status === 401) throw unauthorized(s, res);
  if (!res.ok) throw new Error(`MCP server "${s.name}" answered HTTP ${res.status}`);
}

/** POST kiểu Streamable HTTP. Trả `"retry-legacy"` khi hoá ra server này thuộc đời cũ. */
async function postStreamable(s: Session, msg: any): Promise<"done" | "retry-legacy"> {
  const res = await fetch(s.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(s.sessionId ? { "mcp-session-id": s.sessionId } : {}),
      ...(s.negotiated ? { "mcp-protocol-version": s.negotiated } : {}),
      ...s.headers,
    },
    body: JSON.stringify(msg),
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });

  // Server đời cũ không có route POST nào cả. Đổi phương ngữ một lần rồi gửi lại tin này.
  if ((res.status === 404 || res.status === 405) && s.mode === "unknown") {
    s.mode = "legacy";
    return "retry-legacy";
  }
  s.mode = "streamable";

  const sid = res.headers.get("mcp-session-id");
  if (sid) s.sessionId = sid;

  if (res.status === 401) throw unauthorized(s, res);
  if (res.ok) s.onAuth(null);   // chuyện gì sai với giấy tờ thì giờ không sai nữa
  if (res.status === 202 || res.status === 204) return "done";   // thông báo được nhận, không có thân
  if (!res.ok) throw new Error(`MCP server "${s.name}" answered HTTP ${res.status}`);

  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("text/event-stream")) {
    await readSse(res, (_e, data) => { try { s.deliver(JSON.parse(data)); } catch { /* keep-alive */ } });
    return "done";
  }

  const text = (await res.text()).trim();
  if (!text) return "done";
  // Server có thể gộp nhiều câu trả lời vào một mảng.
  for (const m of ((b) => (Array.isArray(b) ? b : [b]))(JSON.parse(text))) s.deliver(m);
  return "done";
}

async function post(s: Session, msg: any): Promise<void> {
  if (s.mode === "legacy") return postLegacy(s, msg);
  if (await postStreamable(s, msg) === "retry-legacy") return post(s, msg);
}

export function httpTransport(
  name: string,
  url: string,
  headers: Record<string, string>,
  typeHint: string | undefined,
  deliver: (msg: any) => void,
  failAll: (why: string) => void,
  onAuth: (why: string | null) => void,
): Transport {
  const s: Session = {
    name, url, headers, deliver, failAll, onAuth,
    // Luồng GET của bản cũ mở suốt phiên, nên lúc đóng phải cắt được nó. Thiếu cái này thì bộ đọc
    // giữ event loop sống và tiến trình không bao giờ thoát — đó là cách nó lộ ra: bài kiểm
    // transport xanh rồi treo cho tới khi bộ chạy giết đi.
    legacyAbort: new AbortController(),
    sessionId: null,
    negotiated: null,
    closed: null,
    mode: openingMode(url, typeHint),
    postUrl: url,
    legacyReady: null,
  };

  return {
    kind: "http",
    send: (msg) => {
      const method = (msg as { method?: string })?.method;
      // Bắn-rồi-quên, y như lần ghi vào ống mà nó thay thế. Một lỗi ở tầng vận chuyển phải thành lỗi
      // của ĐÚNG lời gọi này, nếu không `rpc` sẽ ngồi tới hết giờ mà không có gì để báo.
      void post(s, msg).catch((e: Error) => {
        const id = (msg as { id?: number })?.id;
        if (id == null) return;                    // là thông báo: không ai đang chờ
        deliver({ id, error: { message: e.message } });
      });
      if (method === "initialize") s.negotiated = MCP_PROTOCOL_VERSION;
    },
    close: () => {
      s.closed = "Closed";
      s.legacyAbort.abort();          // cắt cái GET dài hơi, nếu phiên này có mở
      const sid = s.sessionId;
      if (!sid) return;
      // Cố gắng thôi: báo server biết phiên đã xong để nó giải phóng.
      void fetch(url, { method: "DELETE", headers: { "mcp-session-id": sid, ...headers } }).catch(() => {});
      failAll(`MCP server "${name}" closed`);
    },
    dead: () => s.closed,
  };
}
