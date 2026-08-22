import fs from "node:fs";
const host = fs.readFileSync("C:/Users/admin/AppData/Local/Programs/Grok Bot/resources/app/dist/host/host-main.cjs", "utf8");
const out = "C:/Users/admin/Desktop/grokbot2/services/grokbot-backend/scripts";

function dump(label, needle, before, after) {
  const i = host.indexOf(needle);
  console.log(label, i);
  if (i >= 0) fs.writeFileSync(`${out}/_tmp-${label}.txt`, host.slice(Math.max(0, i - before), i + after));
}

dump("neo", "function neo(", 20, 800);
dump("J5t", "function J5t(", 20, 600);
dump("Ler", "function Ler(", 20, 800);
dump("j2eCT", "j2e=", 20, 200);
dump("Ttr", "Ttr=", 20, 150);
dump("itr", "itr=", 20, 80);
