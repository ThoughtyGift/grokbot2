/**
 * Directory (roster) — agents in the sidebar. Preview text comes from conversation.lastEntryOf,
 * not by walking tool-call internals here.
 */
import { closeAgentTab } from "../browser.js";
import { dropAgentProfile } from "../displays.js";
import { publish } from "../events.js";
import { AUTH_ID } from "../identity/index.js";
import { currentOwner } from "../request-context.js";
import {
  agents, transcripts, inflight, persist, EPOCH, automationCleanupRef, nextAgentId,
} from "../chat/state.js";
import { lastEntryOf, transcriptContains, pushTranscriptEvent } from "../conversation/index.js";
import type { AgentRecord, RosterRow } from "../conversation/types.js";

export const rosterChanged = (agentId?: string): void => publish({ type: "agent.upserted", agentId });

let rosterSeq = 0;
export const nextRosterOrdered = () => ({ replicaKey: "roster", epoch: EPOCH, sequence: ++rosterSeq });
export const peekRosterSeq = () => rosterSeq;

export function setPresence(agentId: string, patch: Partial<Pick<AgentRecord, "isRunning" | "isComposingMessage" | "isRetrying" | "currentActivity" | "awaitingUserResponse">>): void {
  const rec = agents.get(agentId);
  if (!rec) return;
  const bag = rec as unknown as Record<string, unknown>;
  let changed = false;
  for (const [k, v] of Object.entries(patch)) {
    if (bag[k] !== v) { bag[k] = v; changed = true; }
  }
  if (changed) { rosterChanged(agentId); persist(); }
}

function summarise(a: AgentRecord): RosterRow {
  const t = transcripts.get(a.id);
  const updatedAt = t?.length ? t[t.length - 1].timestampMs : a.createdAtMs;
  const lastEntry = lastEntryOf(a.id);
  const t2 = transcripts.get(a.id);
  const last = t2?.length ? t2[t2.length - 1] : null;
  return {
    ...a,
    updatedAt,
    snapshotEpoch: EPOCH,
    snapshotSeq: rosterSeq,
    description: a.description ?? "",
    ...(a.description ? { purpose: a.description } : {}),
    path: `/agents/${a.id}`,
    createdAt: a.createdAtMs,
    hasUnread: a.unread === true,
    notificationsEnabled: a.notificationsEnabled === true,
    notifyOnUpdatesEnabled: a.notifyOnUpdates !== false,
    isGroup: false,
    origin: "user",
    lastMessageId: last ? last.id : null,
    awaitingUserResponse: a.awaitingUserResponse ?? null,
    memberIds: [],
    conversationPartnerIds: [],
    lastEntry: lastEntry ?? null,
    isRunningTurn: a.isRunning === true,
  };
}

/**
 * Multi-tenant Phase 2: does this agent belong to the caller? Rows created before Phase 1/2 (and
 * every row on the single-tenant desktop) carry `agentOwnerAuthId = AUTH_ID`, which equals the
 * default `currentOwner()`, so the desktop keeps seeing all of its agents unchanged.
 */
const ownedByCaller = (a: AgentRecord): boolean => (a.agentOwnerAuthId ?? AUTH_ID) === currentOwner();

/** The record for `id`, but only if the caller owns it — command mutators resolve through this so
 *  one tenant cannot rename/hide/duplicate another's agent by id. Background callers (setPresence,
 *  the turn) keep using `agents.get` directly; they run outside a request and are not user-driven. */
const ownedRec = (id: string): AgentRecord | undefined => {
  const a = agents.get(id);
  return a && ownedByCaller(a) ? a : undefined;
};

export const agentById = (id: string): AgentRecord | undefined => {
  const a = agents.get(id);
  return a && ownedByCaller(a) ? summarise(a) : undefined;
};

/**
 * The owner of an agent, IGNORING the caller's scope — for the SSE hub (Phase 3), which routes each
 * event to its agent's owner and runs outside any request. Undefined if the agent does not exist.
 */
export const ownerOf = (id: string): string | undefined => {
  const a = agents.get(id);
  return a ? (a.agentOwnerAuthId ?? AUTH_ID) : undefined;
};

export const listAgents = (): RosterRow[] =>
  [...agents.values()].filter((a) => !a.hidden && ownedByCaller(a)).map(summarise);
export const countAgents = (): number => listAgents().length;

export const listAllAgents = (): RosterRow[] => [...agents.values()].filter(ownedByCaller).map(summarise);

export function createAgent(args: { name?: string; profile?: { name?: string }; displayName?: string; description?: string } = {}): AgentRecord {
  const wanted = args.name ?? args.profile?.name ?? args.displayName;
  const id = nextAgentId();
  const rec: AgentRecord = {
    id, name: wanted?.trim() || "Claude", agentOwnerAuthId: currentOwner(), createdAtMs: Date.now(), unread: false, hidden: false,
    isRunning: false, isComposingMessage: false, isRetrying: false, currentActivity: null,
    ...(typeof args.description === "string" ? { description: args.description } : {}),
  };
  agents.set(id, rec); transcripts.set(id, []); persist();
  rosterChanged(id);
  return rec;
}

/**
 * Tạo một nhóm — một hội thoại có nhiều bot cùng ngồi.
 *
 * Trước đây `createGroup` trả `null`, nghĩa là nút "New group" trong app **im lặng không làm gì**:
 * client đọc `Ge.agent.id` từ câu trả lời, và `null.agent` thì hội thoại mới không bao giờ mở ra.
 *
 * Nhóm là một `AgentRecord` mang `isGroup` + `memberIds`, không phải một bảng riêng — đó là hình
 * dạng client đã đọc sẵn (`n.isGroup`, `rows.find(...).memberIds`). Thêm bảng là thêm một chỗ để
 * lệch với roster.
 *
 * Chỉ nhận thành viên mà **người gọi sở hữu**: `memberAgentIds` đến từ client, và một id của người
 * khác lọt vào đây là kéo bot của họ vào phòng của mình.
 */
export function createGroup(
  a: { name?: string; description?: string; memberAgentIds?: string[]; memberIds?: string[] } = {},
): AgentRecord {
  const wanted = (a.memberAgentIds ?? a.memberIds ?? []).filter((id) => ownedRec(id) != null);
  const rec = createAgent({ name: a.name || "Nhóm mới", ...(a.description ? { description: a.description } : {}) });
  rec.isGroup = true;
  rec.memberIds = [...new Set(wanted)];
  persist(); rosterChanged(rec.id);
  return rec;
}

/**
 * Đổi danh sách thành viên. `null` khi không phải nhóm của người gọi — client khai
 * `reply:"record-or-null"` nên `null` là câu trả lời hợp lệ, không phải lỗi.
 */
export function setGroupMembers(
  a: { id?: string; agentId?: string; memberAgentIds?: string[]; memberIds?: string[] } = {},
): AgentRecord | null {
  const rec = ownedRec(a.id ?? a.agentId ?? "");
  if (!rec) return null;
  const wanted = (a.memberAgentIds ?? a.memberIds ?? []).filter((id) => ownedRec(id) != null && id !== rec.id);
  rec.isGroup = true;
  rec.memberIds = [...new Set(wanted)];
  persist(); rosterChanged(rec.id);
  return rec;
}

export function updateAgent(
  a: { id?: string; agentId?: string; name?: string; description?: string; profile?: { name?: string; description?: string } },
): AgentRecord | null {
  const rec = ownedRec(a.id ?? a.agentId ?? ""); if (!rec) return null;
  const name = a.profile?.name ?? a.name;
  const description = a.profile?.description ?? a.description;
  if (typeof description === "string") rec.description = description;
  if (typeof name === "string" && name.length > 0 && name !== rec.name) {
    pushTranscriptEvent(rec.id, { type: "name-changed", from: rec.name, to: name });
    rec.name = name;
  }
  persist(); rosterChanged(rec.id); return rec;
}

export function deleteAgents(a: { ids?: string[]; agentIds?: string[]; id?: string }): { deleted: string[] } {
  // Multi-tenant Phase 2: only delete agents the caller owns; silently skip the rest.
  const ids = (a.ids ?? a.agentIds ?? (a.id ? [a.id] : [])).filter((id) => ownedRec(id) != null);
  for (const id of ids) {
    agents.delete(id); transcripts.delete(id); inflight.get(id)?.abort(); inflight.delete(id);
    void closeAgentTab(id);
    // Hồ sơ Chrome của bot sống NGOÀI slot (để phiên đăng nhập không chết mỗi lần thu màn), nên
    // xoá bot mà quên nó là để lại ~57 MB không ai nhìn thấy.
    void dropAgentProfile(id);
    automationCleanupRef?.(id);
  }
  persist(); rosterChanged(); return { deleted: ids };
}

export function duplicateAgent(a: { id?: string; agentId?: string }): AgentRecord | null {
  const src = ownedRec(a.id ?? a.agentId ?? ""); if (!src) return null;
  const rec = createAgent({ name: `${src.name} (copy)` });
  transcripts.set(rec.id, structuredClone(transcripts.get(src.id) ?? []));
  persist(); return rec;
}

export function setAgentUnread(a: { id?: string; agentId?: string; unread?: boolean; isUnread?: boolean }): Record<string, never> {
  const rec = ownedRec(a.id ?? a.agentId ?? ""); if (rec) rec.unread = a.isUnread ?? a.unread ?? false; persist(); rosterChanged(a.id ?? a.agentId); return {};
}
/**
 * Ba setter dưới đây từng mặc định `?? true`, tức **gọi thiếu cờ là BẬT**.
 *
 * Với `setAgentHiddenFromSidebar` điều đó nghĩa là một lời gọi thiếu cờ — hoặc gửi key tên khác
 * (`hiddenFromSidebar`, `isHiddenFromSidebar`) — sẽ **ẩn bot** trong im lặng. Ngày 2026-08-22 sáu
 * bot thật của chủ máy bị `hidden: true` và cả hai UI chỉ còn hiện một bot; không truy được lời
 * gọi nào, nhưng một setter mặc định BẬT là loại lỗi không nên tồn tại để phải truy.
 *
 * Bỏ default là an toàn với app gốc: nó **luôn** gửi cờ tường minh — đo trong renderer,
 * `setAgentHiddenFromSidebar({id, isHidden: <bool>})` ở cả ba call site. Thiếu cờ giờ là **không
 * đổi gì**, vì "setter được gọi mà không có giá trị" là lỗi của người gọi, không phải ý muốn bật.
 */
const boolArg = (...vals: unknown[]): boolean | null => {
  for (const v of vals) if (typeof v === "boolean") return v;
  return null;
};

export function setAgentHiddenFromSidebar(a: { id?: string; agentId?: string; hidden?: boolean; isHidden?: boolean }): Record<string, never> {
  const rec = ownedRec(a.id ?? a.agentId ?? "");
  const next = boolArg(a.isHidden, a.hidden);
  if (rec && next != null) { rec.hidden = next; persist(); rosterChanged(a.id ?? a.agentId); }
  else if (rec) console.warn(`[directory] setAgentHiddenFromSidebar(${rec.id}) không có cờ boolean — không đổi gì`);
  return {};
}
export function setAgentNotificationsEnabled(a: { id?: string; agentId?: string; enabled?: boolean; isEnabled?: boolean }): Record<string, never> {
  const rec = ownedRec(a.id ?? a.agentId ?? "");
  const next = boolArg(a.isEnabled, a.enabled);
  if (rec && next != null) { rec.notificationsEnabled = next; persist(); rosterChanged(a.id ?? a.agentId); }
  return {};
}
export function setAgentNotifyOnUpdates(a: { id?: string; agentId?: string; enabled?: boolean; isEnabled?: boolean }): Record<string, never> {
  const rec = ownedRec(a.id ?? a.agentId ?? "");
  const next = boolArg(a.isEnabled, a.enabled);
  if (rec && next != null) { rec.notifyOnUpdates = next; persist(); rosterChanged(a.id ?? a.agentId); }
  return {};
}
/** Kiểu ảnh nhận được. Không nhận SVG: SVG là tài liệu, chạy được script khi nhúng. */
const AVATAR_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
/**
 * Ảnh avatar nằm chung file trạng thái với cả roster và nằm nguyên trong mỗi frame
 * `agent.upserted`, nên một ảnh to không chỉ tốn đĩa mà tốn cả băng thông SSE. 256 KB đủ cho một
 * avatar 256×256 PNG.
 */
const AVATAR_MAX_BYTES = 256 * 1024;

/**
 * Kiểm tra một data URL avatar trước khi ghi. Trả `null` nếu hợp lệ, hoặc lý do từ chối.
 *
 * Tách riêng để cả hai đường vào — `/gw/api/setAgentAvatarBytes` (client hãng) và
 * `PUT /v1/agents/:id/avatar` (FE của mình) — dùng cùng một luật. Đường `/v1` còn dịch lý do này
 * thành 400/413; đường `/gw` không có kênh lỗi nên chỉ từ chối.
 */
export function avatarRejection(dataUrl: string): string | null {
  const m = /^data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl);
  if (!m) return "cần một data URL base64";
  const [, mime, b64] = m;
  if (!AVATAR_MIME.has(mime.toLowerCase())) return `kiểu ảnh không nhận: ${mime}`;
  // Độ dài base64 → số byte thật, không cần decode.
  const bytes = Math.floor((b64.length * 3) / 4) - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0);
  if (bytes > AVATAR_MAX_BYTES) return `ảnh ${bytes} byte, quá ${AVATAR_MAX_BYTES}`;
  return null;
}

export function setAgentAvatarBytes(a: { id?: string; agentId?: string; pngBase64?: string; bytes?: string }): AgentRecord | null {
  const rec = ownedRec(a.id ?? a.agentId ?? ""); if (!rec) return null;
  const b64 = a.pngBase64 ?? a.bytes;
  if (!b64) return rec;
  const dataUrl = b64.startsWith("data:") ? b64 : `data:image/png;base64,${b64}`;
  const bad = avatarRejection(dataUrl);
  if (bad) { console.warn(`[directory] từ chối avatar cho ${rec.id}: ${bad}`); return null; }
  rec.avatarDataUrl = dataUrl;
  rec.avatarVersion = String(Date.now());
  persist();
  // `avatarVersion` nằm trong row roster, nên UI nào đang mở phải được biết ảnh đã đổi.
  rosterChanged(rec.id);
  return rec;
}

/** Bỏ ảnh → row roster quay về initials suy từ id. Idempotent. */
export function clearAgentAvatar(a: { id?: string; agentId?: string }): AgentRecord | null {
  const rec = ownedRec(a.id ?? a.agentId ?? ""); if (!rec) return null;
  if (!rec.avatarVersion && !rec.avatarDataUrl) return rec;
  delete rec.avatarDataUrl;
  delete rec.avatarVersion;
  persist();
  rosterChanged(rec.id);
  return rec;
}
export function getAgentAvatar(a: { id?: string; agentId?: string }) {
  const rec = ownedRec(a.id ?? a.agentId ?? "");
  return { avatarDataUrl: rec?.avatarDataUrl ?? "", avatarVersion: rec?.avatarVersion ?? "" };
}

export function searchAgents(a: { query?: string; q?: string; text?: string; includeHidden?: boolean }): AgentRecord[] {
  const q = (a.query ?? a.q ?? a.text ?? "").toLowerCase().trim();
  const pool = a.includeHidden ? listAllAgents() : listAgents();
  if (!q) return pool;
  return pool.filter((rec) =>
    rec.name.toLowerCase().includes(q) || transcriptContains(rec.id, q));
}

export function kickstartAgent(a: { id?: string; agentId?: string }): AgentRecord | null {
  const rec = ownedRec(a.id ?? a.agentId ?? ""); if (!rec) return null;
  rec.unread = false; persist(); return rec;
}
