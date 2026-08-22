/**
 * Cầu nối `/v1`.
 *
 * Kiểu đến từ `@grokbot2/api-contract` bằng `import type` — **không một byte runtime nào** vào
 * bundle. Trước đây file này tự khai lại `NativeAgent`/`NativeEntry`/`ComputerStatus` như một tập
 * con đoán được, và đã lệch với BE ở 6 chỗ (xem đầu `packages/api-contract/src/v1.ts`). Tự khai lại
 * thì thêm trường ở BE là FE không bao giờ thấy, còn bỏ trường thì FE hỏng lúc chạy — không hỏng
 * lúc typecheck.
 *
 * Tên `Native*` giữ nguyên để không phải sửa `main.ts` theo.
 */
import type {
  Agent as NativeAgent,
  ComputerStatus,
  Entry as NativeEntry,
  SidebarSection,
  Widget as NativeWidget,
  WidgetOption as NativeWidgetOption,
} from "@grokbot2/api-contract";

export type { NativeAgent, NativeEntry, NativeWidget, NativeWidgetOption, ComputerStatus, SidebarSection };

// Persisted so a reload keeps the account signed in (multi-tenant Phase 4). The token is a signed
// user JWT from /v1/login; every /v1 call carries it, and the backend derives the owner from it.
let token = localStorage.getItem("grokbot2.token") ?? "";
let sessionEmail = localStorage.getItem("grokbot2.email") ?? "";

const headers = (): HeadersInit => ({
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
});

export const hasSession = (): boolean => token.length > 0;
export const currentEmail = (): string => sessionEmail;

function setSession(t: string, email: string): void {
  token = t;
  sessionEmail = email;
  localStorage.setItem("grokbot2.token", t);
  localStorage.setItem("grokbot2.email", email);
}

function clearSession(): void {
  token = "";
  sessionEmail = "";
  localStorage.removeItem("grokbot2.token");
  localStorage.removeItem("grokbot2.email");
}

async function credential(path: "/v1/login" | "/v1/register", email: string, password: string): Promise<void> {
  const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  const j = await parse<{ token: string; email: string }>(r);
  setSession(j.token, j.email);
}

export const loginAccount = (email: string, password: string) => credential("/v1/login", email, password);
export const registerAccount = (email: string, password: string) => credential("/v1/register", email, password);

export async function logout(): Promise<void> {
  try { await fetch("/v1/logout", { method: "POST", headers: headers() }); } catch { /* stateless — clearing locally is enough */ }
  clearSession();
}

async function parse<T>(r: Response): Promise<T> {
  if (r.status === 204) return undefined as T;
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? `HTTP ${r.status}`);
  return j as T;
}

export async function login(): Promise<void> {
  const r = await fetch("/v1/session");
  const j = await parse<{ token: string }>(r);
  token = j.token;
}

export const health = () => fetch("/v1/health").then((r) => parse<{ ok: boolean; isBusy: boolean }>(r));
export const listAgents = (includeHidden = false) =>
  fetch(`/v1/agents${includeHidden ? "?includeHidden=1" : ""}`, { headers: headers() }).then((r) => parse<NativeAgent[]>(r));
export const createAgent = (name: string) =>
  fetch("/v1/agents", { method: "POST", headers: headers(), body: JSON.stringify({ name }) })
    .then((r) => parse<{ agent: NativeAgent }>(r));
export const deleteAgent = (id: string) => fetch(`/v1/agents/${id}`, { method: "DELETE", headers: headers() }).then(parse);
export const patchAgent = (id: string, body: { name?: string; hidden?: boolean; description?: string }) =>
  fetch(`/v1/agents/${id}`, { method: "PATCH", headers: headers(), body: JSON.stringify(body) })
    .then((r) => parse<NativeAgent>(r));
export const renameAgent = (id: string, name: string) => patchAgent(id, { name });
export const hideAgent = (id: string, hidden: boolean) => patchAgent(id, { hidden });
export const getTranscript = (id: string) =>
  fetch(`/v1/agents/${id}/transcript`, { headers: headers() }).then((r) => parse<{ entries: NativeEntry[] }>(r));
export const sendTurn = (id: string, content: string, clientNonce: string, attachments?: { path: string; name?: string }[]) =>
  fetch(`/v1/agents/${id}/turns`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ content, clientNonce, ...(attachments?.length ? { attachments } : {}) }),
  }).then((r) => parse<{ entryId: string; seq: number; status: string }>(r));

export const uploadImage = (filename: string, bytesBase64: string) =>
  fetch("/v1/attachments", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ filename, bytesBase64 }),
  }).then((r) => parse<{ path: string; fileName: string; href: string; mime: string; width: number; height: number }>(r));
export const interruptTurn = (id: string) =>
  fetch(`/v1/agents/${id}/turns/current`, { method: "DELETE", headers: headers() }).then(parse);
export const getComputer = (id: string) =>
  fetch(`/v1/agents/${id}/computer`, { headers: headers() }).then((r) => parse<ComputerStatus>(r));
export const sidebarSections = () =>
  fetch("/v1/host/sidebar", { headers: headers() }).then((r) => parse<{ sections: SidebarSection[] }>(r));
export const resolvePermission = (id: string, requestId: string, approved: boolean) =>
  fetch(`/v1/agents/${id}/permissions`, { method: "POST", headers: headers(), body: JSON.stringify({ requestId, approved }) })
    .then(parse);
/**
 * Toggle một reaction. Cùng ngữ nghĩa với lệnh `reactToMessage` của hãng: gửi lại đúng emoji đó
 * là bỏ nó. Trả về entry sau khi đổi, nên không cần tải lại cả transcript để biết kết quả.
 */
export const reactToEntry = (agentId: string, entryId: string, emoji: string) =>
  fetch(`/v1/agents/${agentId}/entries/${encodeURIComponent(entryId)}/reactions`, {
    method: "POST", headers: headers(), body: JSON.stringify({ emoji }),
  }).then((r) => parse<NativeEntry>(r));

export const respondToWidget = (id: string, entryId: string, value: string) =>
  fetch(`/v1/agents/${id}/widgets`, { method: "POST", headers: headers(), body: JSON.stringify({ entryId, value }) })
    .then(parse);

export async function listenEvents(onEvent: (name: string, data: unknown) => void, signal: AbortSignal): Promise<void> {
  const r = await fetch("/v1/events", { headers: headers(), signal });
  if (!r.ok || !r.body) throw new Error(`events HTTP ${r.status}`);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (!signal.aborted) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const block of parts) {
      let event = "message";
      const dataLines: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (!dataLines.length) continue;
      try { onEvent(event, JSON.parse(dataLines.join("\n"))); } catch { /* keep-alive / comment */ }
    }
  }
}

// ── avatar ────────────────────────────────────────────────────────────────────
//
// `<img src>` không gửi được header `Authorization`, nên không trỏ thẳng
// `/v1/agents/:id/avatar` vào `src` được — làm vậy chỉ có hai lối ra, đều tệ: mở route cho vô
// danh, hoặc nhét token vào URL (rồi nó vào history, vào log). Thay vào đó tải bằng `fetch` có
// bearer rồi giữ một object URL.
//
// Khoá cache là `id@version`: đổi ảnh là đổi version, nên cache tự hết hạn.

const avatarUrls = new Map<string, string>();

/** Object URL đã có, hoặc `undefined` nếu chưa tải. Không gọi mạng. */
export function cachedAvatar(id: string, version?: string | null): string | undefined {
  return version ? avatarUrls.get(`${id}@${version}`) : undefined;
}

export async function loadAvatar(id: string, version: string): Promise<string | null> {
  const key = `${id}@${version}`;
  const hit = avatarUrls.get(key);
  if (hit) return hit;
  const r = await fetch(`/v1/agents/${id}/avatar?v=${encodeURIComponent(version)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  const url = URL.createObjectURL(await r.blob());
  // Bản cũ của cùng bot không còn ai trỏ tới nữa; không thu hồi thì mỗi lần đổi ảnh rò một blob.
  for (const [k, u] of avatarUrls) {
    if (k.startsWith(`${id}@`)) { URL.revokeObjectURL(u); avatarUrls.delete(k); }
  }
  avatarUrls.set(key, url);
  return url;
}

export const putAvatar = (id: string, dataUrl: string) =>
  fetch(`/v1/agents/${id}/avatar`, { method: "PUT", headers: headers(), body: JSON.stringify({ dataUrl }) })
    .then((r) => parse<NativeAgent>(r));

export const deleteAvatar = (id: string) =>
  fetch(`/v1/agents/${id}/avatar`, { method: "DELETE", headers: headers() }).then((r) => parse<void>(r));
