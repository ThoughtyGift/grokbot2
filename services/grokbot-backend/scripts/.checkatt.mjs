import { chromium } from "playwright-core";
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const p = b.contexts().flatMap((c) => c.pages()).find((x) => /index.html/.test(x.url()));
await p.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
await p.waitForTimeout(9000);
await p.locator("text=Alpha").first().click({ timeout: 6000 }).catch(() => {});
await p.waitForTimeout(8000);
const info = await p.evaluate(() => {
  const t = document.body.innerText;
  return {
    imgs: [...document.querySelectorAll("img")]
      .map((i) => ({ src: (i.currentSrc || i.src || "").slice(0, 34), w: i.naturalWidth, h: i.naturalHeight }))
      .filter((i) => i.w > 0),
    failed: t.includes("Image unavailable") || t.includes("read file"),
  };
});
console.log("images:", JSON.stringify(info.imgs));
console.log("failure text present:", info.failed);
await p.screenshot({ path: ".data/attach-G.png" });
await b.close();
