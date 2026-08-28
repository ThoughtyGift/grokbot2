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
 * Từng có một suy luận ở đây — `getBotTemplateForSourceAgent` tự tạo bản nháp khi chưa có — và
 * **app thật đã bác nó trong cùng ngày**: mọi bot hiện nút "Delete Template" dù chưa ai chia sẻ.
 * Xem ghi chú tại chính hàm đó. Giờ tạo mẫu đi qua `createTemplateForAgent`, tức chỉ khi có người
 * thật sự muốn chia sẻ (tool `share_bot_template`).
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

/**
 * Nơi kho này ghi.
 *
 * Đọc `GROKBOT2_DATA_DIR` TRƯỚC — `mcp.ts` đã ghi cảnh báo về đúng cái bẫy này: đường dẫn suy từ vị
 * trí module thì nó đi theo mã và **bỏ qua mọi biến cách ly của bài test**, nên một lần chạy thử
 * ghi thẳng vào `.data` thật của người dùng. Đo được ngày 28/08: các lần chạy E2E để lại mẫu bot
 * rác trong kho thật, và một trong số đó làm chính bài test sau đó đọc nhầm.
 */
const DATA_DIR = process.env.GROKBOT2_DATA_DIR ?? join(dirname(fileURLToPath(import.meta.url)), "..", ".data");
const DIR = join(DATA_DIR, "bot-templates");
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
 * Mẫu của một bot — CHỈ ĐỌC. Không có thì `null`.
 *
 * ── Đây là chỗ tôi đã sai, và app thật chỉ ra ─────────────────────────────────────────────────
 *
 * Bản đầu tự tạo bản nháp ngay khi đọc (xem "suy luận DUY NHẤT" ở đầu file). Mở app 0.29 đã vá và
 * bấm vào một bot thì thấy ngay hậu quả: **mọi bot đều hiện nút "Delete Template"** dù người dùng
 * chưa chia sẻ gì. Renderer quyết định bằng đúng đoạn này:
 *
 *     const u = Dut({template, status, shareAvailable});
 *     if (u === "hidden") return null;                  // không có mẫu → ẩn hẳn phần này
 *     if (u === "delete" && template != null) …         // có mẫu → nút Delete Template
 *
 * Nó không phân biệt nháp với đã xuất bản ở nhánh đó — có record là ra nút xoá. Nên một lần đọc
 * mà đẻ ra record là nói với người dùng rằng họ đã chia sẻ con bot, trong khi họ chưa.
 *
 * Đọc phải là đọc. Tạo mẫu đi bằng `createTemplateForAgent` (tool `share_bot_template`), tức chỉ
 * khi có người thật sự muốn chia sẻ.
 */
export function getBotTemplateForSourceAgent(sourceAgentId: string, owner: string = currentOwner()): BotTemplate | null {
  if (!sourceAgentId) return null;
  return readAll(owner).find((t) => t.sourceAgentId === sourceAgentId) ?? null;
}

/**
 * Tạo mẫu cho một bot (hoặc nhóm), nếu chưa có. Đã có thì trả cái đang có — bấm chia sẻ hai lần
 * không được đẻ ra hai mẫu.
 */
export function createTemplateForAgent(sourceAgentId: string, owner: string = currentOwner()): BotTemplate | null {
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
