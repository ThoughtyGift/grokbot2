import fs from "node:fs";
const host = fs.readFileSync("C:/Users/admin/AppData/Local/Programs/Grok Bot/resources/app/dist/host/host-main.cjs", "utf8");
const out = "C:/Users/admin/Desktop/grokbot2/services/grokbot-backend/scripts";

function dump(label, needle, before, after) {
  const i = host.indexOf(needle);
  console.log(label, i);
  if (i >= 0) fs.writeFileSync(`${out}/_tmp-${label}.txt`, host.slice(Math.max(0, i - before), i + after));
}

dump("Chn", "function Chn(", 20, 1500);
dump("NWt", "function NWt(", 20, 1500);
dump("Phn", "function Phn(", 20, 1500);
dump("unaryHttp", "unary:async", 40, 2000);
