import fs from "node:fs";
const host = fs.readFileSync("C:/Users/admin/AppData/Local/Programs/Grok Bot/resources/app/dist/host/host-main.cjs", "utf8");
const out = "C:/Users/admin/Desktop/grokbot2/services/grokbot-backend/scripts";

const needles = [
  "hostMcp.listBoxServers",
  "listBoxServers(e,{kickOnly",
  ".listBoxMcpServers(",
  "listBoxMcpServers({",
  "serverIdentifiers",
];
for (const n of needles) {
  let from = 0, c = 0;
  while (c < 5) {
    const i = host.indexOf(n, from);
    if (i < 0) break;
    console.log(n, i);
    if (c === 0) fs.writeFileSync(`${out}/_tmp-hit-${c}-${n.replace(/[^a-zA-Z]+/g, "_")}.txt`, host.slice(Math.max(0, i - 200), i + 900));
    from = i + n.length;
    c++;
  }
}

// box client method
const i = host.indexOf("listBoxMcpServers(t");
console.log("listBoxMcpServers(t", i);
