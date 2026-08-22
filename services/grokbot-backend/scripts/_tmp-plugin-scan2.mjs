import fs from "node:fs";
import path from "node:path";

const dir = "C:/Users/admin/AppData/Local/Programs/Grok Bot/resources/app/dist/renderer/assets";
const out = "C:/Users/admin/Desktop/grokbot2/services/grokbot-backend/scripts";
const needles = [
  "listBoxMcpServers",
  "skillsCatalog",
  "GetEffectiveUserPlugins",
  "listMarketplacePlugins",
  "ListMarketplacePlugins",
  "ZS1TFm",
  "W0GRSo",
  "EuTQUZ",
  "source===\"workflow\"",
  "publishedByCurrentUser",
];

for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".js"))) {
  const p = path.join(dir, f);
  const s = fs.readFileSync(p, "utf8");
  for (const n of needles) {
    const i = s.indexOf(n);
    if (i >= 0) {
      console.log(f, n, i, "len", s.length);
      fs.writeFileSync(`${out}/_tmp-view-${n.replace(/[^a-zA-Z0-9]+/g, "_")}.txt`, s.slice(Math.max(0, i - 400), i + 1800));
    }
  }
}

const host = fs.readFileSync("C:/Users/admin/AppData/Local/Programs/Grok Bot/resources/app/dist/host/host-main.cjs", "utf8");
for (const n of ["listBoxServers", "listBoxMcpServers", "fetchMarketplaceMcpPlugins", "getCatalog", "excludeCloudAgentPlugins"]) {
  const i = host.indexOf(n);
  console.log("host", n, i);
}
