/**
 * Extract the gateway command table from `src/host/gateway-protocol.ts` in main.cjs.
 *
 * This is the authority, and it is better than anything inferred: the electron-main bundle
 * is NOT minified, so the table survives with its real names — every command the client can
 * send, and which ones take a body. Coverage measured against the renderer's method list was
 * a guess by comparison.
 *
 *   node extract-gateway.mjs <main.cjs> [outDir]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(process.argv[2], "utf8").replace(/\\n/g, "\n");
const outDir = process.argv[3] ?? ".";

/** Slice one `var NAME = { … };` object out of the module. */
function objectAfter(name) {
  const at = src.indexOf(`var ${name} = {`);
  if (at < 0) return null;
  const open = src.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") { depth -= 1; if (depth === 0) return src.slice(open, i + 1); }
  }
  return null;
}

const parse = (body) =>
  body
    ? [...body.matchAll(/^\s{2}([A-Za-z0-9_]+):\s*\(api(?:,\s*(body))?\)/gm)]
        .map((m) => ({ name: m[1], takesBody: Boolean(m[2]) }))
    : [];

const commands = parse(objectAfter("SAND_GATEWAY_COMMANDS"));
const slim = parse(objectAfter("SAND_GATEWAY_SLIM_COMMANDS"));

if (!commands.length) {
  console.error("SAND_GATEWAY_COMMANDS not found — is this the electron-main bundle?");
  process.exit(1);
}

const payload = {
  source: process.argv[2],
  note: "The client's own command table, from an unminified bundle. This is the authority on what the gateway must answer.",
  counts: { commands: commands.length, slim: slim.length, withBody: commands.filter((c) => c.takesBody).length },
  commands,
  slimCommands: slim,
};

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "gateway-commands.json"), JSON.stringify(payload, null, 2));

console.log(`commands      : ${commands.length}`);
console.log(`  take a body : ${payload.counts.withBody}`);
console.log(`slim variants : ${slim.length}`);
console.log(`\nwrote ${join(outDir, "gateway-commands.json")}`);
