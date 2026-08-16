/** What the model is actually offered right now, and why. */
import { TOOLS as BOX_TOOLS, toolProtocol } from "../src/tools.ts";
import { boxConfigured } from "../src/box-exec.ts";
import { BROWSER_TOOL_NAMES, isBrowserConfigured } from "../src/browser.ts";

console.log(`box configured     : ${boxConfigured()}   (GROKBOT2_BOX_EXEC_URL)`);
console.log(`browser configured : ${isBrowserConfigured()}   (GROKBOT2_BROWSER_CDP)`);
console.log(`\nbox tools (${Object.keys(BOX_TOOLS).length}) — offered only when a box exists:`);
for (const t of Object.values(BOX_TOOLS)) console.log(`  ${t.usage.padEnd(56)} approval=${t.needsApproval}`);
console.log(`\nbrowser tools (${BROWSER_TOOL_NAMES.length}): ${BROWSER_TOOL_NAMES.slice(0, 6).join(", ")}…`);
console.log(`\n--- tool section of the system prompt as it stands ---${toolProtocol()}`);
