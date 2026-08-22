import fs from "node:fs";
const idx = fs.readFileSync("C:/Users/admin/AppData/Local/Programs/Grok Bot/resources/app/dist/renderer/assets/index-DNC736IO.js", "utf8");
const out = "C:/Users/admin/Desktop/grokbot2/services/grokbot-backend/scripts";
const needles = [
  "listBoxMcpServers",
  "listServers",
  "effectivePlugins",
  "GetEffectiveUserPlugins",
  "includePrivateMarketplaces",
  "forceRefresh",
  "marketplacePlugin",
];
for (const n of needles) {
  const i = idx.indexOf(n);
  console.log(n, i);
  if (i >= 0) fs.writeFileSync(`${out}/_tmp-idx2-${n}.txt`, idx.slice(Math.max(0, i - 250), i + 1200));
}
