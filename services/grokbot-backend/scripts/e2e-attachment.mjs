/**
 * Prove a picture reaches the transcript, through the real pipeline.
 *
 * Runs a browser tool with the same ToolCtx the approval path uses, so the screenshot goes
 * stage → transcript entry → gateway, exactly as it does in the app. Then checks the entry the
 * gateway serves and that readAttachmentImage returns bytes for its path.
 *
 *   GROKBOT2_BROWSER_CDP=http://127.0.0.1:9223 node scripts/e2e-attachment.mjs [agentId]
 */
import { runBrowserTool, closeBrowser } from "../src/browser.ts";
import { postAttachment } from "../src/chat.ts";
import { readAttachmentImage, stagedCount } from "../src/attachments.ts";

const agentId = process.argv[2] ?? "agent-7";

await runBrowserTool("browser_navigate", JSON.stringify({ url:
  "data:text/html,<body style='margin:0;background:%230b7;font:700 44px sans-serif;color:%23fff;display:flex;align-items:center;justify-content:center;height:300px'>ATTACHMENT OK</body>" }));

let posted = null;
const ctx = { attach: (dataUrl, fileName, alt) => { posted = { dataUrl, fileName, alt }; postAttachment(agentId, dataUrl, fileName, alt); } };
await runBrowserTool("browser_snapshot", "", ctx);
closeBrowser();

if (posted == null) { console.error("FAIL: the tool never attached anything"); process.exit(1); }
console.log(`attached ${posted.fileName} (${posted.dataUrl.length} chars of data URL)`);
console.log(`staged images: ${stagedCount()}`);

// What the gateway would now serve for this agent.
const { transcriptTail } = await import("../src/chat.ts");
const page = transcriptTail({ id: agentId });
const att = [...page.entries].reverse().find((e) => e.kind === "send-message" && e.message?.type === "attachment");
if (att == null) { console.error("FAIL: no attachment entry in the transcript"); process.exit(1); }

console.log(`entry url: ${att.message.url}`);
const ok = /\.(png|jpg|jpeg|gif|webp)$/i.test(att.message.url);
console.log(`url ends in an image extension (the renderer's media gate): ${ok}`);

const bytes = readAttachmentImage({ path: att.message.url });
console.log(bytes == null
  ? "readAttachmentImage: MISS"
  : `readAttachmentImage: ${bytes.width}x${bytes.height}, ${bytes.dataUrl.length} chars`);

const pass = ok && bytes != null && bytes.width > 0 && bytes.height > 0;
console.log(pass ? "\nPASS: attachment is staged, addressable and measurable." : "\nFAIL");
process.exit(pass ? 0 : 1);
