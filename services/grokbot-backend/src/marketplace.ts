/**
 * Marketplace bot — kho LISTING + hồ sơ NGƯỜI TẠO (bước D của docs/plan/len-0-43-marketplace-template.md).
 *
 * Một listing là một mẫu bot công khai (`bot-templates.ts`, `published && visibility:"public"`) được
 * chủ của nó **đăng lên cộng đồng** kèm một nhóm (`category`). Client 0.43 đọc qua RPC main-side
 * `ListPublicGrokBotMarketplaceListings` / `GetGrokBotTemplateImportDetails` (xem
 * `packages/grokbot-proto/src/marketplace-rpc.ts`) rồi tải recipe từ `blob_get_url` — địa chỉ ấy trỏ
 * về `/gw/bot-template-blob/<shareId>/<version>.json` của chính backend này, mở không cần vé cổng vì
 * main `fetch` trần (shareId 21 ký tự ngẫu nhiên đã là bí mật chia sẻ).
 *
 * Kho là một file JSON (`GROKBOT2_MARKETPLACE_FILE`, mặc định `.data/marketplace.json`) — cùng luật với
 * `GROKBOT2_WORKFLOWS_FILE`: bài test trỏ nó vào thư mục tạm TRƯỚC khi nạp module, không bao giờ ghi
 * vào kho thật ("sổ trắng hoá ra không trắng", bảng theo dõi §7).
 *
 * Listing KHÔNG chép nội dung mẫu: nó chỉ giữ `shareId` + nhóm + cờ, còn tên/mô tả/avatar đọc lại từ
 * mẫu lúc trả — mẫu đổi thì listing đổi theo, mẫu rút về `team` thì listing tự biến mất khỏi danh
 * sách (không có trạng thái thứ hai để lệch).
 *
 * Nhóm (`category`) là 9 khoá renderer 0.43 biết (bảng `MDe`): nhãn dịch theo khoá, khoá lạ hiện trần.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { MarketplaceRpcPort as MarketplacePort, WireListing, WireTemplateImportDetails } from "@grokbot2/cursor-acl";
import {
  botTemplateExistsAnyOwner, getPublicBotTemplate, hinhHopLe, listPublicBotTemplates, mauHopLe,
  ownerDisplayNameOf, recipeForBlob, setBotTemplateVisibility, templateOwnedBy, type BotTemplate, type TemplateRecipe,
} from "./bot-templates.js";

const DATA_DIR = process.env.GROKBOT2_DATA_DIR ?? join(dirname(fileURLToPath(import.meta.url)), "..", ".data");
const FILE = process.env.GROKBOT2_MARKETPLACE_FILE ?? join(DATA_DIR, "marketplace.json");

/** Chín nhóm của renderer 0.43 (`MDe`) — id là thứ đi trên dây, nhãn client tự dịch. */
export const CATEGORIES = [
  "engineering", "design", "marketing", "customer-support", "product", "ops-finance", "recruiting-people", "sales", "productivity",
] as const;
export type Category = (typeof CATEGORIES)[number];
export const laNhom = (s: unknown): s is Category => (CATEGORIES as readonly string[]).includes(String(s));

export interface Listing {
  slug: string;
  shareId: string;
  ownerAuthId: string;
  category: Category;
  categories: Category[];
  /** Hàng "nổi bật" — chỉ người vận hành máy chủ đặt được (xem `publishListing`). */
  featured: boolean;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface CreatorProfile {
  name: string;
  profilePhotoUrl: string;
  /** Tên trên các nền tảng, ví dụ `{ "x": "@ten", "github": "ten" }` — renderer hiện dưới tên người tạo. */
  handles: Record<string, string>;
}

interface Kho { listings: Listing[]; creators: Record<string, CreatorProfile> }

const KHONG_MO_TA = "(chưa có mô tả)";

function doc(): Kho {
  try {
    const raw = JSON.parse(readFileSync(FILE, "utf8")) as Partial<Kho>;
    return { listings: Array.isArray(raw.listings) ? raw.listings : [], creators: raw.creators && typeof raw.creators === "object" ? raw.creators : {} };
  } catch {
    return { listings: [], creators: {} };
  }
}

function ghi(k: Kho): void {
  mkdirSync(dirname(FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify(k, null, 2), { mode: 0o600 });
}

/** `Tên Bot Kế Toán` → `ten-bot-ke-toan-<6 ký tự shareId>` — ASCII, ổn định theo shareId, không trùng. */
export function slugOf(name: string, shareId: string): string {
  const goc = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "bot";
  return `${goc}-${shareId.slice(0, 6).toLowerCase().replace(/[^a-z0-9]/g, "x")}`;
}

// ── Hồ sơ người tạo ─────────────────────────────────────────────────────────────────────────────

/** Hồ sơ của một chủ — chưa đặt thì tên suy từ tài khoản (như `ownerDisplayNameOf`), ảnh rỗng. */
export function creatorProfileOf(authId: string): CreatorProfile {
  const c = doc().creators[authId];
  return {
    name: (c?.name ?? "").trim() || ownerDisplayNameOf(authId),
    profilePhotoUrl: typeof c?.profilePhotoUrl === "string" ? c.profilePhotoUrl : "",
    handles: c?.handles && typeof c.handles === "object" ? { ...c.handles } : {},
  };
}

/** Đặt/sửa hồ sơ. Chỉ nhận chuỗi; `handles` thay trọn (gửi `{}` để xoá hết). */
export function setCreatorProfile(authId: string, patch: { name?: unknown; profilePhotoUrl?: unknown; handles?: unknown }): CreatorProfile {
  const k = doc();
  const cu = creatorProfileOf(authId);
  const handles = patch.handles && typeof patch.handles === "object" && !Array.isArray(patch.handles)
    ? Object.fromEntries(Object.entries(patch.handles as Record<string, unknown>).filter(([, v]) => typeof v === "string" && v.trim()).map(([a, v]) => [a.trim(), String(v).trim()]))
    : cu.handles;
  const moi: CreatorProfile = {
    name: typeof patch.name === "string" && patch.name.trim() ? patch.name.trim().slice(0, 80) : cu.name,
    profilePhotoUrl: typeof patch.profilePhotoUrl === "string" ? patch.profilePhotoUrl.trim().slice(0, 500) : cu.profilePhotoUrl,
    handles,
  };
  ghi({ ...k, creators: { ...k.creators, [authId]: moi } });
  return moi;
}

// ── Listing ─────────────────────────────────────────────────────────────────────────────────────

export interface PublishListingArgs { shareId: string; category: string; categories?: unknown; featured?: unknown }

/**
 * Đăng mẫu của CHÍNH MÌNH lên cộng đồng. Mẫu phải đã xuất bản; tầm nhìn tự chuyển sang `public`
 * (đăng lên cộng đồng mà giữ `team` là mâu thuẫn — chọn nghĩa người dùng muốn). Đăng lại thì cập
 * nhật nhóm, giữ slug. `featured` chỉ người vận hành (`operatorAuthId`) đặt được — cờ này là biên tập,
 * không phải tự khai.
 */
export function publishListing(a: PublishListingArgs, owner: string, operatorAuthId?: string): Listing {
  const t = templateOwnedBy(a.shareId, owner);
  if (!t) throw new Error("không có mẫu nào mang shareId đó trong kho của bạn — chia sẻ bot thành mẫu trước (share_bot_template)");
  if (!t.published || t.activeVersion == null) throw new Error("mẫu chưa xuất bản (publishBotTemplate) — chưa có bản nào để người khác import");
  if (!laNhom(a.category)) throw new Error(`nhóm phải là một trong: ${CATEGORIES.join(", ")}`);
  const them = Array.isArray(a.categories) ? a.categories.filter(laNhom) : [];
  const categories = [...new Set<Category>([a.category, ...them])];
  if (t.visibility !== "public") setBotTemplateVisibility(t.shareId, "public", owner);
  const k = doc();
  const now = Date.now();
  const cu = k.listings.find((l) => l.shareId === a.shareId);
  const featured = operatorAuthId != null && owner === operatorAuthId && a.featured != null ? a.featured === true : cu?.featured ?? false;
  const moi: Listing = {
    slug: cu?.slug ?? slugOf(t.name, t.shareId),
    shareId: t.shareId,
    ownerAuthId: owner,
    category: a.category,
    categories,
    featured,
    createdAtMs: cu?.createdAtMs ?? now,
    updatedAtMs: now,
  };
  ghi({ ...k, listings: [...k.listings.filter((l) => l.shareId !== a.shareId), moi] });
  return moi;
}

/** Rút khỏi cộng đồng. Mẫu vẫn còn, vẫn import được qua link chia sẻ — chỉ không còn trong danh sách. */
export function unpublishListing(shareId: string, owner: string): boolean {
  const k = doc();
  const co = k.listings.some((l) => l.shareId === shareId && l.ownerAuthId === owner);
  if (co) ghi({ ...k, listings: k.listings.filter((l) => !(l.shareId === shareId && l.ownerAuthId === owner)) });
  return co;
}

export const listingsOf = (owner: string): Listing[] => doc().listings.filter((l) => l.ownerAuthId === owner);

/** Ghép listing với mẫu còn công khai; mẫu rút về team / bị xoá thì listing không hiện. */
function viewOf(l: Listing, t: BotTemplate): WireListing {
  const c = creatorProfileOf(l.ownerAuthId);
  return {
    slug: l.slug,
    name: t.name,
    description: t.description.trim() || KHONG_MO_TA,
    avatar: t.imageUrl ? { kind: "image", url: t.imageUrl } : { kind: "default", shape: hinhHopLe(t.avatarShape), color: mauHopLe(t.avatarColor) },
    category: l.category,
    categories: l.categories,
    createdAtMs: l.createdAtMs,
    updatedAtMs: Math.max(l.updatedAtMs, t.updatedAtMs),
    shareId: l.shareId,
    creator: { name: c.name, ...(c.profilePhotoUrl ? { profilePhotoUrl: c.profilePhotoUrl } : {}), handles: c.handles },
  };
}

export function publicListings(category?: string): { featured: WireListing[]; listings: WireListing[] } {
  const congKhai = new Map(listPublicBotTemplates().map((t) => [t.shareId, t]));
  const rows = doc().listings
    .filter((l) => !category || l.category === category || l.categories.includes(category as Category))
    .flatMap((l) => { const t = congKhai.get(l.shareId); return t && t.ownerAuthId === l.ownerAuthId ? [viewOf(l, t)] : []; })
    .sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  const featuredIds = new Set(doc().listings.filter((l) => l.featured).map((l) => l.shareId));
  return { featured: rows.filter((r) => featuredIds.has(r.shareId)), listings: rows.filter((r) => !featuredIds.has(r.shareId)) };
}

export function listingBySlug(slug: string): WireListing | null {
  const l = doc().listings.find((x) => x.slug === slug);
  if (!l) return null;
  const t = getPublicBotTemplate(l.shareId)?.template;
  return t && t.ownerAuthId === l.ownerAuthId ? viewOf(l, t) : null;
}

// ── Blob recipe + cổng RPC ──────────────────────────────────────────────────────────────────────

export const blobPathOf = (shareId: string, version: number): string => `/gw/bot-template-blob/${shareId}/${version}.json`;

/** Recipe của bản ĐANG ACTIVE của một mẫu công khai — thứ main 0.43 tải rồi parse bằng zod `Dct`. */
export function recipeBlob(shareId: string, version: number): TemplateRecipe | null {
  const t = getPublicBotTemplate(shareId)?.template;
  if (!t || t.activeVersion == null || t.activeVersion !== version) return null;
  return recipeForBlob(t);
}

/** Cổng cho `RpcCtx.marketplace`; `baseUrl` là địa chỉ máy chủ như CLIENT thấy (để dựng `blob_get_url`). */
export function marketplacePortFor(baseUrl: string): MarketplacePort {
  const goc = baseUrl.replace(/\/+$/, "");
  const details = (shareId: string): WireTemplateImportDetails | "not_found" | "permission_denied" => {
    const pub = getPublicBotTemplate(shareId);
    if (!pub) return botTemplateExistsAnyOwner(shareId) ? "permission_denied" : "not_found";
    const t = pub.template;
    const version = t.activeVersion ?? 0;
    return {
      template: {
        shareId: t.shareId, name: t.name, description: t.description.trim() || KHONG_MO_TA,
        avatarShape: hinhHopLe(t.avatarShape), avatarColor: mauHopLe(t.avatarColor),
        createdAtMs: t.createdAtMs, updatedAtMs: t.updatedAtMs, published: t.published, activeVersion: version,
        visibility: "public", imageUrl: t.imageUrl,
      },
      blobGetUrl: `${goc}${blobPathOf(t.shareId, version)}`,
      expectedActiveVersion: version,
      creatorDisplayName: creatorProfileOf(t.ownerAuthId).name,
    };
  };
  return {
    listListings: (category) => publicListings(category),
    templateImportDetails: details,
    listingBySlug: (slug) => {
      const l = listingBySlug(slug);
      if (!l) return null;
      const d = details(l.shareId);
      return typeof d === "string" ? null : { listing: l, templateGetUrl: d.blobGetUrl };
    },
  };
}

/** Kho có gì — cho trang admin / bài đo. */
export const marketplaceStoreExists = (): boolean => existsSync(FILE);
