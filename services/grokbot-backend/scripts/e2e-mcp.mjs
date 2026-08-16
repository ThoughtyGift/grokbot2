/**
 * Exercise the MCP tools against the servers declared in `.mcp.json`.
 *
 *   node --import tsx scripts/e2e-mcp.mjs        (or: npx tsx scripts/e2e-mcp.mjs)
 *
 * Prints tool NAMES and results only — never a server's env or args, which carry live tokens.
 */
import { getMcpTools, callMcpTool, mcpServers, closeMcp } from "../src/mcp.ts";

const names = Object.keys(mcpServers());
console.log(`servers declared: ${names.length ? names.join(", ") : "(none)"}`);
if (names.length === 0) process.exit(1);

console.log("\n--- get_mcp_tools (all) ---");
const listed = await getMcpTools("");
console.log(listed);

const first = names[0];
console.log(`\n--- get_mcp_tools("${first}") ---`);
console.log(await getMcpTools(first));

// A tool that does not exist must fail clearly rather than hang or throw.
console.log("\n--- call_mcp_tool, unknown tool ---");
console.log(await callMcpTool(JSON.stringify({ server: first, tool_name: "definitely_not_a_tool", tool_args: {} })));

console.log("\n--- call_mcp_tool, malformed args ---");
console.log(await callMcpTool("not json"));

// One real round-trip against whatever the first server actually offers.
const toolLine = listed.split("\n").find((l) => l.startsWith(`${first}:`)) ?? "";
const firstTool = toolLine.slice(first.length + 1).split(",")[0]?.trim();
if (firstTool && !firstTool.startsWith("(") && !toolLine.includes("lỗi")) {
  console.log(`\n--- call_mcp_tool("${first}", "${firstTool}") ---`);
  const out = await callMcpTool(JSON.stringify({ server: first, tool_name: firstTool, tool_args: {} }));
  console.log(String(out).slice(0, 400));
}

closeMcp();
console.log("\ndone");
