import fs from "node:fs";
const host = fs.readFileSync("C:/Users/admin/AppData/Local/Programs/Grok Bot/resources/app/dist/host/host-main.cjs", "utf8");
const i = host.indexOf("function GZi(");
console.log("GZi", i);
const out = "C:/Users/admin/Desktop/grokbot2/services/grokbot-backend/scripts/_tmp-GZi.txt";
if (i >= 0) fs.writeFileSync(out, host.slice(i, i + 1200));
const j = host.indexOf("function bhn(");
console.log("bhn", j);
if (j >= 0) fs.writeFileSync("C:/Users/admin/Desktop/grokbot2/services/grokbot-backend/scripts/_tmp-bhn.txt", host.slice(j, j + 800));
