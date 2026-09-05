/**
 * Marketplace bot + template công khai — ba RPC của `aiserver.v1.GrokBotService` mà client 0.43 gọi
 * từ **main process** (không đi qua box gateway):
 *
 *   ListPublicGrokBotMarketplaceListings {category?, page_size, page_token}
 *     → {featured_listings[], listings[], next_page_token}
 *   GetGrokBotTemplateImportDetails {share_id}
 *     → {template: GrokBotTemplate, blob_get_url, expected_active_version, creator_display_name}
 *       main tải `blob_get_url` bằng `fetch` trần (không header), parse JSON theo zod `Dct`, rồi dựng
 *       `BotTemplateImport` cho renderer. NotFound ⇒ renderer thấy `null`; PermissionDenied ⇒ lỗi
 *       "bot_template_import_access_denied".
 *   GetPublicGrokBotMarketplaceListing {slug} → {listing, template_get_url}
 *
 * Số field chép từ `proto.cjs` 0.43 (đọc 05/09):
 *   PublicGrokBotMarketplaceListing  1 slug · 2 name · 3 description · 4 image_url | 5 default_avatar{1 shape, 2 color}
 *                                    · 6 category · 7 created_at_ms (int64) · 8 updated_at_ms · 9 share_id
 *                                    · 10 creator{1 name, 2 profile_photo_url, 3 handles map<string,string>} · 11 categories[]
 *   GrokBotTemplate                  1 share_id · 2 name · 3 avatar_shape · 4 avatar_color · 7 created_at_ms · 8 updated_at_ms
 *                                    · 10 published · 11 active_version (uint32) · 12 description
 *                                    · 13 visibility (PUBLIC=1, TEAM=2) · 14 owner_type (USER=1) · 15 image_url?
 *
 * Gói này thuần protobuf: kho listing, kho mẫu và địa chỉ blob là việc của backend, đưa xuống qua
 * `MarketplacePort`. Vắng port ⇒ danh sách rỗng và mọi shareId là NotFound — app vẽ Marketplace trống,
 * không vỡ.
 */
import { message, pbStr, pbVar, pbBool, pbMsg, unframe } from "./encode.js";
import { readString } from "./decode.js";

export interface WireCreator {
  name: string;
  profilePhotoUrl?: string;
  handles?: Record<string, string>;
}

export type WireAvatar = { kind: "image"; url: string } | { kind: "default"; shape: string; color: string };

export interface WireListing {
  slug: string;
  name: string;
  description: string;
  avatar: WireAvatar;
  category: string;
  categories: string[];
  createdAtMs: number;
  updatedAtMs: number;
  shareId: string;
  creator: WireCreator;
}

export interface WireTemplate {
  shareId: string;
  name: string;
  description: string;
  avatarShape: string;
  avatarColor: string;
  createdAtMs: number;
  updatedAtMs: number;
  published: boolean;
  activeVersion: number;
  visibility: "public" | "team";
  imageUrl?: string | null;
}

export interface WireTemplateImportDetails {
  template: WireTemplate;
  /** Địa chỉ main sẽ `fetch` không header — phải tới được mà không cần vé cổng. */
  blobGetUrl: string;
  expectedActiveVersion: number;
  creatorDisplayName: string;
}

/** Cổng backend cắm vào `RpcCtx.marketplace`. */
export interface MarketplacePort {
  listListings(category?: string): { featured: WireListing[]; listings: WireListing[] };
  /** `"not_found"` = không có mẫu; `"permission_denied"` = có nhưng không public/chưa xuất bản. */
  templateImportDetails(shareId: string): WireTemplateImportDetails | "not_found" | "permission_denied";
  listingBySlug(slug: string): { listing: WireListing; templateGetUrl: string } | null;
}

/** Mã lỗi Connect mà một builder được ném — ACL đổi thành HTTP + JSON đúng giao thức. */
export type ConnectCode = "not_found" | "permission_denied" | "invalid_argument";
export const CONNECT_HTTP_STATUS: Record<ConnectCode, number> = { not_found: 404, permission_denied: 403, invalid_argument: 400 };

export class ConnectRpcError extends Error {
  constructor(public readonly code: ConnectCode, message: string) {
    super(message);
    this.name = "ConnectRpcError";
  }
}

const VISIBILITY = { public: 1, team: 2 } as const;
const OWNER_TYPE_USER = 1;

const creatorMsg = (c: WireCreator): Buffer =>
  message(
    pbStr(1, c.name),
    c.profilePhotoUrl ? pbStr(2, c.profilePhotoUrl) : null,
    ...Object.entries(c.handles ?? {}).map(([k, v]) => pbMsg(3, message(pbStr(1, k), pbStr(2, v)))),
  );

export const listingMsg = (l: WireListing): Buffer =>
  message(
    pbStr(1, l.slug),
    pbStr(2, l.name),
    pbStr(3, l.description),
    l.avatar.kind === "image" ? pbStr(4, l.avatar.url) : pbMsg(5, message(pbStr(1, l.avatar.shape), pbStr(2, l.avatar.color))),
    pbStr(6, l.category),
    pbVar(7, Math.max(0, Math.floor(l.createdAtMs))),
    pbVar(8, Math.max(0, Math.floor(l.updatedAtMs))),
    pbStr(9, l.shareId),
    pbMsg(10, creatorMsg(l.creator)),
    ...l.categories.map((c) => pbStr(11, c)),
  );

export const templateMsg = (t: WireTemplate): Buffer =>
  message(
    pbStr(1, t.shareId),
    pbStr(2, t.name),
    pbStr(3, t.avatarShape),
    pbStr(4, t.avatarColor),
    pbVar(7, Math.max(0, Math.floor(t.createdAtMs))),
    pbVar(8, Math.max(0, Math.floor(t.updatedAtMs))),
    pbBool(10, t.published),
    pbVar(11, Math.max(0, t.activeVersion)),
    pbStr(12, t.description),
    pbVar(13, VISIBILITY[t.visibility]),
    pbVar(14, OWNER_TYPE_USER),
    t.imageUrl ? pbStr(15, t.imageUrl) : null,
  );

const unframed = (body?: Buffer): Buffer | null => (body && body.length ? unframe(body) : null);

/** `ListPublicGrokBotMarketplaceListings` — một trang, `next_page_token` rỗng (main lặp tới khi rỗng). */
export function listMarketplaceResponse(port: MarketplacePort | undefined, body?: Buffer): Buffer {
  const req = unframed(body);
  const category = req ? readString(req, 1) : "";
  const all = port?.listListings(category || undefined) ?? { featured: [], listings: [] };
  return message(
    ...all.featured.map((l) => pbMsg(1, listingMsg(l))),
    ...all.listings.map((l) => pbMsg(2, listingMsg(l))),
    pbStr(3, ""),
  );
}

/** `GetGrokBotTemplateImportDetails` — ném `ConnectRpcError` thay cho hai mã lỗi main phân biệt. */
export function templateImportDetailsResponse(port: MarketplacePort | undefined, body?: Buffer): Buffer {
  const req = unframed(body);
  const shareId = req ? readString(req, 1) : "";
  const r = port?.templateImportDetails(shareId) ?? "not_found";
  if (r === "not_found") throw new ConnectRpcError("not_found", `no public bot template ${shareId}`);
  if (r === "permission_denied") throw new ConnectRpcError("permission_denied", `bot template ${shareId} is not public`);
  return message(
    pbMsg(1, templateMsg(r.template)),
    pbStr(2, r.blobGetUrl),
    pbVar(3, Math.max(0, r.expectedActiveVersion)),
    pbStr(4, r.creatorDisplayName),
  );
}

/** `GetPublicGrokBotMarketplaceListing{slug}` → `{listing, template_get_url}`. */
export function publicListingResponse(port: MarketplacePort | undefined, body?: Buffer): Buffer {
  const req = unframed(body);
  const slug = req ? readString(req, 1) : "";
  const r = port?.listingBySlug(slug) ?? null;
  if (!r) throw new ConnectRpcError("not_found", `no marketplace listing ${slug}`);
  return message(pbMsg(1, listingMsg(r.listing)), pbStr(2, r.templateGetUrl));
}
