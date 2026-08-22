import fs from "node:fs";
const host = fs.readFileSync("C:/Users/admin/AppData/Local/Programs/Grok Bot/resources/app/dist/host/host-main.cjs", "utf8");
const out = "C:/Users/admin/Desktop/grokbot2/services/grokbot-backend/scripts";

function dump(label, needle, before, after) {
  const i = host.indexOf(needle);
  console.log(label, i);
  if (i >= 0) fs.writeFileSync(`${out}/_tmp-${label}.txt`, host.slice(Math.max(0, i - before), i + after));
}

dump("WQ", "function WQ(", 20, 2000);
dump("DoBase", "function Do(", 20, 800);
dump("NkClient", "function Nk(", 20, 1200);
dump("ZoType", "Zo.typeName", 20, 400);
dump("useBinaryFormat", "useBinaryFormat", 40, 400);
dump("applicationJson", "application/json", 40, 200);
dump("connectPlus", "application/connect+", 40, 300);
