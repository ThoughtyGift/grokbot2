/**
 * Hợp đồng của renderer markdown — chạy: npx tsx --test apps/grokbot-web/src/markdown.test.ts
 *
 * Điều quan trọng nhất không phải "render đẹp" mà là: KHÔNG có đường nào cho HTML sống đi qua.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mdToHtml } from "./markdown.js";

test("đoạn văn + xuống dòng", () => {
  assert.equal(mdToHtml("một\nhai"), "<p>một<br>hai</p>");
  assert.equal(mdToHtml("một\n\nhai"), "<p>một</p><p>hai</p>");
});

test("đậm, nghiêng, code inline", () => {
  assert.equal(mdToHtml("có **đậm** và *nghiêng* và `mã`"),
    "<p>có <strong>đậm</strong> và <em>nghiêng</em> và <code>mã</code></p>");
});

test("ký hiệu markdown BÊN TRONG code inline không được parse", () => {
  assert.equal(mdToHtml("`**không đậm**`"), "<p><code>**không đậm**</code></p>");
});

test("danh sách -, danh sách 1.", () => {
  assert.equal(mdToHtml("- a\n- b"), "<ul><li>a</li><li>b</li></ul>");
  assert.equal(mdToHtml("1. a\n2. b"), "<ol><li>a</li><li>b</li></ol>");
});

test("code block ``` giữ nguyên nội dung, kể cả ký hiệu markdown và HTML", () => {
  assert.equal(mdToHtml("```\n<b>**x**</b>\n```"),
    "<pre><code>&lt;b&gt;**x**&lt;/b&gt;</code></pre>");
});

test("code block không đóng vẫn render, không nuốt", () => {
  assert.equal(mdToHtml("```\nx"), "<pre><code>x</code></pre>");
});

test("tiêu đề thành dòng đậm, trích dẫn thành blockquote", () => {
  assert.equal(mdToHtml("## Tựa"), `<p class="md-h">Tựa</p>`);
  assert.equal(mdToHtml("> a\n> b"), "<blockquote>a<br>b</blockquote>");
});

test("link chỉ nhận http/https — javascript: không có đường vào", () => {
  assert.equal(mdToHtml("[x](https://a.vn)"),
    `<p><a href="https://a.vn" target="_blank" rel="noreferrer">x</a></p>`);
  // không khớp luật link thì ở lại dạng chữ đã escape
  assert.equal(mdToHtml("[x](javascript:alert(1))"), "<p>[x](javascript:alert(1))</p>");
});

test("HTML sống trong đầu vào bị escape ở MỌI nhánh", () => {
  for (const evil of [
    `<img src=x onerror=alert(1)>`,
    `- <script>1</script>`,
    `1. <b>x</b>`,
    `# <i>x</i>`,
    `> <u>x</u>`,
    `**<s>x</s>**`,
  ]) {
    const html = mdToHtml(evil);
    assert.ok(!/<(img|script|b|i|u|s)\b/.test(html), `HTML sống lọt qua: ${html}`);
  }
});

test("giá tiền hai dấu sao không thành nghiêng vô cớ", () => {
  // "5*3" rồi "4*2" — dấu * dính số/chữ hai đầu không phải nghiêng
  assert.equal(mdToHtml("5*3 và 4*2"), "<p>5*3 và 4*2</p>");
});
