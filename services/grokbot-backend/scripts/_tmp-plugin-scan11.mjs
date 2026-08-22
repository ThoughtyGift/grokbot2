import fs from "node:fs";
import path from "node:path";
const dir = "C:/Users/admin/AppData/Local/Programs/Grok Bot/resources/app/dist/renderer/assets";
const out = "C:/Users/admin/Desktop/grokbot2/services/grokbot-backend/scripts";
const needles = ["getAgentWorkflows", "isEnabledForAgent", "source:\"workflow\"", "source:'workflow'"];
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".js"))) {
  const s = fs.readFileSync(path.join(dir, f), "utf8");
  for (const n of needles) {
    const i = s.indexOf(n);
    if (i >= 0) {
      console.log(f, n, i);
      if (n === "getAgentWorkflows" || n.includes("Enabled")) {
        fs.writeFileSync(`${out}/_tmp-${f.slice(0, 12)}-${n.replace(/[^a-zA-Z]/g, "")}.txt`, s.slice(Math.max(0, i - 250), i + 900));
      }
    }
  }
}
const host = fs.readFileSync("C:/Users/admin/AppData/Local/Programs/Grok Bot/resources/app/dist/host/host-main.cjs", "utf8");
const i = host.indexOf("getAgentWorkflows:");
console.log("host getAgentWorkflows", i);
if (i >= 0) fs.writeFileSync(`${out}/_tmp-host-getAgentWorkflows.txt`, host.slice(Math.max(0, i - 80), i + 1500));
