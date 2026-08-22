/**
 * Images found on a page must arrive as pictures, not links.
 *
 * Two halves, both asserted, because either one failing produces the same blank result:
 *
 *   1. measurement — the renderer needs real width/height, so an unmeasurable format is
 *      dropped by stageImage() and the attachment silently never appears. PNG was the only
 *      format it could read, which is why a JPEG from a CDN showed nothing.
 *   2. the fence — attach_image fetches a URL chosen by the model, so it is a request-forgery
 *      surface. The box's DevTools port is unauthenticated RCE on loopback, so "it only
 *      returns images" is not an argument for leaving the fence untested.
 *
 * Needs the backend running:  pnpm dev
 *   node scripts/e2e-attach-image.mjs
 */
import { gwHeaders } from "./gw-auth.mjs";

const GW = "http://localhost:8788/gw/api";
const post = async (m, b) => (await fetch(`${GW}/${m}`, {
  method: "POST", headers: { "content-type": "application/json", ...gwHeaders() }, body: JSON.stringify(b),
})).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? `  — ${detail}` : ""}`);
};

/** Run one tool directly and return the transcript entries it produced. */
async function callTool(agentId, name, args) {
  const before = (await post("getAgentTranscript", { id: agentId, limit: 100 })).entries?.length ?? 0;
  await post("sendPrompt", {
    agentId, content: `/tool ${name} ${JSON.stringify(args)}`,
    clientNonce: `ai${Date.now()}${Math.random()}`,
  });
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const t = await post("getAgentTranscript", { id: agentId, limit: 100 });
    const fresh = (t.entries ?? []).slice(before);
    if (fresh.some((e) => e.kind === "tool-call" || e.message?.type === "attachment")) {
      await sleep(1500);
      return ((await post("getAgentTranscript", { id: agentId, limit: 100 })).entries ?? []).slice(before);
    }
  }
  return [];
}

const { agent } = await post("createAgent", { name: "ImageFetch" });

// A real JPEG and a real WebP off the public web. The point of this test is formats stageImage
// could not measure before, so a PNG here would assert nothing new.
// The JPEG is served with an EXIF block ahead of the frame header, which is the case a
// fixed-offset reader gets wrong — the size is only findable by walking the segments.
const CASES = [
  { label: "JPEG", url: "https://picsum.photos/300/200.jpg" },
  { label: "WebP", url: "https://www.gstatic.com/webp/gallery/1.webp" },
  { label: "GIF", url: "https://upload.wikimedia.org/wikipedia/commons/2/2c/Rotating_earth_%28large%29.gif" },
];

console.log("1. a remote image becomes an attachment, not a link");
for (const c of CASES) {
  const fresh = await callTool(agent.id, "attach_image", { url: c.url, alt: c.label });
  const att = fresh.find((e) => e.message?.type === "attachment");
  check(`${c.label} attached`, att != null, att ? att.message.url : "no attachment entry");
  if (!att) continue;
  // The renderer routes on the URL's extension and refuses to draw without dimensions, so a
  // path alone is not success — read the bytes back the way the desktop does.
  const img = await post("readAttachmentImage", { path: att.message.url });
  check(`${c.label} measured`, img?.width > 0 && img?.height > 0, img ? `${img.width}x${img.height}` : "readAttachmentImage returned null");
  const mime = (img?.dataUrl ?? "").slice(5, 15);
  check(`${c.label} mime from bytes`, mime.startsWith(`image/${c.label.toLowerCase()}`), mime || "none");
}

console.log("\n2. the fetcher refuses to reach inside the machine");
// 9223 is the box's Chrome DevTools port — the concrete thing this fence exists to protect.
const BLOCKED = [
  ["loopback by name", "http://localhost:9223/json/list"],
  ["loopback by address", "http://127.0.0.1:9223/json/list"],
  ["private range", "http://192.168.1.1/favicon.png"],
  ["cloud metadata", "http://169.254.169.254/latest/meta-data/"],
  ["non-http scheme", "file:///C:/Windows/win.ini"],
];
for (const [label, url] of BLOCKED) {
  const fresh = await callTool(agent.id, "attach_image", { url });
  const attached = fresh.some((e) => e.message?.type === "attachment");
  const said = fresh.find((e) => e.kind === "tool-call")?.result
    ?? fresh.map((e) => e.message?.content).filter(Boolean).join(" ").slice(0, 60);
  check(`${label} blocked`, !attached, attached ? "ATTACHED — fence did not hold" : String(said ?? "refused").slice(0, 60));
}

console.log("\n3. one call attaches many, and the fence still applies to each");
{
  // Mixed on purpose: a batch must not become a way around the per-URL check, and one bad
  // entry must not cost the good ones.
  const urls = [
    "https://picsum.photos/seed/a/240/160.jpg",
    "http://127.0.0.1:9223/json/list",
    "https://picsum.photos/seed/b/240/160.jpg",
  ];
  const fresh = await callTool(agent.id, "attach_image", { urls });
  const atts = fresh.filter((e) => e.message?.type === "attachment");
  check("two good URLs attached in one call", atts.length === 2, `${atts.length} attachment(s)`);
  check("one tool step, not three", fresh.filter((e) => e.kind === "tool-call").length === 1,
    `${fresh.filter((e) => e.kind === "tool-call").length} tool-call entries`);
  const names = atts.map((e) => e.message.url).join(" ");
  check("loopback entry produced no attachment", !/json|list|9223/.test(names), names || "none");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
