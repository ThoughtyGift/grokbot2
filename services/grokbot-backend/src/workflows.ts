/**
 * Kho **workflow** — thứ client gọi là "Skill" và hiện trong menu `/` của khung soạn.
 *
 * ── Vì sao có file này ──────────────────────────────────────────────────────────────────────────
 *
 * Hợp đồng 0.30 có 14 lệnh workflow/skill, và bên mình trả rỗng hết:
 *
 *     const LOCAL_WORKFLOWS: unknown[] = [];
 *     getAgentWorkflows:   () => LOCAL_WORKFLOWS,
 *     createAgentWorkflow: () => LOCAL_WORKFLOWS,
 *     skillsCatalog:       () => [],
 *
 * Client map mảng rỗng thành "không có gì" (`C => C.length === 0 ? null : C`), nên menu `/` bên
 * mình **không thể** có mục nào — không phải vì thiếu tính năng, mà vì cái kho chứa nó trả rỗng.
 * Điều đó cũng chặn luôn đường nâng cấp teach: app gốc bản mới biến một buổi dạy thành **skill**
 * (`learn-from-demonstration`), còn bên mình chỉ lưu được thành routine chạy theo lịch.
 *
 * ── Shape: ĐO từ client, không đoán ─────────────────────────────────────────────────────────────
 *
 * Hợp đồng chỉ nói `getAgentWorkflows:{args:"object",reply:"array"}` — không nói phần tử có gì, và
 * bundle renderer trích được không chứa component vẽ panel skill. Nên tôi đưa client một mục mang
 * đủ mọi field khả dĩ rồi xem cái nào lên màn hình (31/08):
 *
 *     name         → HIỆN (nhãn trong menu `/`)
 *     description  → HIỆN (dòng mô tả bên cạnh)
 *     title        → bỏ qua
 *     body         → bỏ qua
 *
 * Nên `name` + `description` là hai field bắt buộc; `instructions` là phần ruột bot đọc khi chạy,
 * client hiện nó trong panel chi tiết. `source: "workflow"` quyết định mục có nằm trong nhóm
 * "Yours → Private" hay không — renderer lọc đúng chuỗi đó
 * (`t.source === "workflow" ? !0 : t.source === "plugin" && t.publishedByCurrentUser`).
 *
 * ── Mọi lệnh ĐỔI đều trả về CẢ DANH SÁCH ────────────────────────────────────────────────────────
 *
 * Giống routine: FE lưu phản hồi làm danh sách mới thay vì hỏi lại. Trả `{ok:true}` cho một lệnh
 * tạo sẽ hiện ra đúng như "tạo xong rồi biến mất" — bài học đã trả giá ở `automations.ts`.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Một skill của bot. Hẹp có chủ ý: chỉ thứ client đọc, cộng thứ ta cần để chạy lại. */
export interface Workflow {
  id: string;
  /** Nhãn trong menu `/`. Ngắn, mệnh lệnh — "Đặt hàng trên Shopee". */
  name: string;
  /** Một dòng nói khi nào dùng. Client vẽ ngay cạnh tên. */
  description: string;
  /** Phần ruột: các bước, viết chung chung để dùng lại được. Bot đọc khi chạy. */
  instructions: string;
  /** Bot sở hữu. Menu `/` hỏi theo từng bot. */
  agentId: string;
  /** `"workflow"` = do người dùng/bot tạo tại chỗ. Renderer lọc đúng chuỗi này. */
  source: "workflow";
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  /**
   * Buổi dạy sinh ra nó, nếu có — để lần sau còn truy được skill này học từ đâu.
   * Rỗng nghĩa là người dùng (hoặc bot) tự viết.
   */
  teachSessionId?: string;
}

/*
 * Đường dẫn tính LƯỜI, và đọc được từ biến môi trường — vì bộ test đã ghi đè kho thật một lần.
 *
 * `workflows.test.ts` gọi `create()` thật, `create()` gọi `luu()`, và `luu()` ghi vào `.data` của
 * máy đang chạy. Chạy `npx tsx --test` một lần là menu `/` của người dùng mọc thêm "dat-hang",
 * "của A", "một", "hai" — dữ liệu test nằm lẫn trong dữ liệu thật.
 *
 * Repo này đã có đúng bẫy đó ghi trong bảng theo dõi ("Sổ trắng hoá ra không trắng": ba hằng số
 * trỏ về `.data` của máy thật). Tôi vừa thêm cái thứ tư.
 */
const FILE = (): string =>
  process.env.GROKBOT2_WORKFLOWS_FILE
  || join(dirname(fileURLToPath(import.meta.url)), "..", ".data", "workflows.json");

/** id → workflow. Một Map cho cả cài đặt; lọc theo `agentId` khi trả lời. */
const kho = new Map<string, Workflow>();

/*
 * Trần số lượng.
 *
 * Menu `/` là một danh sách người phải đọc bằng mắt; 200 skill trong đó thì không ai tìm nổi cái
 * mình cần, và mỗi buổi dạy lại đẻ thêm một cái. Cắt cũ nhất trước, và chỉ cắt khi vượt trần.
 */
const TOI_DA = 60;

const luu = (): void => {
  try {
    mkdirSync(dirname(FILE()), { recursive: true });
    const ds = [...kho.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, TOI_DA);
    writeFileSync(FILE(), JSON.stringify(ds, null, 2), "utf8");
  } catch {
    // Đĩa đầy hay quyền ghi. Skill mất qua lần khởi động sau là tệ, nhưng làm hỏng lượt đang chạy
    // còn tệ hơn — cùng lối xử lý với `may-da-biet.ts`.
  }
};

/** Nạp kho từ đĩa. Gọi một lần lúc backend lên. */
export function napWorkflows(): number {
  try {
    const ds = JSON.parse(readFileSync(FILE(), "utf8")) as Workflow[];
    for (const w of Array.isArray(ds) ? ds : []) {
      if (typeof w?.id === "string" && typeof w?.name === "string" && typeof w?.agentId === "string") {
        kho.set(w.id, {
          id: w.id,
          name: w.name,
          description: String(w.description ?? ""),
          instructions: String(w.instructions ?? ""),
          agentId: w.agentId,
          source: "workflow",
          enabled: w.enabled !== false,
          createdAt: Number(w.createdAt) || Date.now(),
          updatedAt: Number(w.updatedAt) || Date.now(),
          ...(w.teachSessionId ? { teachSessionId: w.teachSessionId } : {}),
        });
      }
    }
  } catch {
    // Chưa có file (lần chạy đầu) hoặc file hỏng — kho rỗng, không phải lỗi.
  }
  return kho.size;
}

const idOf = (a: unknown): string => {
  const o = (a ?? {}) as Record<string, unknown>;
  for (const k of ["agentId", "id", "parentAgentId"]) {
    const v = o[k];
    if (typeof v === "string" && v) return v;
  }
  return "";
};

/** Danh sách của một bot, mới sửa lên trước. */
export function forAgent(args: unknown): Workflow[] {
  const agentId = idOf(args);
  const ds = [...kho.values()].filter((w) => !agentId || w.agentId === agentId);
  return ds.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Toàn bộ skill của cài đặt này — `skillsCatalog` không hỏi theo bot. */
export const listAll = (): Workflow[] => [...kho.values()].sort((a, b) => b.updatedAt - a.updatedAt);

let dem = 0;
const idMoi = (): string => `wf-${Date.now().toString(36)}-${(dem += 1).toString(36)}`;

/**
 * Tạo một skill.
 *
 * Tên trống thì đặt tạm, KHÔNG từ chối: lệnh này đến từ cả client lẫn `desktop_teach_stop`, và một
 * buổi dạy xong mà mất trắng vì thiếu cái tên là kết cục tệ nhất trong các kết cục.
 */
export function create(args: unknown): Workflow[] {
  const a = (args ?? {}) as Record<string, unknown>;
  const agentId = idOf(a);
  const now = Date.now();
  const w: Workflow = {
    id: idMoi(),
    name: String(a.name ?? "").trim() || "Skill chưa đặt tên",
    description: String(a.description ?? "").trim(),
    instructions: String(a.instructions ?? "").trim(),
    agentId,
    source: "workflow",
    enabled: a.enabled !== false,
    createdAt: now,
    updatedAt: now,
    ...(typeof a.teachSessionId === "string" && a.teachSessionId ? { teachSessionId: a.teachSessionId } : {}),
  };
  kho.set(w.id, w);
  luu();
  return forAgent({ agentId });
}

/** Sửa. Field không gửi thì giữ nguyên — client gửi patch, không gửi cả bản ghi. */
export function update(args: unknown): Workflow[] {
  const a = (args ?? {}) as Record<string, unknown>;
  const id = String(a.workflowId ?? a.id ?? "");
  const cu = kho.get(id);
  if (!cu) return forAgent(a);
  const moi: Workflow = {
    ...cu,
    ...(typeof a.name === "string" ? { name: a.name.trim() || cu.name } : {}),
    ...(typeof a.description === "string" ? { description: a.description } : {}),
    ...(typeof a.instructions === "string" ? { instructions: a.instructions } : {}),
    ...(typeof a.enabled === "boolean" ? { enabled: a.enabled } : {}),
    updatedAt: Date.now(),
  };
  kho.set(id, moi);
  luu();
  return forAgent({ agentId: moi.agentId });
}

export function setEnabled(args: unknown): Workflow[] {
  const a = (args ?? {}) as Record<string, unknown>;
  return update({ ...a, enabled: a.enabled !== false });
}

export function remove(args: unknown): Workflow[] {
  const a = (args ?? {}) as Record<string, unknown>;
  const id = String(a.workflowId ?? a.id ?? "");
  const cu = kho.get(id);
  if (cu) { kho.delete(id); luu(); }
  // Trả danh sách của ĐÚNG bot vừa mất một mục: `idOf(a)` có thể là chính id workflow khi client
  // gửi `{id}` trần, và khi đó lọc theo nó ra rỗng — client sẽ tưởng mọi skill vừa biến mất.
  return forAgent({ agentId: cu?.agentId ?? idOf(a) });
}

/** Tra một skill để chạy. `null` khi không có. */
export function byId(id: string): Workflow | null {
  return kho.get(id) ?? null;
}

/** Chỉ dùng trong test — kho là trạng thái toàn cục của tiến trình. */
export function _xoaHet(): void {
  kho.clear();
}

/**
 * Người dùng vừa gọi skill nào trong tin này?
 *
 * ── Hợp đồng, đo từ chính client 31/08 ──────────────────────────────────────────────────────────
 *
 * Chọn một skill trong menu `/` KHÔNG gọi lệnh nào lên backend. Client chèn vào khung soạn một chip
 * (`span[data-type="skill-reference"]`, class `sand-skill-chip`), và khi gửi thì chip serialize
 * thành `@<tên skill>` trong chính nội dung tin:
 *
 *     message · @hoc-tu-buoi-day
 *
 * Nên `runAgentWorkflowNow` không phải đường chạy skill — nó là nút "Run" trong bảng. Đường thật là
 * đọc `@tên` ra khỏi tin người dùng, đúng như @-mention.
 *
 * ── Khớp tên: chặt, không mò ────────────────────────────────────────────────────────────────────
 *
 * Chỉ khớp tên ĐÚNG NGUYÊN VĂN của một skill thuộc chính bot này. Không khớp gần đúng, không
 * chuẩn hoá dấu: một email trong tin nhắn cũng có `@`, và nạp nhầm cả bản hướng dẫn vào một lượt
 * chẳng liên quan thì bot đổi tính giữa cuộc trò chuyện mà không ai hiểu vì sao.
 */
export function skillDuocGoi(agentId: string, text: string): Workflow[] {
  const t = String(text ?? "");
  if (!t.includes("@")) return [];
  return forAgent({ agentId }).filter((w) => {
    if (!w.enabled || !w.name) return false;
    const i = t.indexOf(`@${w.name}`);
    if (i < 0) return false;
    /*
     * Ký tự ngay sau tên phải kết thúc lời gọi. Hai bẫy, cả hai đều có bài test:
     *
     *   `@dat` trong "@dat-hang"          → `-` không kết thúc gì cả: đó là skill KHÁC.
     *   `@dat` trong "@dat.nguyen@cinai.tv" → dấu chấm ở đây nối tiếp một địa chỉ, không phải hết câu.
     *
     * Nên `.` chỉ được tính là kết thúc khi sau nó là khoảng trắng hoặc hết chuỗi — đúng cách một
     * dấu chấm câu hành xử, và khác hẳn dấu chấm giữa một địa chỉ email.
     */
    const j = i + 1 + w.name.length;
    const sau = t[j];
    if (sau === undefined) return true;
    if (sau === ".") return t[j + 1] === undefined || /\s/.test(t[j + 1]);
    return /[\s,;:!?)\]}"']/.test(sau);
  });
}
