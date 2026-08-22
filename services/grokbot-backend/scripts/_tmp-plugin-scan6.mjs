import fs from "node:fs";
const host = fs.readFileSync("C:/Users/admin/AppData/Local/Programs/Grok Bot/resources/app/dist/host/host-main.cjs", "utf8");
const view = fs.readFileSync("C:/Users/admin/AppData/Local/Programs/Grok Bot/resources/app/dist/renderer/assets/view--8LkllMO.js", "utf8");
const out = "C:/Users/admin/Desktop/grokbot2/services/grokbot-backend/scripts";
function dump(src, label, needle, before, after) {
  const i = src.indexOf(needle);
  console.log(label, i);
  if (i >= 0) fs.writeFileSync(`${out}/_tmp-${label}.txt`, src.slice(Math.max(0, i - before), i + after));
}
dump(host, "host-listBoxFn", "async listBoxServers", 40, 1800);
dump(view, "view-enabled", "isEnabledForAgent", 80, 600);
dump(view, "view-sourceWorkflow", 'source:"workflow"', 80, 400);
