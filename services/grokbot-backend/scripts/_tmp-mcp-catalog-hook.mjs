import fs from "node:fs";
const idx = fs.readFileSync("C:/Users/admin/AppData/Local/Programs/Grok Bot/resources/app/dist/renderer/assets/index-DNC736IO.js", "utf8");
const out = "C:/Users/admin/Desktop/grokbot2/services/grokbot-backend/scripts";

const needles = [
  "mcp.catalog",
  "catalogSnapshots",
  "mcpCatalog",
  ".catalogSnapshots",
  "getCatalog",
  "listMarketplace",
];
for (const n of needles) {
  const i = idx.indexOf(n);
  console.log(n, i);
  if (i >= 0) fs.writeFileSync(`${out}/_tmp-mcp-${n.replace(/\W/g, "_")}.txt`, idx.slice(Math.max(0, i - 400), i + 1200));
}

// nearby catalog hook like vZn
const i = idx.indexOf("function vZn()");
console.log("vZn", i);
fs.writeFileSync(`${out}/_tmp-mcp-vZn.txt`, idx.slice(i - 800, i + 200));
