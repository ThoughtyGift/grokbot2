/**
 * An image sent with NO caption — the shape the composer produces when you attach a picture and
 * press send without typing anything.
 *
 * This is the case every earlier vision test missed: they all sent a caption alongside the image,
 * so the user turn always had text and the history always ended on a user turn. Without a caption
 * both entries the turn appends (the empty user message and the attachment) carry no text, the
 * history filter dropped both, and the request ended on the previous ANSWER — which Vertex refuses:
 *   "Vertex 400: Requests ending with a model turn are not supported"
 *
 * Needs the backend running:  pnpm backend
 *   node scripts/e2e-attach-no-caption.mjs
 */
import zlib from "node:zlib";
import { gwHeaders } from "./gw-auth.mjs";

const GW = "http://localhost:8788/gw/api";
const post = async (m, b) => (await fetch(`${GW}/${m}`, {
  method: "POST", headers: { "content-type": "application/json", ...gwHeaders() }, body: JSON.stringify(b),
})).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function crc32(buf){let c=~0;for(const b of buf){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^(0xEDB88320&-(c&1));}return ~c>>>0;}
function chunk(type,data){const t=Buffer.from(type,"latin1");const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(Buffer.concat([t,data])));return Buffer.concat([len,t,data,crc]);}
function solidPng(r,g,b,size=16){
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(size,0);ihdr.writeUInt32BE(size,4);ihdr[8]=8;ihdr[9]=2;
  const row=Buffer.concat([Buffer.from([0]),...Array(size).fill(Buffer.from([r,g,b]))]);
  const raw=Buffer.concat(Array(size).fill(row));
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",ihdr),chunk("IDAT",zlib.deflateSync(raw)),chunk("IEND",Buffer.alloc(0))]);
}

let pass = 0, fail = 0;
const check = (n, ok, d) => { ok ? pass++ : fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${n}${d ? `  — ${d}` : ""}`); };

const textsOf = (entries) => entries.map((e) => e.content || e.message?.content || "").join("\n");
async function waitForReply(agentId, before, label) {
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    const t = await post("getAgentTranscript", { id: agentId, limit: 200 });
    const fresh = (t.entries ?? []).slice(before);
    const done = fresh.some((e) => e.kind === "send-message" && !e.streaming && (e.message?.content ?? "").trim());
    if (done) return fresh;
  }
  console.log(`  (timed out waiting for ${label})`);
  return ((await post("getAgentTranscript", { id: agentId, limit: 200 })).entries ?? []).slice(before);
}

const { agent } = await post("createAgent", { name: "NoCaption" });
console.log(`agent ${agent.id}\n`);

// 1. a first turn WITH text, so the history ends on an assistant answer — the precondition
console.log("1. a plain text turn, so the next request follows a model turn");
let before = (await post("getAgentTranscript", { id: agent.id, limit: 200 })).entries?.length ?? 0;
await post("sendPrompt", { agentId: agent.id, content: "Chào bạn, trả lời ngắn gọn một câu.", clientNonce: `c${Date.now()}` });
let fresh = await waitForReply(agent.id, before, "the text turn");
check("text turn answered", /\S/.test(textsOf(fresh.filter((e) => e.kind === "send-message"))) && !textsOf(fresh).includes("Pool error"),
  textsOf(fresh.filter((e) => e.kind === "send-message")).slice(0, 60).replace(/\n/g, " "));

// 2. upload — the client's own contract: {filename, bytesBase64} -> reads .path
console.log("\n2. attach a picture and send it with NO caption");
const png = solidPng(0, 200, 0);
const up = await post("uploadAttachment", { filename: "green.png", bytesBase64: png.toString("base64") });
check("uploadAttachment ok", !!up?.path, up?.path || JSON.stringify(up).slice(0, 80));
if (!up?.path) { console.log(`\n${pass} passed, ${fail} failed`); process.exit(1); }

// 3. the failing shape: empty content + attachmentPaths/attachmentNames
before = (await post("getAgentTranscript", { id: agent.id, limit: 200 })).entries?.length ?? 0;
await post("sendPrompt", {
  agentId: agent.id, content: "",
  attachmentPaths: [up.path], attachmentNames: ["green.png"],
  clientNonce: `n${Date.now()}`,
});
// A model may post an interim line before the real answer, so do not stop at the first finished
// bubble - collect every assistant bubble in the window and judge them together.
const NL = String.fromCharCode(10);
const oneLine = (s) => s.split(NL).join(" ").slice(0, 140);
const GREEN = /green|xanh l[áa]|màu xanh/i;
const POOL_ERR = "[grokbot2] Pool error";
let all = [];
for (let i = 0; i < 90; i++) {
  await sleep(1000);
  all = ((await post("getAgentTranscript", { id: agent.id, limit: 200 })).entries ?? []).slice(before);
  const said = textsOf(all.filter((e) => e.kind === "send-message" && !e.streaming));
  if (GREEN.test(said) || said.includes(POOL_ERR)) break;
}
const reply = textsOf(all.filter((e) => e.kind === "send-message"));
const tools = all.filter((e) => e.kind === "tool-call").map((e) => e.name).join(",");
if (tools) console.log(`  (tools it reached for: ${tools})`);
check("no Vertex 400 (the bug)", !/Requests ending with a model turn/i.test(reply), oneLine(reply));
check("no pool error at all", !reply.includes(POOL_ERR), oneLine(reply));
check("the model actually SAW the picture (green)", GREEN.test(reply), oneLine(reply));

await post("deleteAgents", { ids: [agent.id] });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
