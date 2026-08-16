import { chromium } from "playwright-core";
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const p = b.contexts().flatMap((c) => c.pages()).find((x) => /index.html/.test(x.url()));
await p.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
await p.waitForTimeout(9000);
await p.locator("text=Alpha").first().click({ timeout: 6000 }).catch(() => {});
await p.waitForTimeout(2500);

const box = p.locator("[contenteditable=true], textarea").last();
await box.click();
await box.type('TOOL_CALL: browser_navigate({"url":"https://example.com"})');
await p.keyboard.press("Enter");
console.log("prompt sent");
await p.waitForTimeout(14000);

// Approve whatever permission card appeared.
for (const label of ["Allow once", "Allow", "Approve", "Cho phép"]) {
  const btn = p.locator(`text=${label}`).first();
  if (await btn.count() > 0) { await btn.click().catch(() => {}); console.log("clicked", label); break; }
}
await p.waitForTimeout(16000);

const info = await p.evaluate(() => ({
  imgs: [...document.querySelectorAll("img")]
    .map((i) => ({ src: (i.currentSrc || i.src || "").slice(0, 40), w: i.naturalWidth, h: i.naturalHeight }))
    .filter((i) => i.w > 0),
  failed: document.body.innerText.includes("Image unavailable") || document.body.innerText.includes("read file"),
  tail: document.body.innerText.replace(/\s+/g, " ").slice(-320),
}));
console.log("images:", JSON.stringify(info.imgs));
console.log("failure text:", info.failed);
console.log("tail:", info.tail);
await p.screenshot({ path: ".data/attach-live.png" });
await b.close();
