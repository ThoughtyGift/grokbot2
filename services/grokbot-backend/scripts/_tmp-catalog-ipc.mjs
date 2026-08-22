import fs from "node:fs";
const host = fs.readFileSync("C:/Users/admin/AppData/Local/Programs/Grok Bot/resources/app/dist/host/host-main.cjs", "utf8");
const idx = fs.readFileSync("C:/Users/admin/AppData/Local/Programs/Grok Bot/resources/app/dist/renderer/assets/index-DNC736IO.js", "utf8");
const out = "C:/Users/admin/Desktop/grokbot2/services/grokbot-backend/scripts";

function dump(src, label, needle, before, after) {
  const i = src.indexOf(needle);
  console.log(label, needle, i);
  if (i >= 0) fs.writeFileSync(`${out}/_tmp-${label}.txt`, src.slice(Math.max(0, i - before), i + after));
}

dump(host, "ipcGetCatalog", "getCatalog:", 80, 600);
dump(host, "ipcCatalog2", 'name:"getCatalog"', 40, 400);
dump(idx, "invGetCatalog", "getCatalog", 80, 500);
dump(idx, "hostMcpGetCatalog", "mcp.getCatalog", 40, 400);
dump(idx, "pluginsGetCatalog", "plugins.getCatalog", 40, 400);

// count getCatalog in index
let from = 0, n = 0;
while (n < 15) {
  const i = idx.indexOf("getCatalog", from);
  if (i < 0) break;
  console.log("idx getCatalog", n, i, idx.slice(i - 40, i + 50).replace(/\n/g, " "));
  from = i + 10;
  n++;
}
