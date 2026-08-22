import fs from "node:fs";
const host = fs.readFileSync("C:/Users/admin/AppData/Local/Programs/Grok Bot/resources/app/dist/host/host-main.cjs", "utf8");
const i = host.indexOf('xu.typeName="aiserver.v1.Plugin"');
console.log("typeName", i);
// constructor is BEFORE typeName
const ctor = host.lastIndexOf("xu=class", i);
console.log("class", ctor);
const slice = host.slice(ctor, ctor + 500);
console.log(slice);
