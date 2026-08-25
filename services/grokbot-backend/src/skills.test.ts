/**
 * Skill — xem skills.ts.
 *
 * Phần quét đĩa phải chạy trên box thật nên kiểm bằng tay (đã chạy: bot đọc đúng file rồi cộng VAT
 * 8% và hỏi xác nhận — hai điều chỉ có trong SKILL.md). Chỗ ghim ở đây là **đọc frontmatter và dựng
 * lát prompt**, vì mọi sai sót của chúng đều im lặng: một mô tả hỏng làm skill không bao giờ được
 * chọn, và một danh sách bị cắt âm thầm khiến model tin rằng nó đã thấy hết.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFrontmatter, nameFromPath, renderSkills, SKILL_DIRS, type SkillRow } from "./skills.js";

const row = (o: Partial<SkillRow>): SkillRow =>
  ({ path: "/x/skills/a/SKILL.md", name: "a", description: "mô tả", scope: "project", dir: "/x/skills", ...o });

test("đọc name và description từ frontmatter kiểu Claude", () => {
  const fm = parseFrontmatter(`---\nname: hoa-don\ndescription: Dùng khi cần lập hoá đơn.\n---\n\n# Nội dung\n`);
  assert.equal(fm.name, "hoa-don");
  assert.equal(fm.description, "Dùng khi cần lập hoá đơn.");
});

test("frontmatter có nháy hoặc trường lạ vẫn đọc được", () => {
  const fm = parseFrontmatter(`---\nname: "pdf-forms"\nlicense: MIT\ndescription: 'Điền form PDF.'\n---\n`);
  assert.equal(fm.name, "pdf-forms");
  assert.equal(fm.description, "Điền form PDF.");
});

/** Một skill viết sai không được phép làm hỏng cả lát prompt của những skill khác. */
test("không có frontmatter thì trả rỗng, không ném", () => {
  assert.deepEqual(parseFrontmatter("# Chỉ có tiêu đề\n\nnội dung"), {});
  assert.deepEqual(parseFrontmatter(""), {});
});

test("thiếu tên thì suy ra từ thư mục chứa nó", () => {
  assert.equal(nameFromPath("/home/box/.claude/skills/pdf-forms/SKILL.md"), "pdf-forms");
  assert.equal(nameFromPath("/a/b/env-setup/SKILL.md"), "env-setup");
});

test("lát prompt mang đường dẫn và mô tả, KHÔNG mang nội dung skill", () => {
  const out = renderSkills([row({ path: "/p/hoa-don/SKILL.md", name: "hoa-don", description: "Lập hoá đơn." })]);
  assert.match(out, /<available_skills>/);
  assert.match(out, /<agent_skill fullPath="\/p\/hoa-don\/SKILL\.md">Lập hoá đơn\.<\/agent_skill>/);
  assert.match(out, /read_file_v2/, "phải nói bằng công cụ nào để đọc");
  assert.match(out, /ĐỌC VÀ LÀM THEO NGAY/, "câu chống việc chỉ nhắc tên skill rồi tự làm");
});

test("không có skill nào thì không thêm gì vào prompt", () => {
  assert.equal(renderSkills([]), "");
});

/** Cắt âm thầm là nói dối: model đếm danh sách để biết nó có gì. */
test("vượt ngân sách thì cắt và NÓI RA phần bị cắt kèm thư mục", () => {
  const rows = [
    row({ path: "/p/a/SKILL.md", name: "a", description: "x".repeat(400), dir: "/p" }),
    row({ path: "/q/b/SKILL.md", name: "b", description: "y".repeat(400), dir: "/q" }),
  ];
  const out = renderSkills(rows, "read_file_v2", 120);
  assert.match(out, /Còn \d+ skill nữa không liệt kê/);
  assert.ok(/\/p|\/q/.test(out), "phải nêu thư mục để còn tìm được");
});

test("mô tả trống thì dùng tên, không để dòng rỗng", () => {
  const out = renderSkills([row({ name: "env-setup", description: "" })]);
  assert.match(out, />env-setup</);
});

/** Hai trong năm thư mục không phải của hãng — đó là lý do kho skill Claude sẵn có chạy được ngay. */
test("giữ đúng năm quy ước thư mục của bản gốc", () => {
  const pairs = SKILL_DIRS.map((d) => `${d.configDir}/${d.subdir}`);
  assert.deepEqual(pairs, [
    ".claude/skills", ".codex/skills", ".agents/skills", ".cursor/skills", ".cursor/skills-cursor",
  ]);
});
