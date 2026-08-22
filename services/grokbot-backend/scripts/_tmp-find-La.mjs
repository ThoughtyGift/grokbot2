import fs from "node:fs";
import path from "node:path";
const dir = "C:/Users/admin/AppData/Local/Programs/Grok Bot/resources/app/dist/renderer/assets";
const out = "C:/Users/admin/Desktop/grokbot2/services/grokbot-backend/scripts";
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".js"))) {
  const s = fs.readFileSync(path.join(dir, f), "utf8");
  for (const n of ["function La(", "getCatalog()", ".getCatalog(", "catalogFlow"]) {
    const i = s.indexOf(n);
    if (i >= 0) {
      console.log(f, n, i);
      fs.writeFileSync(`${out}/_tmp-la-${n.replace(/[^a-zA-Z]/g, "")}.txt`, s.slice(Math.max(0, i - 200), i + 1800));
    }
  }
}
