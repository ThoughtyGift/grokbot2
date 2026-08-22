import fs from "node:fs";

const host = fs.readFileSync("C:/Users/admin/AppData/Local/Programs/Grok Bot/resources/app/dist/host/host-main.cjs", "utf8");
const view = fs.readFileSync("C:/Users/admin/AppData/Local/Programs/Grok Bot/resources/app/dist/renderer/assets/view--8LkllMO.js", "utf8");
const out = "C:/Users/admin/Desktop/grokbot2/services/grokbot-backend/scripts";

function dump(src, label, needle, before, after) {
  const i = src.indexOf(needle);
  console.log(label, i);
  if (i < 0) return;
  fs.writeFileSync(`${out}/_tmp-${label}.txt`, src.slice(Math.max(0, i - before), i + after));
}

dump(host, "host-effMap", "GetEffectiveUserPlugins", 80, 2000);
dump(host, "host-installPlugin", "installPlugin:", 40, 1200);
dump(host, "host-InstallUser", 'typeName="aiserver.v1.InstallUserPlugin', 20, 600);
dump(host, "host-AddUserPlugin", "AddUserPlugin", 20, 400);
dump(view, "view-Qs2", "function Qs", 20, 300);
dump(view, "view-nn", "function nn(", 20, 400);
dump(view, "view-isEnabled", "isEnabled===", 40, 200);

for (const n of [
  "getEffectiveUserPlugins",
  "effectivePlugins",
  "InstallPlugin",
  "installUserPlugin",
  "AddPluginInstall",
]) {
  console.log("host", n, host.indexOf(n));
}

dump(host, "host-Xt", 'typeName="aiserver.v1.PluginVariables"', 20, 400);
dump(host, "host-Ek", "Ek||(Ek={})", 20, 400);
