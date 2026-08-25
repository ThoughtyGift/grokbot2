/**
 * Skill — SOP dạng file, đọc từ đĩa của box.
 *
 * Chép cơ chế của bản gốc chứ không nghĩ lại: prompt của họ nói thẳng "Skills are SOPs for
 * performing specific tasks. The first user message will specify the skills that are available to
 * you, each with a filepath and a description of the scenario in which it should be used."
 *
 * Điểm cốt lõi là **công bố dần**: prompt chỉ mang ĐƯỜNG DẪN + MÔ TẢ, không mang nội dung. Bot đọc
 * file khi thấy liên quan. Nhồi cả nội dung vào là hai mươi skill ăn hết cửa sổ ngữ cảnh trước khi
 * người dùng kịp nói câu đầu tiên.
 *
 * Năm quy ước thư mục lấy nguyên từ bundle, và hai trong đó không phải của họ — `.claude/skills` và
 * `.codex/skills`. Nghĩa là định dạng skill của họ CHÍNH LÀ định dạng của Claude, nên kho skill sẵn
 * có của người dùng chạy được mà không phải chuyển đổi gì.
 */
import { boxCall, boxConfigured } from "./box-exec.js";
import { boxRoot, sq } from "./desktop.js";

export interface SkillRow {
  /** Đường dẫn tuyệt đối tới SKILL.md — thứ bot dùng để đọc. */
  path: string;
  name: string;
  description: string;
  scope: "project" | "user";
  /** Thư mục đã tìm ra nó, để thông báo phần bị cắt còn nói được chỗ tìm. */
  dir: string;
}

/** Đúng bảng của bản gốc (`Mmt`), kể cả cờ builtin/thirdParty tuy ở đây chưa dùng tới. */
export const SKILL_DIRS: { configDir: string; subdir: string }[] = [
  { configDir: ".claude", subdir: "skills" },
  { configDir: ".codex", subdir: "skills" },
  { configDir: ".agents", subdir: "skills" },
  { configDir: ".cursor", subdir: "skills" },
  { configDir: ".cursor", subdir: "skills-cursor" },
];

/** Ngân sách cho lát skill. Bản gốc cũng cắt và nói ra phần bị cắt — xem `renderSkills`. */
const BUDGET_TOKENS = Number(process.env.GROKBOT2_SKILLS_BUDGET_TOKENS ?? 1200);
/** Quét lại sau chừng này. Skill nằm trên đĩa và hiếm khi đổi giữa hai câu chat. */
const TTL_MS = Number(process.env.GROKBOT2_SKILLS_TTL_MS ?? 120_000);
/** Ước lượng thô: 4 ký tự một token. Đủ để không vượt ngân sách, không cần chính xác. */
const tokensOf = (s: string): number => Math.ceil(s.length / 4);

/**
 * Đọc `name`/`description` từ frontmatter YAML ở đầu SKILL.md.
 *
 * Chỉ đọc hai trường và chỉ trong khối `---` đầu tiên — không phải trình phân tích YAML, và cố ý
 * không phải: một skill có frontmatter lạ thì mất mô tả chứ không được phép làm hỏng cả lát prompt.
 */
export function parseFrontmatter(text: string): { name?: string; description?: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text.trimStart());
  if (!m) return {};
  const out: { name?: string; description?: string } = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^(name|description)\s*:\s*(.*)$/i.exec(line.trim());
    if (!kv) continue;
    const key = kv[1].toLowerCase() as "name" | "description";
    if (out[key] !== undefined) continue;
    out[key] = kv[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

/** Tên suy ra từ thư mục khi frontmatter không nói — `…/skills/pdf-forms/SKILL.md` → `pdf-forms`. */
export const nameFromPath = (p: string): string => {
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 2] ?? parts[parts.length - 1] ?? "skill";
};

interface ExecResult { stdout?: string; stderr?: string }

/**
 * Quét đĩa box, một vòng mạng.
 *
 * `find` giới hạn độ sâu 3: skill là `<gốc>/<tên>/SKILL.md`, và một `find` không giới hạn trên thư
 * mục nhà là chờ vài giây mỗi lượt chat. Mỗi file chỉ đọc **30 dòng đầu** — đủ frontmatter, và
 * không kéo cả tệp dài về chỉ để lấy một dòng mô tả.
 */
export async function scanSkills(): Promise<SkillRow[]> {
  if (!boxConfigured()) return [];
  const root = await boxRoot();
  const roots: { base: string; scope: "project" | "user" }[] = [
    { base: root, scope: "project" },
    { base: "$HOME", scope: "user" },
  ];
  const dirs: string[] = [];
  for (const r of roots) for (const d of SKILL_DIRS) dirs.push(`${r.base}/${d.configDir}/${d.subdir}`);

  // Ngăn cách bằng chuỗi khó trùng, vì mô tả có thể chứa mọi dấu câu thường gặp.
  const cmd = `for d in ${dirs.map((d) => (d.startsWith("$HOME") ? `"${d}"` : sq(d))).join(" ")}; do `
    + `[ -d "$d" ] || continue; `
    + `find "$d" -maxdepth 3 -name SKILL.md 2>/dev/null | while read -r f; do `
    + `echo "<<<SKILL>>>$f"; head -30 "$f"; done; done`;
  let out = "";
  try {
    const r = await boxCall<ExecResult>("exec", { command: cmd });
    out = String(r.stdout ?? "");
  } catch { return []; }

  const rows: SkillRow[] = [];
  for (const chunk of out.split("<<<SKILL>>>")) {
    if (!chunk.trim()) continue;
    const nl = chunk.indexOf("\n");
    const path = (nl < 0 ? chunk : chunk.slice(0, nl)).trim();
    if (!path.endsWith("SKILL.md")) continue;
    const fm = parseFrontmatter(nl < 0 ? "" : chunk.slice(nl + 1));
    const dir = path.replace(/\/[^/]+\/SKILL\.md$/, "");
    rows.push({
      path,
      name: fm.name?.trim() || nameFromPath(path),
      description: fm.description?.trim() || "",
      scope: path.startsWith(root) ? "project" : "user",
      dir,
    });
  }
  // Cùng một skill ở cả hai phạm vi thì giữ bản project: gần việc hơn thì thắng.
  const byName = new Map<string, SkillRow>();
  for (const r of rows) {
    const prev = byName.get(r.name);
    if (!prev || (prev.scope === "user" && r.scope === "project")) byName.set(r.name, r);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Lát `<available_skills>` cho prompt.
 *
 * Hình dạng chép từ bản gốc: mỗi skill là một dòng mang `fullPath` và mô tả, không hơn. Câu dặn
 * cũng vậy, gồm cả câu gắt nhất của họ — *"NEVER just announce or mention a skill without actually
 * reading and following it"* — vì đó là lỗi mà model hay mắc nhất: kể tên skill rồi tự làm theo ý
 * mình.
 *
 * Vượt ngân sách thì cắt và NÓI RA phần bị cắt kèm thư mục, đúng như họ: một danh sách bị cắt âm
 * thầm khiến model tin rằng nó đã thấy hết.
 */
export function renderSkills(rows: SkillRow[], readTool = "read_file_v2", budgetTokens = BUDGET_TOKENS): string {
  if (!rows.length) return "";
  const head = [
    "",
    "## Skills",
    "",
    "Skills là quy trình (SOP) viết sẵn cho từng loại việc. Khi người dùng giao việc, xem trong danh"
    + " sách dưới đây có skill nào giúp làm việc đó tốt hơn không.",
    `Muốn dùng: đọc file tại đường dẫn tuyệt đối bằng công cụ \`${readTool}\`, rồi làm theo hướng dẫn bên trong.`,
    "Thấy một skill liên quan thì ĐỌC VÀ LÀM THEO NGAY, coi đó là hành động đầu tiên. TUYỆT ĐỐI không"
    + " nhắc tên một skill rồi tự làm theo ý mình — nhắc mà không đọc là chưa dùng skill.",
    "Lời người dùng cao hơn lời skill. Skill đã dùng thì cao hơn phán đoán tự do khi hai bên không mâu thuẫn.",
    "Nói cho người dùng biết khi một skill khiến bạn làm điều gì đáng kể; đừng kể tên những skill bạn chỉ liếc qua.",
    "",
    "<available_skills>",
  ].join("\n");
  const tail = "\n</available_skills>";

  const lines: string[] = [];
  let used = tokensOf(head) + tokensOf(tail);
  let omitted = 0;
  const omittedDirs = new Set<string>();
  for (const r of rows) {
    const line = `  <agent_skill fullPath="${r.path}">${r.description || r.name}</agent_skill>`;
    const cost = tokensOf(line);
    if (used + cost > budgetTokens) { omitted += 1; omittedDirs.add(r.dir); continue; }
    lines.push(line);
    used += cost;
  }
  const note = omitted
    ? `\n  <!-- Còn ${omitted} skill nữa không liệt kê ở đây. Thư mục chứa chúng: ${[...omittedDirs].join(", ")} -->`
    : "";
  return `${head}\n${lines.join("\n")}${note}${tail}`;
}

let cache: { at: number; text: string } = { at: 0, text: "" };

/** Lát skill đã có sẵn, hoặc chuỗi rỗng. Không bao giờ ném: prompt không được hỏng vì một lần quét lỗi. */
export async function skillsSection(readTool = "read_file_v2"): Promise<string> {
  if (Date.now() - cache.at < TTL_MS) return cache.text;
  try {
    const text = renderSkills(await scanSkills(), readTool);
    cache = { at: Date.now(), text };
  } catch {
    cache = { at: Date.now(), text: "" };
  }
  return cache.text;
}

/** Lát đang có trong bộ nhớ đệm, không chạm mạng — dùng khi dựng prompt (đồng bộ). */
export const cachedSkillsSection = (): string => cache.text;

/** Hâm nóng bộ nhớ đệm ở nền. Prompt dựng đồng bộ, nên lượt đầu đi ra không có skill là chấp nhận được. */
export function warmSkills(): void {
  if (!boxConfigured()) return;
  void skillsSection().catch(() => { /* đã nuốt trong skillsSection */ });
}

/** Chỉ dùng trong test. */
export const resetSkillsCache = (): void => { cache = { at: 0, text: "" }; };
