export type NativeAgent = {
  id: string;
  name: string;
  description: string;
  unread: boolean;
  hidden: boolean;
  /** `/v1/agents` already sends these; declared so the row can show a timestamp like the stock app. */
  createdAtMs?: number;
  updatedAtMs?: number;
  /** Có ảnh avatar hay không, và bản nào. `null`/thiếu ⇒ dùng initials. */
  avatarVersion?: string | null;
  presence: { isRunning: boolean; currentActivity?: { kind: string; tool?: string } | null };
  lastEntry: { kind: string; text?: string } | null;
};

export type NativeWidgetOption = {
  label: string;
  value?: string;
  description?: string;
  style?: "default" | "primary" | "danger";
};

export type NativeEntry = {
  id: string;
  seq: number;
  timestampMs: number;
  kind: "message" | "agent-message" | "tool-call" | "event" | "widget";
  content?: string;
  author?: { id: string; name: string };
  name?: string;
  summary?: string;
  status?: "pending" | "running" | "done" | "failed";
  result?: string;
  toolCallId?: string;
  requestId?: string;
  needsApproval?: boolean;
  isStreaming?: boolean;
  event?: { type: string; from?: string; to?: string };
  attachment?: { path: string; name: string; href: string };
  widget?: { prompt: string; helpText?: string; options: NativeWidgetOption[]; allowCustom?: boolean };
  respondedValue?: string;
  /** Reaction đã đặt trên entry này. `by: "me"` là của chủ máy. */
  reactions?: { emoji: string; by: string }[];
};

/** Nhóm sidebar, đúng shape app gốc dùng. `__agents__` là mục catch-all. */
export type SidebarSection = { id: string; name: string; agentIds: string[] };

export type ComputerStatus = {
  agentId: string;
  state: "running" | "off";
  vncUrl?: string;
  /** Phân biệt "chưa cấu hình màn hình" với "đã cấu hình mà không ai đang dùng". */
  screenConfigured?: boolean;
};

let token = "";

const headers = (): HeadersInit => ({
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
});

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
