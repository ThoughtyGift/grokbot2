// Does the system prompt actually advertise the browser tools when a CDP endpoint is set?
const mod = await import("../src/chat.ts");
const src = await (await import("node:fs/promises")).readFile("src/chat.ts", "utf8");
const names = (src.match(/BROWSER_TOOL_NAMES/g) || []).length;
console.log("chat.ts references BROWSER_TOOL_NAMES:", names, "time(s)");
