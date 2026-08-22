import fs from "node:fs";

const view = fs.readFileSync("C:/Users/admin/AppData/Local/Programs/Grok Bot/resources/app/dist/renderer/assets/view--8LkllMO.js", "utf8");
const host = fs.readFileSync("C:/Users/admin/AppData/Local/Programs/Grok Bot/resources/app/dist/host/host-main.cjs", "utf8");
const out = "C:/Users/admin/Desktop/grokbot2/services/grokbot-backend/scripts";

function dump(src, label, needle, before, after) {
  const i = src.indexOf(needle);
  console.log(label, needle.slice(0, 40), i);
  if (i < 0) return;
  fs.writeFileSync(`${out}/_tmp-${label}.txt`, src.slice(Math.max(0, i - before), i + after));
}

dump(view, "view-Da", "function Da(", 20, 2500);
dump(view, "view-La", "function La(", 20, 2500);
dump(view, "view-$a", "function $a(", 20, 1500);
dump(view, "view-bt", "function bt(", 20, 2500);
dump(view, "view-hKn", "hKn", 80, 800);
dump(view, "view-yPa", "function yPa(", 20, 2000);

dump(host, "host-fetchMp", "fetchMarketplaceMcpPlugins", 80, 2500);
dump(host, "host-listBox", "listBoxServers", 80, 2000);
dump(host, "host-BWn", "async getCatalog", 40, 2000);
dump(host, "host-sbt", "sbt||(sbt={})", 20, 600);
dump(host, "host-abt", "abt||(abt={})", 20, 600);
dump(host, "host-Q0e", 'typeName="aiserver.v1.EffectiveUserPlugin"', 20, 1200);
dump(host, "host-Fy", 'typeName="aiserver.v1.Marketplace"', 20, 1200);
