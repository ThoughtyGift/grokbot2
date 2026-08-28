/**
 * Mẫu bot — dựng một đội bot một lần, phát cho máy khác.
 *
 * ── Vì sao ──────────────────────────────────────────────────────────────────────────────────────
 *
 * Nhóm 404 mềm lớn nhất còn lại của cổng box là 7 lệnh mẫu bot: `listBotTemplates`,
 * `publishBotTemplate`, `createAgentFromTemplate`, `getBotTemplateVersion`,
 * `getBotTemplateForSourceAgent`, `deleteBotTemplate`, `setBotTemplateVisibility`. Tab Templates
 * trong app vẽ ra được nhưng mọi nút bấm rơi vào hư không.
 *
 * ── Hình dạng: cái gì trích được, cái gì KHÔNG ──────────────────────────────────────────────────
 *
 * **Trích được** (bundle 0.29, nguyên văn):
 *
 *     listBotTemplates            noArgs                                   → array
 *     publishBotTemplate          {shareId, version}                       → record
 *     createAgentFromTemplate     {shareId, agentId, name, avatarShape,
 *                                  avatarColor, expectedActiveVersion}     → record
 *     getBotTemplateVersion       {shareId, version}                       → record
 *     getBotTemplateForSourceAgent{sourceAgentId}                          → record-or-null
 *     deleteBotTemplate           {shareId}                                → void
 *     setBotTemplateVisibility    {shareId, visibility: "public"|"team"}    → record
 *
 * Các trường renderer đọc của một mẫu: `shareId` · `sourceAgentId` · `name` · `description` ·
 * `avatarShape` · `avatarColor` · `version` · `activeVersion` · `published` · `active` ·
 * `visibility` · `createdAtMs` · `updatedAtMs`. Máy trạng thái của nó cũng trích được nguyên văn:
 * `activeVersion!=null ? version===activeVersion : published===false ? false : active===true`.
 *
 * **KHÔNG trích được: bước TẠO.** Không có lệnh `createBotTemplate` nào, và `publishBotTemplate`
 * chỉ nhận `{shareId, version}` — không mang `sourceAgentId`. Nghĩa là bên hãng `shareId` do máy
 * chủ cấp, và client chỉ bao giờ xuất bản một thứ máy chủ đã biết. Đường đó không nằm trong app.
 *
 * **Suy luận DUY NHẤT của file này, nói rõ ra:** `getBotTemplateForSourceAgent` sẽ **tạo bản nháp
 * nếu chưa có** rồi trả về, thay vì trả `null`. Đó là lệnh duy nhất mang `sourceAgentId`, và
 * `published:false` đọc đúng thành "chưa xuất bản" theo chính máy trạng thái ở trên. Nếu sau này đo
 * được rằng hãng trả `null` ở đây, chỗ cần sửa là đúng một dòng.
 *
 * ── `snapshot` là của TA ────────────────────────────────────────────────────────────────────────
 *
 * Renderer không đọc trường này. Nó tồn tại vì mục đích thật của tính năng: chép cả một ĐỘI. Một
 * mẫu của nhóm mang theo mô tả từng thành viên, nên `createAgentFromTemplate` dựng lại được cả dàn
 * chứ không phải một con bot trống mang cái tên cũ.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { currentOwner } from "./request-context.js";
import { agents } from "./chat/state.js";
import { createAgent, createGroup } from "./directory/index.js";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", ".data", "bot-templates");
const safe = (authId: string): string => authId.replace(/[^A-Za-z0-9_-]/g, "_");
const fileFor = (owner: string): string => join(DIR, `${safe(owner)}.json`);

/** Ảnh chụp một bot để dựng lại — trường của TA, renderer không đọc. */
export interface TemplateSnapshot {
  name: string;
  description: string;
  isGroup: boolean;
  members: { name: string; description: string }[];
}

export interface BotTemplate {
  shareId: string;
  sourceAgentId: string;
  name: string;
  description: string;
  avatarShape: string;
  avatarColor: string;
  version: number;
  activeVersion: number | null;
  published: boolean;
  active: boolean;
  visibility: "public" | "team";
  createdAtMs: number;
  updatedAtMs: number;
  snapshot: TemplateSnapshot;
}

function readAll(owner: string): BotTemplate[] {
  try {
    const raw = JSON.parse(readFileSync(fileFor(owner), "utf8")) as unknown;
    return Array.isArray(raw) ? (raw as BotTemplate[]) : [];
  } catch {
    return [];
  }
}

function writeAll(owner: string, rows: BotTemplate[]): void {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(fileFor(owner), JSON.stringify(rows, null, 2), { mode: 0o600 });
}

/** Ảnh chụp hiện tại của một bot (hoặc nhóm) trong roster của người gọi. */
function snapshotOf(agentId: string): TemplateSnapshot | null {
  const a = agents.get(agentId);
  if (!a) return null;
  const members = (a.memberIds ?? [])
    .map((id) => agents.get(id))
    .filter((m): m is NonNullable<typeof m> => m != null)
    .map((m) => ({ name: m.name, description: m.description ?? "" }));
  return { name: a.name, description: a.description ?? "", isGroup: a.isGroup === true, members };
}

export const listBotTemplates = (owner: string = currentOwner()): BotTemplate[] => readAll(owner);

/**
 * Mẫu của một bot — tạo bản nháp nếu chưa có. Xem ghi chú "suy luận DUY NHẤT" ở đầu file.
 *
 * `null` khi bot không tồn tại hoặc không thuộc người gọi: `record-or-null` là kiểu client khai,
 * nên `null` là câu trả lời hợp lệ chứ không phải lỗi.
 */
export function getBotTemplateForSourceAgent(sourceAgentId: string, owner: string = currentOwner()): BotTemplate | null {
  if (!sourceAgentId) return null;
  const rows = readAll(owner);
  const found = rows.find((t) => t.sourceAgentId === sourceAgentId);
  if (found) return found;
  const snap = snapshotOf(sourceAgentId);
  if (!snap) return null;
  const now = Date.now();
  const a = agents.get(sourceAgentId)!;
  const draft: BotTemplate = {
    shareId: `tpl-${safe(sourceAgentId)}-${now.toString(36)}`,
    sourceAgentId,
    name: snap.name,
    description: snap.description,
    avatarShape: String((a as { avatarShape?: unknown }).avatarShape ?? "blob"),
    avatarColor: String((a as { avatarColor?: unknown }).avatarColor ?? "blue"),
    version: 1,
    activeVersion: null,
    published: false,
    active: false,
    visibility: "team",
    createdAtMs: now,
    updatedAtMs: now,
    snapshot: snap,
  };
  writeAll(owner, [...rows, draft]);
  return draft;
}

export const getBotTemplateVersion = (
  shareId: string, _version: number, owner: string = currentOwner(),
): BotTemplate | null => readAll(owner).find((t) => t.shareId === shareId) ?? null;

/**
 * Xuất bản một phiên bản.
 *
 * Chụp LẠI bot nguồn ngay lúc bấm: mẫu phải là ảnh của bot **hôm nay**, không phải của lúc mở tab
 * — người dùng thường sửa mô tả rồi mới bấm Publish, và một mẫu chở bản cũ là loại sai âm thầm.
 */
export function publishBotTemplate(
  shareId: string, version: number, owner: string = currentOwner(),
): BotTemplate | null {
  const rows = readAll(owner);
  const i = rows.findIndex((t) => t.shareId === shareId);
  if (i < 0) return null;
  const fresh = snapshotOf(rows[i].sourceAgentId);
  const v = Number.isFinite(version) && version > 0 ? Math.floor(version) : rows[i].version;
  const next: BotTemplate = {
    ...rows[i],
    ...(fresh ? { snapshot: fresh, name: fresh.name, description: fresh.description } : {}),
    version: v,
    activeVersion: v,
    published: true,
    active: true,
    updatedAtMs: Date.now(),
  };
  writeAll(owner, rows.map((t, k) => (k === i ? next : t)));
  return next;
}

export function setBotTemplateVisibility(
  shareId: string, visibility: string, owner: string = currentOwner(),
): BotTemplate | null {
  const vis = visibility === "public" ? "public" : "team";
  const rows = readAll(owner);
  const i = rows.findIndex((t) => t.shareId === shareId);
  if (i < 0) return null;
  const next = { ...rows[i], visibility: vis as "public" | "team", updatedAtMs: Date.now() };
  writeAll(owner, rows.map((t, k) => (k === i ? next : t)));
  return next;
}

export function deleteBotTemplate(shareId: string, owner: string = currentOwner()): void {
  const rows = readAll(owner);
  if (rows.some((t) => t.shareId === shareId)) writeAll(owner, rows.filter((t) => t.shareId !== shareId));
}

/**
 * Dựng bot (hoặc cả ĐỘI) từ một mẫu.
 *
 * Mẫu của nhóm dựng lại từng thành viên rồi mở phòng — đó mới là thứ "phát đội bot cho máy khác"
 * có nghĩa. Dựng mỗi cái vỏ nhóm rỗng thì người nhận có một cái phòng không ai ở trong.
 *
 * `name` trong đối số đè tên của mẫu: người nhận đặt tên riêng ngay trên thẻ trước khi tạo.
 */
export function createAgentFromTemplate(
  a: { shareId?: string; name?: string; avatarShape?: string; avatarColor?: string },
  owner: string = currentOwner(),
): { agent: unknown } | null {
  const tpl = readAll(owner).find((t) => t.shareId === a.shareId);
  if (!tpl) return null;
  const snap = tpl.snapshot;
  const wanted = (a.name ?? "").trim() || snap.name || tpl.name;
  if (!snap.isGroup) {
    return { agent: createAgent({ name: wanted, description: snap.description }) };
  }
  const memberIds = snap.members.map((m) => createAgent({ name: m.name, description: m.description }).id);
  return { agent: createGroup({ name: wanted, memberAgentIds: memberIds }) };
}
