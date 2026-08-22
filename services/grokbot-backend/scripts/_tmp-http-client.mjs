import fs from "node:fs";
const host = fs.readFileSync("C:/Users/admin/AppData/Local/Programs/Grok Bot/resources/app/dist/host/host-main.cjs", "utf8");
const out = "C:/Users/admin/Desktop/grokbot2/services/grokbot-backend/scripts";

function dump(label, needle, before, after) {
  const i = host.indexOf(needle);
  console.log(label, i);
  if (i >= 0) fs.writeFileSync(`${out}/_tmp-${label}.txt`, host.slice(Math.max(0, i - before), i + after));
}

dump("PWt", "function PWt(", 20, 2500);
dump("http1client", "httpVersion:\"1.1\"", 80, 1500);
dump("arrayBuffer", ".arrayBuffer(", 40, 200);
dump("textBody", ".text()", 40, 200);
