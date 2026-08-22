import fs from "node:fs";
const host = fs.readFileSync("C:/Users/admin/AppData/Local/Programs/Grok Bot/resources/app/dist/host/host-main.cjs", "utf8");
const idx = fs.readFileSync("C:/Users/admin/AppData/Local/Programs/Grok Bot/resources/app/dist/renderer/assets/index-DNC736IO.js", "utf8");
const out = "C:/Users/admin/Desktop/grokbot2/services/grokbot-backend/scripts";

let from = 0, n = 0;
while (n < 12) {
  const i = host.indexOf("getCatalog", from);
  if (i < 0) break;
  console.log("host", n, i, host.slice(i - 50, i + 60).replace(/\n/g, " "));
  from = i + 10;
  n++;
}

from = 0; n = 0;
while (n < 8) {
  const i = idx.indexOf("Catalog", from);
  if (i < 0) break;
  const sl = idx.slice(Math.max(0, i - 30), i + 40);
  if (/catalog/i.test(sl) && (sl.includes("mcp") || sl.includes("plugin") || sl.includes("market") || sl.includes("getC"))) {
    console.log("idx", i, sl.replace(/\n/g, " "));
  }
  from = i + 7;
  n++;
}

const i = idx.indexOf("effectivePlugins");
fs.writeFileSync(`${out}/_tmp-idx-eff.txt`, idx.slice(i - 400, i + 1500));
console.log("wrote eff");
