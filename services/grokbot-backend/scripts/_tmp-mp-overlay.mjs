import fs from "node:fs";
const view = fs.readFileSync("C:/Users/admin/AppData/Local/Programs/Grok Bot/resources/app/dist/renderer/assets/view--8LkllMO.js", "utf8");
const host = fs.readFileSync("C:/Users/admin/AppData/Local/Programs/Grok Bot/resources/app/dist/host/host-main.cjs", "utf8");
const out = "C:/Users/admin/Desktop/grokbot2/services/grokbot-backend/scripts";

function dump(src, label, needle, before, after) {
  const i = src.indexOf(needle);
  console.log(label, i);
  if (i >= 0) fs.writeFileSync(`${out}/_tmp-${label}.txt`, src.slice(Math.max(0, i - before), i + after));
}

dump(view, "catHook", "getCatalog(", 80, 1500);
dump(host, "hostIpcCatalog", "getCatalog:", 40, 800);
dump(view, "isLoadingCat", "isLoading:he", 80, 400);
dump(view, "neCatalog", "catalog:ne", 80, 400);
