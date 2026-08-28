/**
 * Tuỳ chọn MCP theo từng người: tắt bớt tool, và lời dặn riêng cho từng server.
 *
 * ── Vì sao có file này ──────────────────────────────────────────────────────────────────────────
 *
 * Mặt phẳng MCP của backend này tới nay **chỉ đọc**: xem được danh mục, xem được trạng thái, nhưng
 * `toggleMcpToolDisabled` / `setMcpCustomInstructions` / `installMcpEntry` … đều không có, nên
 * router trả 404 mềm và các nút trong pane Plugins bấm không ra gì. Hình dạng đối số lấy nguyên từ
 * bundle 0.29:
 *
 *     toggleMcpToolDisabled:v().args({serverId:C(),toolName:C()})
 *     setMcpCustomInstructions:v().args({serverId:C(),instructions:C()})
 *
 * ── Hai quyết định, và lý do ────────────────────────────────────────────────────────────────────
 *
 * **1. Theo NGƯỜI.** Backend này phục vụ nhiều người trên một hộp. Một kho dùng chung nghĩa là
 * người này tắt tool của người kia, hoặc nhét được lời dặn vào lời nhắc hệ thống của người kia —
 * cái sau là chiếm quyền điều khiển bot của người khác, không phải bất tiện nhỏ.
 *
 * **2. Phải có TÁC DỤNG THẬT, không phải cờ để đó.** Bài học vừa trả giá ở thẻ nháp: ghi một cờ mà
 * không chỗ nào đọc thì nút vẫn chết y như cũ, chỉ khác là ta tự nhủ đã xong. Nên "tắt tool" phải
 * cắt tool khỏi CẢ hai đường: danh sách `get_mcp_tools` model đọc, VÀ `call_mcp_tool` model gọi —
 * chỉ giấu khỏi danh sách thì model vẫn gọi được bằng tên nó nhớ từ lượt trước.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { currentOwner } from "./request-context.js";

/**
 * Nơi kho này ghi.
 *
 * Đọc `GROKBOT2_DATA_DIR` TRƯỚC — `mcp.ts` đã ghi cảnh báo về đúng cái bẫy này: đường dẫn suy từ vị
 * trí module thì nó đi theo mã và **bỏ qua mọi biến cách ly của bài test**, nên một lần chạy thử
 * ghi thẳng vào `.data` thật của người dùng. Đo được ngày 28/08: các lần chạy E2E để lại mẫu bot
 * rác trong kho thật, và một trong số đó làm chính bài test sau đó đọc nhầm.
 */
const DATA_DIR = process.env.GROKBOT2_DATA_DIR ?? join(dirname(fileURLToPath(import.meta.url)), "..", ".data");
const DIR = join(DATA_DIR, "mcp-prefs");

/** Cùng phép lọc tên file với box-secrets/displays — một danh tính không được thoát ra khỏi tên file. */
const safe = (authId: string): string => authId.replace(/[^A-Za-z0-9_-]/g, "_");
const fileFor = (owner: string): string => join(DIR, `${safe(owner)}.json`);

interface Prefs {
  /** serverId → tên các tool bị tắt. */
  disabled: Record<string, string[]>;
  /** serverId → lời dặn riêng, ghép vào lời nhắc hệ thống. */
  instructions: Record<string, string>;
}

/**
 * Trạng thái rỗng, dựng MỚI mỗi lần.
 *
 * Bản đầu viết `const EMPTY = {disabled:{},instructions:{}}` rồi trả `{...EMPTY}` — sao chép NÔNG,
 * nên `disabled` vẫn là đúng cái object của hằng số. Lần ghi đầu tiên (khi chưa có file) mutate
 * thẳng vào hằng, và từ đó mọi lần đọc "rỗng" đều mang theo rác của lần trước: tool người này tắt
 * hiện sang người kia. Bài `mcp-prefs.test.ts` bắt đúng ca này.
 */
const empty = (): Prefs => ({ disabled: {}, instructions: {} });

function read(owner: string): Prefs {
  try {
    const raw = JSON.parse(readFileSync(fileFor(owner), "utf8")) as unknown;
    if (!raw || typeof raw !== "object") return empty();
    const o = raw as Partial<Prefs>;
    const disabled: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(o.disabled ?? {})) {
      if (Array.isArray(v)) disabled[k] = v.filter((x): x is string => typeof x === "string");
    }
    const instructions: Record<string, string> = {};
    for (const [k, v] of Object.entries(o.instructions ?? {})) {
      if (typeof v === "string" && v.trim()) instructions[k] = v;
    }
    return { disabled, instructions };
  } catch {
    return empty();
  }
}

function write(owner: string, p: Prefs): void {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(fileFor(owner), JSON.stringify(p, null, 2), { mode: 0o600 });
}

/** Tool này có đang bị tắt không. Đường nóng — gọi mỗi lần dựng danh sách tool và mỗi lần gọi tool. */
export function isToolDisabled(serverId: string, toolName: string, owner: string = currentOwner()): boolean {
  return (read(owner).disabled[serverId] ?? []).includes(toolName);
}

/** Các tool đang tắt của một server. */
export const disabledToolsOf = (serverId: string, owner: string = currentOwner()): string[] =>
  [...(read(owner).disabled[serverId] ?? [])];

/**
 * Bật/tắt một tool. Trả về trạng thái SAU khi đổi — client vẽ lại theo giá trị này, nên trả
 * `{}` là buộc nó đoán.
 */
export function toggleToolDisabled(
  serverId: string, toolName: string, owner: string = currentOwner(),
): { serverId: string; toolName: string; disabled: boolean } {
  if (!serverId || !toolName) return { serverId, toolName, disabled: false };
  const p = read(owner);
  const cur = p.disabled[serverId] ?? [];
  const on = cur.includes(toolName);
  p.disabled[serverId] = on ? cur.filter((t) => t !== toolName) : [...cur, toolName];
  if (p.disabled[serverId].length === 0) delete p.disabled[serverId];
  write(owner, p);
  return { serverId, toolName, disabled: !on };
}

/** Lời dặn riêng cho một server, hoặc chuỗi rỗng. */
export const customInstructionsOf = (serverId: string, owner: string = currentOwner()): string =>
  read(owner).instructions[serverId] ?? "";

/** Tất cả lời dặn đang đặt — dùng khi dựng lời nhắc hệ thống. */
export const allInstructions = (owner: string = currentOwner()): Record<string, string> =>
  read(owner).instructions;

/**
 * Đặt lời dặn cho một server. Chuỗi rỗng là cách nói "bỏ đi" — cùng quy ước với `setBoxSecrets`,
 * để không phải thêm một lệnh xoá nữa.
 *
 * Cắt ở 2000 ký tự: lời dặn đi vào MỌI lượt chat, nên một bức thư dài ở đây là thuế đánh lên từng
 * lượt, và là chỗ dễ nhét cả một prompt lạ vào.
 */
export function setCustomInstructions(
  serverId: string, instructions: string, owner: string = currentOwner(),
): { serverId: string; instructions: string } {
  if (!serverId) return { serverId, instructions: "" };
  const p = read(owner);
  const text = String(instructions ?? "").trim().slice(0, 2000);
  if (text) p.instructions[serverId] = text;
  else delete p.instructions[serverId];
  write(owner, p);
  return { serverId, instructions: text };
}
