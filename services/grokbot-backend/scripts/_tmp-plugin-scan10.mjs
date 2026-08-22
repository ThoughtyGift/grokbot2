import fs from "node:fs";
const v = fs.readFileSync("C:/Users/admin/AppData/Local/Programs/Grok Bot/resources/app/dist/renderer/assets/view--8LkllMO.js", "utf8");
function dump(name) {
  const needles = [`function ${name}(`, `const ${name}=`, `${name}=n=>`, `${name}=(`];
  for (const n of needles) {
    const i = v.indexOf(n);
    if (i >= 0) {
      console.log("====", name, n, i);
      console.log(v.slice(i, i + 800));
      return;
    }
  }
  console.log("MISSING", name);
}
for (const n of ["Da", "La", "Oa", "qn", "Fa"]) dump(n);
const i = v.indexOf("{plugins:re}");
console.log("==== plugins re", i);
console.log(v.slice(Math.max(0, i - 80), i + 40));
const j = v.indexOf("function $a(");
console.log("$a fn", j, j >= 0 ? v.slice(j, j + 500) : "");
