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
 *                                  avatarColor, expectedActiveVersion,
 *                                  creatorContext?}                        → record
 *     getBotTemplateVersion       {shareId, version}                       → record
 *     getBotTemplateForSourceAgent{sourceAgentId}                          → record-or-null
 *     deleteBotTemplate           {shareId}                                → void
 *     setBotTemplateVisibility    {shareId, visibility: "public"|"team"}    → record
 *     getPublicBotTemplate        {shareId}  (0.43, Marketplace → Import)  → {template, …}
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
 * ── `shareId` phải qua được regex của CLIENT ────────────────────────────────────────────────────
 *
 * Host 0.29 lẫn 0.43 kiểm `BOT_TEMPLATE_SHARE_ID_PATTERN = /^[A-Za-z0-9_-]{21}$/` TRƯỚC khi gọi
 * `getPublicBotTemplate` — id không khớp thì cửa Import không bao giờ tới backend, và không lỗi nào
 * nổi lên. Dạng cũ `tpl-<agentId>-<time36>` (dài 20–30, có dấu chấm) trượt regex ấy. Nay
 * `newShareId()` = 16 byte ngẫu nhiên → base64url → cắt 21. URL chia sẻ của hãng là
 * `https://x.ai/bot/${shareId}` (0.43 `main-app.cjs`).
 *
 * ── `snapshot` là của TA, `recipe` là hình dạng của HÃNG ────────────────────────────────────────
 *
 * Renderer 0.29 không đọc `snapshot`. Nó tồn tại vì mục đích thật của tính năng: chép cả một ĐỘI.
 * Từ 05/09 `snapshot.recipe` mang đúng hình dạng blob mẫu của 0.43 (zod `Dct`): `profile` ·
 * `memory[]` · `skills[]` · `routines[]` · `plugins[]` — là 5 mục trang chi tiết Marketplace vẽ
 * (Instructions · Memories · Skills · Routines · Integrations). Nguồn của 4 mục sau nằm ở kho khác
 * (`workflows.ts`, `automations.ts` — kéo theo `chat.js`, `memory.ts` — trên box) nên chúng được
 * TIÊM qua `bindTemplateSources`, không import thẳng: file này không cần biết kho nào ở đâu, và bài
 * test tiêm giả.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { currentOwner } from "./request-context.js";
import { agents, introduceRef } from "./chat/state.js";
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

/** Regex của client — `BOT_TEMPLATE_SHARE_ID_PATTERN` trong host 0.29 và 0.43, nguyên văn. */
export const SHARE_ID_RE = /^[A-Za-z0-9_-]{21}$/;
const SHARE_ID_LEN = 21;
/** 16 byte → 22 ký tự base64url (không đệm) → cắt 21. */
const SHARE_ID_BYTES = 16;

export function newShareId(): string {
  return randomBytes(SHARE_ID_BYTES).toString("base64url").slice(0, SHARE_ID_LEN);
}

// ── Recipe: hình dạng blob mẫu của 0.43 ──────────────────────────────────────────────────────────

export interface RecipeSkill { name: string; description?: string; content?: string }
/** `trigger` là của TA (cron để dựng lại đúng nhịp) — zod của client bỏ qua khoá lạ, không từ chối. */
export interface RecipeRoutine { slug: string; name?: string; description?: string; content?: string; trigger?: string }
export interface RecipePlugin { pluginId: string; name?: string; description?: string }
export interface RecipeMemory { kind?: "profile" | "log"; createdAt?: string; content: string }

/** Zod `Dct` của 0.43 — cùng khoá, cùng tuỳ chọn. Import view (`Ner`) đòi `skills.content` và `routines.content+description`. */
export interface TemplateRecipe {
  profile: { name: string; description: string; avatarColor?: string; avatarShape?: string };
  memory: RecipeMemory[];
  skills: RecipeSkill[];
  routines: RecipeRoutine[];
  plugins: RecipePlugin[];
  gettingStarted?: { skill: string };
}

/** Ảnh chụp một bot để dựng lại — `members` là của TA (đội), `recipe` là hình dạng của hãng. */
export interface TemplateSnapshot {
  name: string;
  description: string;
  isGroup: boolean;
  members: { name: string; description: string }[];
  recipe: TemplateRecipe;
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
  /** `SandBotTemplateWireView` 0.43 BẮT BUỘC (coordinator kiểm reply) — suy từ shareId, lấp lúc đọc cho bản cũ. */
  shareUrl: string;
  /** Ba trường 0.43 đọc ở trang chi tiết / listing. `ownerAuthId` để đọc xuyên chủ tìm lại đúng kho. */
  ownerAuthId: string;
  ownerType: "user";
  imageUrl: string | null;
  snapshot: TemplateSnapshot;
}

// ── Nguồn của 4 mục ngoài profile — TIÊM, không import ───────────────────────────────────────────

export interface TemplateSources {
  skills: (agentId: string) => RecipeSkill[];
  routines: (agentId: string) => RecipeRoutine[];
  memory: (agentId: string) => Promise<RecipeMemory[]>;
  plugins: (owner: string) => RecipePlugin[];
  restoreSkill: (agentId: string, s: RecipeSkill) => void;
  restoreRoutine: (agentId: string, r: RecipeRoutine) => void;
  restoreMemory: (agentId: string, m: RecipeMemory) => Promise<void>;
}

/** Mặc định: không nguồn nào — recipe chỉ có profile. Gateway tiêm nguồn thật lúc khởi động. */
const KHONG_NGUON: TemplateSources = {
  skills: () => [],
  routines: () => [],
  memory: async () => [],
  plugins: () => [],
  restoreSkill: () => {},
  restoreRoutine: () => {},
  restoreMemory: async () => {},
};
let nguon: TemplateSources = KHONG_NGUON;

export function bindTemplateSources(s: Partial<TemplateSources>): void {
  nguon = { ...KHONG_NGUON, ...s };
}

// ── Kho ─────────────────────────────────────────────────────────────────────────────────────────

/** Bản ghi trước 05/09 thiếu `ownerAuthId`/`recipe` — lấp lúc đọc, để mọi đường sau khỏi kiểm null. */
function lapChoBanCu(t: BotTemplate, owner: string): BotTemplate {
  const recipe: TemplateRecipe = t.snapshot?.recipe ?? {
    profile: { name: t.name, description: t.description }, memory: [], skills: [], routines: [], plugins: [],
  };
  return { ...t, shareUrl: t.shareUrl ?? shareUrlOf(t.shareId), ownerAuthId: t.ownerAuthId ?? owner, ownerType: "user", imageUrl: t.imageUrl ?? null,
    snapshot: { ...t.snapshot, recipe } };
}

function docFile(path: string, owner: string): BotTemplate[] {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return Array.isArray(raw) ? (raw as BotTemplate[]).map((t) => lapChoBanCu(t, owner)) : [];
  } catch {
    return [];
  }
}

const readAll = (owner: string): BotTemplate[] => docFile(fileFor(owner), owner);

function writeAll(owner: string, rows: BotTemplate[]): void {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(fileFor(owner), JSON.stringify(rows, null, 2), { mode: 0o600 });
}

/** Mọi mẫu của mọi chủ — chỉ dùng cho đường đọc CÔNG KHAI. */
function readEveryone(): BotTemplate[] {
  if (!existsSync(DIR)) return [];
  return readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => docFile(join(DIR, f), f.slice(0, -".json".length)));
}

// ── Chụp ────────────────────────────────────────────────────────────────────────────────────────

/** Ảnh chụp hiện tại của một bot (hoặc nhóm) trong roster của người gọi, kèm recipe 5 mục. */
async function snapshotOf(agentId: string, owner: string): Promise<TemplateSnapshot | null> {
  const a = agents.get(agentId);
  if (!a) return null;
  const members = (a.memberIds ?? [])
    .map((id) => agents.get(id))
    .filter((m): m is NonNullable<typeof m> => m != null)
    .map((m) => ({ name: m.name, description: m.description ?? "" }));
  const shape = (a as { avatarShape?: unknown }).avatarShape;
  const color = (a as { avatarColor?: unknown }).avatarColor;
  const recipe: TemplateRecipe = {
    profile: {
      name: a.name,
      description: a.description ?? "",
      ...(typeof color === "string" ? { avatarColor: color } : {}),
      ...(typeof shape === "string" ? { avatarShape: shape } : {}),
    },
    memory: await nguon.memory(agentId),
    skills: nguon.skills(agentId),
    routines: nguon.routines(agentId),
    plugins: nguon.plugins(owner),
  };
  return { name: a.name, description: a.description ?? "", isGroup: a.isGroup === true, members, recipe };
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
export async function createTemplateForAgent(sourceAgentId: string, owner: string = currentOwner()): Promise<BotTemplate | null> {
  if (!sourceAgentId) return null;
  const rows = readAll(owner);
  const found = rows.find((t) => t.sourceAgentId === sourceAgentId);
  if (found) return found;
  const snap = await snapshotOf(sourceAgentId, owner);
  if (!snap) return null;
  const now = Date.now();
  const shareId = newShareId();
  const draft: BotTemplate = {
    shareId,
    shareUrl: shareUrlOf(shareId),
    sourceAgentId,
    name: snap.name,
    description: snap.description,
    avatarShape: snap.recipe.profile.avatarShape ?? "blob",
    avatarColor: snap.recipe.profile.avatarColor ?? "blue",
    version: 1,
    activeVersion: null,
    published: false,
    active: false,
    visibility: "team",
    createdAtMs: now,
    updatedAtMs: now,
    ownerAuthId: owner,
    ownerType: "user",
    imageUrl: null,
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
export async function publishBotTemplate(
  shareId: string, version: number, owner: string = currentOwner(),
): Promise<BotTemplate | null> {
  const rows = readAll(owner);
  const i = rows.findIndex((t) => t.shareId === shareId);
  if (i < 0) return null;
  const fresh = await snapshotOf(rows[i].sourceAgentId, owner);
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

// ── Đường CÔNG KHAI (Marketplace → Import Bot) ──────────────────────────────────────────────────

/** Tên hiển thị suy từ authId: `local|nguoi-a@vi-du.vn` → `nguoi-a`. Chưa có hồ sơ người tạo riêng. */
export function ownerDisplayNameOf(authId: string): string {
  const sauTienTo = authId.includes("|") ? authId.slice(authId.indexOf("|") + 1) : authId;
  return sauTienTo.split("@")[0] || sauTienTo || "ẩn danh";
}

const laCongKhai = (t: BotTemplate): boolean => t.published && t.visibility === "public";

/**
 * Đọc một mẫu công khai XUYÊN chủ — cửa `getPublicBotTemplate{shareId}` của 0.43.
 *
 * Chỉ mẫu **đã xuất bản VÀ public** mới thấy được. Mẫu `team` là của một chủ, dù đã xuất bản.
 * Chưa có hồ sơ người tạo (auth.ts không giữ displayName/avatar) nên tên suy từ tài khoản.
 */
export function getPublicBotTemplate(shareId: string): { template: BotTemplate; ownerDisplayName: string } | null {
  if (!SHARE_ID_RE.test(shareId)) return null;
  const t = readEveryone().find((x) => x.shareId === shareId && laCongKhai(x));
  return t ? { template: t, ownerDisplayName: ownerDisplayNameOf(t.ownerAuthId) } : null;
}

/** Mọi mẫu công khai đã xuất bản, của mọi chủ — nguồn của Marketplace (`marketplace.ts`). */
export const listPublicBotTemplates = (): BotTemplate[] => readEveryone().filter(laCongKhai);

/**
 * Mẫu theo shareId bất kể chủ và tầm nhìn — CHỈ để phân biệt "không có" với "có mà không public",
 * vì client 0.43 đọc hai mã lỗi khác nhau (NotFound ⇒ null · PermissionDenied ⇒ access denied).
 * Không trả nội dung ra ngoài: người gọi chỉ được biết nó tồn tại.
 */
export const botTemplateExistsAnyOwner = (shareId: string): boolean =>
  SHARE_ID_RE.test(shareId) && readEveryone().some((x) => x.shareId === shareId);

/** Mẫu của CHÍNH người gọi theo shareId — cửa cho listing: chỉ chủ mới đăng mẫu của mình lên cộng đồng. */
export const templateOwnedBy = (shareId: string, owner: string): BotTemplate | null =>
  readAll(owner).find((t) => t.shareId === shareId) ?? null;

// ── Hình dạng host 0.43 trả cho renderer: `BotTemplateImport` (hàm `xfe` = botTemplateImportFromPackedVersion) ──

/** `EB` / `SB` của 0.43 — validator `isGrokBotColor` / `isGrokBotShape` từ chối mọi giá trị ngoài hai bảng này. */
export const AVATAR_COLORS = ["black", "brown", "red", "orange", "yellow", "green", "cyan", "blue", "violet", "magenta", "gray"] as const;
export const AVATAR_SHAPES = ["blob", "pebble", "bean", "egg", "squircle", "tablet", "capsule", "cylinder", "hex", "gem", "crystal", "wedge", "shield", "dome", "arch", "cloud", "teardrop", "leaf"] as const;
const DEFAULT_COLOR = "blue";
const DEFAULT_SHAPE = "blob";
export const mauHopLe = (c: unknown): string => (AVATAR_COLORS as readonly string[]).includes(String(c)) ? String(c) : DEFAULT_COLOR;
export const hinhHopLe = (s: unknown): string => (AVATAR_SHAPES as readonly string[]).includes(String(s)) ? String(s) : DEFAULT_SHAPE;

export const shareUrlOf = (shareId: string): string => `https://x.ai/bot/${shareId}`;

/** Schema `CB` của client đòi mọi chuỗi `min(1)` — chỗ trống thì lấp bằng câu có nghĩa, không để rỗng. */
const KHONG_MO_TA = "(chưa có mô tả)";
const KHONG_NOI_DUNG = "(chưa có nội dung)";
const coChu = (s: string | undefined, thay: string): string => (s ?? "").trim() || thay;

export interface BotTemplateImport {
  expectedActiveVersion: number;
  instructions: string;
  view: {
    shareId: string; name: string; avatarShape: string; avatarColor: string; description: string; shareUrl: string;
    version: number; activeVersion: number; active: true; published: true; creatorName?: string;
    memory: RecipeMemory[]; skills: RecipeSkill[]; routines: RecipeRoutine[]; plugins: RecipePlugin[];
    createdAtMs?: number; updatedAtMs?: number;
  };
}

/**
 * Đổi một mẫu đã xuất bản sang đúng cái `BotTemplateImport` renderer 0.43 kiểm (`isBotTemplateImport`):
 * `expectedActiveVersion` nguyên ≥1 · `view.shareId` khớp regex · avatar trong bảng · `description`
 * không rỗng · KHÔNG có `sourceAgentId` · skills/routines đủ `name+description+content`.
 */
export function toBotTemplateImport(t: BotTemplate, creatorName?: string): BotTemplateImport | null {
  if (!t.published || t.activeVersion == null || t.activeVersion < 1) return null;
  const r = t.snapshot.recipe;
  const ten = creatorName?.trim();
  return {
    expectedActiveVersion: t.activeVersion,
    instructions: r.profile.description.trim(),
    view: {
      shareId: t.shareId,
      name: coChu(r.profile.name, t.name),
      avatarShape: hinhHopLe(r.profile.avatarShape ?? t.avatarShape),
      avatarColor: mauHopLe(r.profile.avatarColor ?? t.avatarColor),
      description: coChu(t.description, KHONG_MO_TA),
      shareUrl: shareUrlOf(t.shareId),
      version: t.activeVersion,
      activeVersion: t.activeVersion,
      active: true,
      published: true,
      ...(ten ? { creatorName: ten } : {}),
      memory: r.memory.filter((m) => m.content.trim()),
      skills: r.skills.map((s) => ({ name: s.name, description: coChu(s.description, KHONG_MO_TA), content: coChu(s.content, KHONG_NOI_DUNG) })),
      routines: r.routines.map((x) => ({
        slug: x.slug, name: coChu(x.name, x.slug), description: coChu(x.description, KHONG_MO_TA), content: coChu(x.content, KHONG_NOI_DUNG),
        ...(x.trigger ? { trigger: x.trigger } : {}),
      })),
      plugins: r.plugins.map((p) => ({ pluginId: p.pluginId, name: coChu(p.name, p.pluginId), ...(p.description ? { description: p.description } : {}) })),
      createdAtMs: t.createdAtMs,
      updatedAtMs: t.updatedAtMs,
    },
  };
}

/**
 * Recipe ra BLOB cho main 0.43 tải về — zod `Dct` của MAIN nghiêm hơn của renderer: skill đòi
 * `name+description+content` đều min(1), routine đòi cả `name+slug+description+content`, plugin đòi
 * `name` (description thì hoặc vắng hoặc min(1)), memory `content` min(1), và `gettingStarted.skill`
 * phải trùng tên một skill. Một chuỗi rỗng là main ném "recipe refused" và Import chết im.
 */
export function recipeForBlob(t: BotTemplate): TemplateRecipe {
  const r = t.snapshot.recipe;
  const skills = r.skills.map((s) => ({ name: coChu(s.name, "skill"), description: coChu(s.description, KHONG_MO_TA), content: coChu(s.content, KHONG_NOI_DUNG) }));
  const gs = r.gettingStarted?.skill;
  return {
    profile: {
      name: coChu(r.profile.name, t.name),
      description: coChu(r.profile.description, coChu(t.description, KHONG_MO_TA)),
      avatarColor: mauHopLe(r.profile.avatarColor ?? t.avatarColor),
      avatarShape: hinhHopLe(r.profile.avatarShape ?? t.avatarShape),
    },
    memory: r.memory.filter((m) => (m.content ?? "").trim()).map((m) => ({ content: m.content, ...(m.kind ? { kind: m.kind } : {}), ...(m.createdAt ? { createdAt: m.createdAt } : {}) })),
    skills,
    routines: r.routines.map((x) => ({
      slug: coChu(x.slug, "routine"), name: coChu(x.name, x.slug), description: coChu(x.description, KHONG_MO_TA), content: coChu(x.content, KHONG_NOI_DUNG),
      ...(x.trigger ? { trigger: x.trigger } : {}),
    })),
    plugins: r.plugins.map((p) => ({ pluginId: p.pluginId, name: coChu(p.name, p.pluginId), ...(p.description?.trim() ? { description: p.description } : {}) })),
    ...(gs && skills.some((s) => s.name === gs) ? { gettingStarted: { skill: gs } } : {}),
  };
}

/** Cửa gateway `getPublicBotTemplate{shareId}`: đúng thứ renderer nhận từ host 0.43, hoặc `null`. */
export function publicTemplateImport(shareId: string): BotTemplateImport | null {
  const pub = getPublicBotTemplate(shareId);
  return pub ? toBotTemplateImport(pub.template, pub.ownerDisplayName) : null;
}

/** Mẫu người gọi được dùng để DỰNG: kho của mình trước, rồi mẫu công khai của người khác. */
function templateReachable(shareId: string, owner: string): BotTemplate | null {
  return readAll(owner).find((t) => t.shareId === shareId) ?? getPublicBotTemplate(shareId)?.template ?? null;
}

async function dungLaiTuRecipe(agentId: string, r: TemplateRecipe): Promise<void> {
  for (const s of r.skills) nguon.restoreSkill(agentId, s);
  for (const x of r.routines) nguon.restoreRoutine(agentId, x);
  for (const m of r.memory) await nguon.restoreMemory(agentId, m);
}

export interface CreateFromTemplateArgs {
  shareId?: string;
  /** 0.43 tự đúc id (UUID) cho bot sắp tạo và vẽ hàng roster TRƯỚC khi gọi — bot phải mang đúng id này. */
  agentId?: string;
  name?: string;
  avatarShape?: string;
  avatarColor?: string;
  /** Client gửi bản nó đang xem; lệch bản active thì từ chối — không import bản cũ dưới tên bản mới. */
  expectedActiveVersion?: number;
  /** 0.43 gửi kèm khi import từ Marketplace (người tạo, listing). Ghi nhận, chưa dùng. */
  creatorContext?: unknown;
}

/**
 * Dựng bot (hoặc cả ĐỘI) từ một mẫu.
 *
 * Mẫu của nhóm dựng lại từng thành viên rồi mở phòng — đó mới là thứ "phát đội bot cho máy khác"
 * có nghĩa. Dựng mỗi cái vỏ nhóm rỗng thì người nhận có một cái phòng không ai ở trong.
 *
 * Bot lẻ dựng lại thêm skill + routine + memory của recipe vào bot MỚI. Nhóm thì recipe là của
 * phòng (thường rỗng) — skill của từng thành viên chưa đi theo, ghi rõ ở đây để không ai tưởng có.
 *
 * `name` trong đối số đè tên của mẫu: người nhận đặt tên riêng ngay trên thẻ trước khi tạo.
 */
/**
 * `setup` trong reply `createAgentFromTemplate` (`SandCreateAgentFromTemplateResult` 0.43): renderer vẽ
 * "bot này mang gì theo" — skill / routine / memory / plugin. Mọi chuỗi ở đây là `string` bắt buộc
 * (`required: content, description, name`), nên chỗ trống lấp `""`, không để `undefined` (khoá vắng
 * trượt `required`).
 */
export interface TemplateSetupRecipe {
  kind: "recipe";
  /**
   * `true` = client KHÔNG gửi lời nhắc setup ("Hi X. Please create your skills… <bot_template_setup_context>").
   * Ở host hãng, bot tự áp recipe bằng tool `update_state` khi nhận lời nhắc đó. Bên ta `dungLaiTuRecipe` đã
   * dựng skill / routine / memory ngay lúc import, nên gửi lời nhắc là bảo bot làm lại việc đã xong bằng một
   * tool nó không có — đo 05/09: client 0.43 gửi thật, bot nhận nguyên khối JSON. Recipe vẫn trả để client vẽ.
   */
  isSetupSendSuppressed?: boolean;
  skills: { name: string; description: string; content: string }[];
  automations: { name: string; slug: string; description: string; content: string }[];
  memories: { content: string; createdAt?: string; kind?: "log" | "profile" }[];
  plugins: { pluginId: string; name: string; description?: string }[];
}
export type TemplateSetup = TemplateSetupRecipe | { kind: "unavailable" };

export function setupOf(r: TemplateRecipe): TemplateSetupRecipe {
  return {
    kind: "recipe",
    skills: r.skills.map((s) => ({ name: s.name, description: s.description ?? "", content: s.content ?? "" })),
    automations: r.routines.map((x) => ({ name: x.name ?? x.slug, slug: x.slug, description: x.description ?? "", content: x.content ?? "" })),
    memories: r.memory.map((m) => ({ content: m.content, ...(m.createdAt ? { createdAt: m.createdAt } : {}), ...(m.kind ? { kind: m.kind } : {}) })),
    plugins: r.plugins.map((p) => ({ pluginId: p.pluginId, name: p.name ?? "", ...(p.description ? { description: p.description } : {}) })),
  };
}

export async function createAgentFromTemplate(
  a: CreateFromTemplateArgs,
  owner: string = currentOwner(),
): Promise<{ agent: unknown; setup: TemplateSetup; transcript: never[] } | null> {
  const tpl = templateReachable(a.shareId ?? "", owner);
  if (!tpl) return null;
  if (a.expectedActiveVersion != null && tpl.activeVersion !== a.expectedActiveVersion) return null;
  const snap = tpl.snapshot;
  const wanted = (a.name ?? "").trim() || snap.name || tpl.name;
  // Avatar: client gửi cái người nhận chọn trên thẻ; không gửi thì lấy của mẫu (renderer vẽ hình+màu, không ảnh).
  const vo = {
    ...(typeof a.agentId === "string" ? { id: a.agentId } : {}),
    avatarShape: a.avatarShape ?? tpl.avatarShape,
    avatarColor: a.avatarColor ?? tpl.avatarColor,
  };
  if (!snap.isGroup) {
    const agent = createAgent({ ...vo, name: wanted, description: snap.description });
    await dungLaiTuRecipe(agent.id, snap.recipe);
    /*
     * Client 0.43 vẽ hàng roster "Creating…" (`beginCreation{expectsContent:true}`) và chỉ gỡ khi bot có NỘI DUNG
     * đầu tiên. Ở hãng nội dung ấy là câu trả lời cho lời nhắc setup; ta chặn lời nhắc đó (xem
     * `isSetupSendSuppressed`) nên phải tự kích lời giới thiệu — đúng vai `isKickstartRequested` của `createAgent`.
     * Đo 05/09: không kích ⇒ "Creating…" treo vô hạn; `kickstartAgent` tay ⇒ bot chào, hàng chuyển sang tin đầu.
     * `introduceRef` là ref (như `directory.kickstartAgent`) để module này không kéo `runtime/turn`.
     */
    introduceRef?.(agent.id);
    return { agent, setup: { ...setupOf(snap.recipe), isSetupSendSuppressed: true }, transcript: [] };
  }
  const memberIds = snap.members.map((m) => createAgent({ name: m.name, description: m.description }).id);
  // Nhóm: recipe là của PHÒNG, skill thành viên chưa đi theo — nói "unavailable" thật hơn là vẽ một bảng rỗng.
  return { agent: createGroup({ ...vo, name: wanted, memberAgentIds: memberIds }), setup: { kind: "unavailable" }, transcript: [] };
}
