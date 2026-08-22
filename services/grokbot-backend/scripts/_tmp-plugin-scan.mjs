import fs from "node:fs";

const host = "C:/Users/admin/AppData/Local/Programs/Grok Bot/resources/app/dist/host/host-main.cjs";
const view = "C:/Users/admin/AppData/Local/Programs/Grok Bot/resources/app/dist/renderer/assets/view--8LkllMO.js";
const dir = "C:/Users/admin/Desktop/grokbot2/services/grokbot-backend/scripts";
const s = fs.readFileSync(host, "utf8");

function dumpAround(label, needle, before = 80, after = 2500) {
  const i = s.indexOf(needle);
  console.log(label, i);
  if (i < 0) return;
  fs.writeFileSync(`${dir}/_tmp-host-${label}.txt`, s.slice(Math.max(0, i - before), i + after));
}

dumpAround("PluginType", 'typeName="aiserver.v1.Plugin"', 40, 4500);
dumpAround("ListMpResp", 'typeName="aiserver.v1.ListMarketplacePluginsResponse"', 40, 800);
dumpAround("ListMpReq", 'typeName="aiserver.v1.ListMarketplacePluginsRequest"', 40, 800);
dumpAround("GetEff", 'typeName="aiserver.v1.GetEffectiveUserPluginsResponse"', 40, 1500);
dumpAround("createSum", "createBoxServerSummary", 40, 2000);
dumpAround("listServersFn", "async listServers(", 40, 1500);

const v = fs.existsSync(view) ? fs.readFileSync(view, "utf8") : "";
console.log("view len", v.length);
for (const needle of ["ZS1TFm", "W0GRSo", "EuTQUZ", "source===\"workflow\"", "listBoxMcpServers", "mcpServers.length"]) {
  console.log("view", needle, v.indexOf(needle));
}
