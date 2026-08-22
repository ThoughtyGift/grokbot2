import fs from "node:fs";

const host = fs.readFileSync("C:/Users/admin/AppData/Local/Programs/Grok Bot/resources/app/dist/host/host-main.cjs", "utf8");
const view = fs.readFileSync("C:/Users/admin/AppData/Local/Programs/Grok Bot/resources/app/dist/renderer/assets/view--8LkllMO.js", "utf8");
const index = fs.readFileSync("C:/Users/admin/AppData/Local/Programs/Grok Bot/resources/app/dist/renderer/assets/index-DNC736IO.js", "utf8");
const out = "C:/Users/admin/Desktop/grokbot2/services/grokbot-backend/scripts";

function dump(src, label, needle, before, after) {
  const i = src.indexOf(needle);
  console.log(label, i);
  if (i < 0) return;
  fs.writeFileSync(`${out}/_tmp-${label}.txt`, src.slice(Math.max(0, i - before), i + after));
}

dump(host, "host-Q0e2", "Q0e.typeName=", 20, 1500);
dump(host, "host-BWn2", "async function BWn", 20, 1800);
dump(host, "host-InstallPlugin", 'typeName="aiserver.v1.InstallPlugin', 20, 800);
dump(host, "host-GetEffReq", 'typeName="aiserver.v1.GetEffectiveUserPluginsRequest"', 20, 400);
dump(view, "view-Qs", "function Qs(", 20, 400);
dump(index, "idx-skillsStore", "skillsCatalog:", 80, 1500);
dump(index, "idx-hKn", "hKn=", 20, 400);

// Find how overlay loads servers
for (const n of ["listMcpServers", "mcpServersQuery", "useMcpServers", "getCatalog("]) {
  console.log("view", n, view.indexOf(n), "idx", index.indexOf(n));
}

// plugin store in view
dump(view, "view-Da2", "listBoxMcp", 40, 200);
dump(view, "view-poll", "pollIntervalMs", 80, 400);
