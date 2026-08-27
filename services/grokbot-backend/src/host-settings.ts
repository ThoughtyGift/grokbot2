/**
 * S1 · host settings — the app's own preferences, persisted next to the bots.
 *
 * They ride in `state.json` rather than a file of their own: they are written on the same
 * debounce as agents and transcripts, and splitting them would mean two files that can
 * disagree about the same save.
 */
import { loadState, scheduleSave } from "./store.js";
import { bindHostSettings, chatSnapshot } from "./chat/state.js";
import { currentOwner } from "./request-context.js";

/**
 * Khoá thuộc về NGƯỜI, không thuộc về máy — chặng 4.
 *
 * Khi hai tài khoản dùng chung một backend, múi giờ là của từng người (họ ngồi ở hai nơi), và bật
 * thông báo cũng vậy. Để chung thì người này đổi, người kia chịu. Mọi khoá KHÁC (danh sách MCP,
 * quyền tool…) là cài đặt của cái máy và đúng là dùng chung.
 *
 * Lưu dưới `byOwner[ownerId]` trong cùng blob JSON đã có — khỏi đổi bảng, cùng lối với `uiByOwner`.
 *
 * `hasSeenOnboarding` thuộc nhóm này, và nó **từng bị bỏ quên**: mặc định cứng là `true`, dùng chung
 * cho mọi người. Nên người dùng MỚI trên một backend đã chạy một thời gian bị app cho là "đã xem
 * giới thiệu rồi" và **nhảy thẳng vào giao diện chính, mất phần mở đầu**. Đúng triệu chứng đo được
 * trên máy thứ hai ngày 27/08. "Đã xem chưa" là chuyện của từng người, không phải của cái máy.
 */
const PER_USER_KEYS = new Set(["userTimeZone", "notifications", "hasSeenOnboarding"]);

/**
 * Gỡ khoá-theo-người ra khỏi blob dùng chung khi nạp — **bản vá cho máy đã chạy bản cũ**.
 *
 * Sửa mặc định thành `false` chỉ cứu được một kho TRỐNG. Backend nào đã chạy bản cũ thì trong
 * `state.json` còn nguyên `hasSeenOnboarding: true` ở mức dùng chung, do chính app ghi xuống hồi
 * nó còn là cài đặt của máy. Giá trị đó đè lên mặc định mãi mãi, nên mọi người MỚI vẫn bị coi là
 * "đã xem" và vẫn mất phần giới thiệu — đúng triệu chứng đã đo trên máy thứ hai, chỉ là bản vá
 * trước chưa với tới. VPS và máy này đều đang ở tình trạng đó.
 *
 * Cái giá: người đã dùng thật sẽ xem lại phần mở đầu đúng một lần, và múi giờ về mặc định cho
 * tới lần app gửi lên kế tiếp. Rẻ hơn nhiều so với việc mọi người mới đều mất phần mở đầu.
 */
function withoutPerUserKeys(saved: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(saved)) if (!PER_USER_KEYS.has(k)) out[k] = v;
  return out;
}

const settings: Record<string, unknown> = {
  notifications: { isEnabled: false },
  mcpCustomInstructions: "",
  mcpCustomInstructionsByServerId: {},
  mcpDisabledToolsByServerId: {},
  mcpBoxServers: [],
  autoReviewInstructions: { isEnabled: false, allowInstructions: [], blockInstructions: [] },
  localToolPermission: "ask",
  webauthnProxyEnabled: false,
  userTimeZone: "UTC",
  sidebarSections: [],
  /*
   * `false` là mặc định ĐÚNG, dù nó nghe như một bước lùi.
   *
   * `hostSettings()` trộn mặc định rồi đè phần riêng của người gọi lên, nên giá trị này chỉ áp dụng
   * cho **người chưa có slice nào** — tức người mới. Họ chưa xem giới thiệu thật, nên nói `true` là
   * nói dối, và app bỏ qua phần mở đầu.
   *
   * Người đã dùng rồi không bị ảnh hưởng: app ghi `hasSeenOnboarding: true` vào slice của họ ngay
   * lần xem đầu, và slice luôn thắng mặc định.
   */
  hasSeenOnboarding: false,
  uiByOwner: {},   // bố cục theo từng chủ sở hữu — xem `patchUiPrefs` ở cuối file
  byOwner: {},     // khoá theo người (múi giờ, thông báo) — xem PER_USER_KEYS
  ...withoutPerUserKeys(loadState().hostSettings ?? {}),   // restore persisted settings over the defaults
};

bindHostSettings(() => settings);   // so settings save alongside agents/transcripts

/** Phần theo người của một chủ sở hữu, hoặc rỗng. */
function ownerSlice(ownerId: string): Record<string, unknown> {
  const all = settings.byOwner;
  const mine = all && typeof all === "object" ? (all as Record<string, unknown>)[ownerId] : undefined;
  return mine && typeof mine === "object" ? (mine as Record<string, unknown>) : {};
}

/**
 * Cài đặt như người gọi HIỆN TẠI thấy: nền dùng chung, phủ khoá-the-người của họ lên trên.
 *
 * Gọi không tham số (gateway dùng `getHostSettings: hostSettings`) vẫn đúng: `currentOwner()` ngoài
 * một request trả về danh tính mặc định.
 */
export const hostSettings = (): Record<string, unknown> => ({ ...settings, ...ownerSlice(currentOwner()) });

/** The FE sends partial patches ({notifications:{…}}, {userTimeZone:…}) — merge, don't discard. */
export function patchHostSettings(patch: unknown): Record<string, unknown> {
  if (patch && typeof patch === "object") {
    const owner = currentOwner();
    const mine = { ...ownerSlice(owner) };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      if (PER_USER_KEYS.has(k)) mine[k] = v;   // của người này thôi
      else settings[k] = v;                    // cài đặt máy, dùng chung
    }
    const all = (settings.byOwner && typeof settings.byOwner === "object"
      ? { ...(settings.byOwner as Record<string, unknown>) } : {});
    all[owner] = mine;
    settings.byOwner = all;
  }
  scheduleSave(() => ({ ...chatSnapshot(), hostSettings: settings }));
  return hostSettings();
}

/**
 * Bố cục UI, tách theo từng chủ sở hữu.
 *
 * Vì sao không để thẳng vào `settings` như các khoá khác: những khoá kia là cài đặt của **cái máy**
 * (múi giờ, quyền tool, danh sách MCP) và đúng là dùng chung. Bề rộng sidebar thì không — hai tài
 * khoản cùng dùng một backend sẽ ghi đè bố cục của nhau. Nên nó nằm dưới `uiByOwner[ownerId]`,
 * trong cùng blob JSON đã có, khỏi phải đổi bảng.
 */
const UI_LIMITS = {
  sidebarWidth: [88, 400],
  paneWidth: [280, 480],
} as const;

const clampInt = (v: unknown, [lo, hi]: readonly [number, number]): number | undefined => {
  const n = typeof v === "number" ? Math.round(v) : Number.NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : undefined;
};

export function uiPrefs(ownerId: string): Record<string, unknown> {
  const all = settings.uiByOwner;
  const mine = all && typeof all === "object" ? (all as Record<string, unknown>)[ownerId] : undefined;
  return mine && typeof mine === "object" ? { ...(mine as Record<string, unknown>) } : {};
}

/**
 * Kẹp ở đây, không chỉ ở FE.
 *
 * Ngưỡng là số đo được trên app gốc (`x-ray --drag`): sidebar 88–400, panel phải 280–480. Một
 * client hỏng ghi `sidebarWidth: 5000` thì lần mở sau app không dùng được và người dùng không hiểu
 * vì sao — kẹp thì họ chỉ thấy nó dừng ở mép, đúng như app gốc.
 */
export function patchUiPrefs(ownerId: string, patch: unknown): Record<string, unknown> {
  if (!patch || typeof patch !== "object") return uiPrefs(ownerId);
  const next = uiPrefs(ownerId);
  const p = patch as Record<string, unknown>;
  for (const key of ["sidebarWidth", "paneWidth"] as const) {
    if (key in p) {
      const v = clampInt(p[key], UI_LIMITS[key]);
      if (v !== undefined) next[key] = v;
    }
  }
  for (const key of ["sidebarCollapsed", "paneOpen"] as const) {
    if (typeof p[key] === "boolean") next[key] = p[key];
  }
  const all = (settings.uiByOwner && typeof settings.uiByOwner === "object"
    ? { ...(settings.uiByOwner as Record<string, unknown>) } : {});
  all[ownerId] = next;
  settings.uiByOwner = all;
  scheduleSave(() => ({ ...chatSnapshot(), hostSettings: settings }));
  return next;
}
