import fs from "node:fs";
const host = fs.readFileSync("C:/Users/admin/AppData/Local/Programs/Grok Bot/resources/app/dist/host/host-main.cjs", "utf8");
const out = "C:/Users/admin/Desktop/grokbot2/services/grokbot-backend/scripts";
for (const n of [
  "marketplace-catalog",
  "marketplace catalog",
  "fetchMarketplace",
  "listMarketplacePlugins",
  "catalog failed",
  "Couldn't load",
]) {
  const i = host.indexOf(n);
  console.log(n, i);
  if (i >= 0) fs.writeFileSync(`${out}/_tmp-err-${n.replace(/\W/g, "_")}.txt`, host.slice(Math.max(0, i - 150), i + 500));
}
