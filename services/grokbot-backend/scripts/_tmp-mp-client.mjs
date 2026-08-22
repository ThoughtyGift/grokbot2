import fs from "node:fs";
const host = fs.readFileSync("C:/Users/admin/AppData/Local/Programs/Grok Bot/resources/app/dist/host/host-main.cjs", "utf8");
const out = "C:/Users/admin/Desktop/grokbot2/services/grokbot-backend/scripts";

function dump(label, needle, before, after) {
  const i = host.indexOf(needle);
  console.log(label, i);
  if (i >= 0) fs.writeFileSync(`${out}/_tmp-${label}.txt`, host.slice(Math.max(0, i - before), i + after));
}

dump("cAtFn", "function cAt(", 40, 2500);
dump("cAtEq", "cAt=(", 40, 1500);
dump("createMpClient", "listMarketplacePlugins:", 80, 2000);
dump("bestTok", "function lAt(", 40, 1500);
dump("WbTimeout", "Wb=3e4", 20, 200);

for (const n of [
  "api2.cursor.sh",
  "marketplace.cursor",
  "cursor.com/api",
  "ListMarketplacePlugins",
  "PluginService",
  "MarketplaceService",
]) {
  console.log(n, host.indexOf(n));
}
