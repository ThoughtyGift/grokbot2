import fs from "node:fs";
const host = fs.readFileSync("C:/Users/admin/AppData/Local/Programs/Grok Bot/resources/app/dist/host/host-main.cjs", "utf8");
const out = "C:/Users/admin/Desktop/grokbot2/services/grokbot-backend/scripts";

// Find hostMcp implementation - likely a class with listBoxServers taking (e, {kickOnly})
let from = 0, n = 0;
while (n < 8) {
  const i = host.indexOf("listBoxServers", from);
  if (i < 0) break;
  const ctx = host.slice(Math.max(0, i - 60), i + 80).replace(/\n/g, " ");
  console.log(n, i, ctx);
  from = i + 14;
  n++;
}

const i = host.indexOf("async listBoxServers(t,e)");
console.log("async listBoxServers(t,e)", i);
const j = host.indexOf("listBoxServers(t,e)");
console.log("listBoxServers(t,e)", j);
if (j >= 0) fs.writeFileSync(`${out}/_tmp-host-listBoxImpl.txt`, host.slice(Math.max(0, j - 100), j + 2500));
