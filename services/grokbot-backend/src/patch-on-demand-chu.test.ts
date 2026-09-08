/**
 * Thẻ On-Demand phải nói tiếng của mình, và bản vá ấy phải sinh ra JS hợp lệ.
 *
 *   node services/grokbot-backend/scripts/run-tests.mjs "services/grokbot-backend/src/patch-on-demand-chu.test.ts"
 *
 * ── Bài này ghim gì, và vì sao ─────────────────────────────────────────────────────────────────
 *
 * Bản vá này khác mọi bản vá khác trong `infra/patches` ở một chỗ: nó thay một BIỂU THỨC bằng một
 * chuỗi literal. Viết thiếu cặp nháy là `chunk-usage-pane-….js` hỏng cú pháp, và hỏng cú pháp ở
 * renderer nghĩa là **client không mở lên được** trên mọi máy nhận bản phát hành. `--verify` có
 * chạy `node --check` nên nó bắt được — nhưng chỉ SAU khi đã vá vào một bundle thật, tức sau bước
 * tốn nhất của đường phát hành. Bài này bắt trước, ở chỗ rẻ.
 *
 * Điều thứ hai đáng ghim là CÂU CHỮ: cả lý do tồn tại của bản vá là "đừng gửi người dùng của mình
 * sang dashboard của Cursor". Một lần sửa ẩu để lọt chữ "Cursor" trở lại thì bộ vá vẫn xanh trọn,
 * `node --check` vẫn qua, và thứ sai chỉ hiện ra trên màn hình người dùng sau khi đã phát hành.
 *
 * Bài này KHÔNG đọc bản cài nào: `C:\cai029`/`C:\cai043` không nằm trong repo, và một bài đo chỉ
 * xanh trên máy có sẵn bundle là bài đo không chạy được ở chỗ khác. Việc đo bundle thật là của
 * `patch-client --verify` (và của phép chạy thử trên BẢN SAO đã làm trước khi commit).
 */
import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error — bộ vá là JS thuần, cố ý không có tầng type: nó chạy bằng `node` trần trên máy
// người dùng, nơi không có tsx lẫn bước dựng.
import { PATCHES } from "../../../infra/patches/index.mjs";
// @ts-expect-error — như trên.
import { thanHienHanh } from "../../../infra/patches/than-hien-hanh.mjs";

type BienThe = { version: string; file: string; find: string; expected: number; replace: string; marker: string };
type BanVa = { id: string; summary: string; obsoleteWhenMissing?: string; variants: BienThe[] };

const IDS = ["on-demand-mo-ta-bat", "on-demand-mo-ta-tat", "on-demand-nut"] as const;

const banVa = (id: string): BanVa => {
  const p = (PATCHES as BanVa[]).find((x) => x.id === id);
  assert.ok(p, `khong con ban va ten "${id}" trong PATCHES — doi ten hay quen spread vao index.mjs?`);
  return p!;
};

/** Phần sau marker, tức đúng chuỗi mã sẽ nằm trong bundle thay cho lời gọi hàm dịch. */
const chuTrongReplace = (v: BienThe) => {
  assert.ok(v.replace.startsWith(v.marker), `replace cua ${v.version} phai bat dau bang marker`);
  return v.replace.slice(v.marker.length);
};

test("ba bản vá còn đăng ký trong PATCHES", () => {
  // Bộ vá chạy từ `PATCHES`, không từ file module — quên dòng spread trong `index.mjs` là bản vá
  // tồn tại mà không bao giờ được áp, và không cửa nào kêu.
  for (const id of IDS) banVa(id);
});

test("mỗi neo là một chuỗi LITERAL hợp lệ — chỗ này viết trần là client không mở lên được", () => {
  for (const id of IDS) {
    for (const v of banVa(id).variants) {
      const chu = chuTrongReplace(v);
      let doc: unknown;
      assert.doesNotThrow(() => { doc = JSON.parse(chu); },
        `${id}/${v.version}: phan sau marker phai la chuoi JSON co nhay — "${chu}"`);
      assert.equal(typeof doc, "string", `${id}/${v.version}: phai la chuoi, khong phai ${typeof doc}`);
      assert.ok((doc as string).trim().length > 0, `${id}/${v.version}: chuoi rong thi the ve trong`);
    }
  }
});

test("câu chữ là của cinai, không phải của hãng — lý do tồn tại của cả bản vá", () => {
  for (const id of IDS) {
    for (const v of banVa(id).variants) {
      const chu = JSON.parse(chuTrongReplace(v)) as string;
      assert.doesNotMatch(chu, /cursor/i, `${id}/${v.version}: cau chu con nhac Cursor — "${chu}"`);
      assert.match(chu, /cinai/i, `${id}/${v.version}: cau chu phai neu cinai — "${chu}"`);
    }
  }
});

test("hai biến thể: 0.29 và 0.43, mỗi bên một tệp, mỗi neo đúng MỘT chỗ", () => {
  for (const id of IDS) {
    const p = banVa(id);
    const ver = p.variants.map((v) => v.version).sort();
    assert.deepEqual(ver, ["0.29.0", "0.43.0"],
      `${id}: hai ban client deu co pane nay (do 09/09) — mot bien the la bo quen mot ban`);

    const tep = new Set(p.variants.map((v) => v.file));
    assert.equal(tep.size, 2, `${id}: hai bien the phai tro HAI tep khac nhau (chep-dan nham?)`);

    for (const v of p.variants) {
      assert.equal(v.expected, 1,
        `${id}/${v.version}: neo phai doc nhat — expected khac 1 la dang va mo sang cho khac`);
      assert.notEqual(v.find, v.replace, `${id}/${v.version}: find trung replace la ban va rong`);
      assert.ok(v.file.startsWith("dist/renderer/assets/"), `${id}/${v.version}: tep phai o renderer`);
    }
  }
});

test("mỗi neo bám đúng khoá i18n của nó", () => {
  // Khoá i18n là hằng của MÃ NGUỒN hãng (bền qua các lần dựng lại), còn tên rút gọn quanh nó thì
  // không — nên khoá là thứ duy nhất đáng ghim ở đây.
  const khoa: Record<string, string> = {
    "on-demand-mo-ta-bat": "AHtE5A",
    "on-demand-mo-ta-tat": "zXR11a",
    "on-demand-nut": "wTN8Sv",
  };
  for (const id of IDS) {
    for (const v of banVa(id).variants) {
      assert.ok(v.find.includes(`{id:"${khoa[id]}"}`),
        `${id}/${v.version}: neo phai bam khoa ${khoa[id]} — dang bam "${v.find}"`);
    }
  }
});

test("ba marker khác nhau — chung marker thì --verify đếm sai số lần vá", () => {
  // `--verify` cộng theo TẬP marker của MỘT bản vá; hai bản vá dùng chung một chuỗi marker thì mỗi
  // bên đếm được cả dấu của bên kia và con số "3x" nói sai.
  const ms = IDS.flatMap((id) => banVa(id).variants.map((v) => v.marker));
  assert.equal(new Set(ms).size, IDS.length, `marker bi trung: ${ms.join(" ")}`);
  for (const id of IDS) {
    for (const v of banVa(id).variants) {
      assert.equal(v.marker, `/*grokbot2:${id}*/`, `${id}/${v.version}: marker phai mang chinh id`);
    }
  }
});

test("thanHienHanh: bundle mang thân MỚI thì nhận, mang chữ của hãng thì không", () => {
  // Cùng cửa mà `--verify` đi qua (bẫy 08/09: marker còn mà thân là bản cũ thì nó vẫn báo xanh).
  for (const id of IDS) {
    const p = banVa(id);
    for (const v of p.variants) {
      assert.equal(thanHienHanh(p, `dau ${v.replace} duoi`), true, `${id}/${v.version}: than moi phai nhan`);
    }
    // Thân "cũ" đáng sợ nhất ở đây là bản vá của một lượt trước còn để nguyên chữ của hãng.
    const thanCu = `${p.variants[0].marker}"Open Cursor Dashboard"`;
    assert.equal(thanHienHanh(p, `dau ${thanCu} duoi`), false,
      `${id}: marker co ma chu la cua hang — neu ca nay xanh thi --verify lai mu nhu 08/09`);
  }
});

test("obsoleteWhenMissing tự mang lời cảnh báo — vì dòng nó in ra là dòng XANH", () => {
  // Tên tệp renderer mang băm nội dung. Hãng dựng lại ⇒ tệp vắng ⇒ `--verify` bỏ qua rồi in
  // `obsoleteWhenMissing` như một dòng ĐẠT. Không có cách nào bắt nó đỏ từ phía bản vá, nên thứ duy
  // nhất còn lại là để chính câu ấy nói ra việc phải làm.
  for (const id of IDS) {
    const why = banVa(id).obsoleteWhenMissing ?? "";
    assert.match(why, /0\.20/, `${id}: phai noi ro ban NAO moi duoc phep vang pane`);
    assert.match(why, /0\.29|0\.43/, `${id}: phai canh bao ban nao thay dong nay la co chuyen`);
    assert.match(why, /băm|bam/, `${id}: phai chi ra nguyen nhan that — ten tep theo bam noi dung`);
  }
});
