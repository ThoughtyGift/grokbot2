import fs from "node:fs";
const idx = fs.readFileSync("C:/Users/admin/AppData/Local/Programs/Grok Bot/resources/app/dist/renderer/assets/index-DNC736IO.js", "utf8");
const out = "C:/Users/admin/Desktop/grokbot2/services/grokbot-backend/scripts";

const needles = [
  "getCatalog()",
  "getCatalog:",
  "catalogViews",
  "isn't available",
  "EuTQUZ",
  "marketplace isn't",
];
for (const n of needles) {
  let from = 0, c = 0;
  while (c < 3) {
    const i = idx.indexOf(n, from);
    if (i < 0) break;
    console.log(n, i);
    if (c === 0) fs.writeFileSync(`${out}/_tmp-idx-${n.replace(/[^a-zA-Z0-9]+/g, "_")}.txt`, idx.slice(Math.max(0, i - 300), i + 1500));
    from = i + n.length;
    c++;
  }
}

// find export al=  (might be too many). Search "useMarketplace" or similar.
for (const n of ["useMarketplaceCatalog", "marketplaceCatalog", "loadCatalog", "fetchCatalog"]) {
  console.log(n, idx.indexOf(n));
}
