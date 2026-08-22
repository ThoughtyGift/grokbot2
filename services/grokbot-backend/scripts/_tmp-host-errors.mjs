import fs from "node:fs";
const host = fs.readFileSync("C:/Users/admin/AppData/Local/Programs/Grok Bot/resources/app/dist/host/host-main.cjs", "utf8");
const out = "C:/Users/admin/Desktop/grokbot2/services/grokbot-backend/scripts";
for (const n of ["parse binary", "marketplace", "getCatalog", "catalogFlow"]) {
  let from = 0, c = 0;
  while (c < 4) {
    const i = host.indexOf(n, from);
    if (i < 0) break;
    const sl = host.slice(Math.max(0, i - 80), i + 120).replace(/\n/g, " ");
    if (n === "marketplace" && !/fail|error|catch|log|catalog/i.test(sl)) { from = i + n.length; c++; continue; }
    console.log(n, i, sl.slice(0, 180));
    from = i + n.length;
    c++;
  }
}
