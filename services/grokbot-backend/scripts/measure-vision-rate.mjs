// How often does an image-only turn actually work? One number instead of an anecdote.
import zlib from "node:zlib";
import { gwHeaders } from "./gw-auth.mjs";
const GW = "http://localhost:8788/gw/api";
const post = async (m, b) => (await fetch(`${GW}/${m}`, { method: "POST", headers: { "content-type": "application/json", ...gwHeaders() }, body: JSON.stringify(b) })).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function crc32(b){let c=~0;for(const x of b){c^=x;for(let i=0;i<8;i++)c=(c>>>1)^(0xEDB88320&-(c&1));}return ~c>>>0;}
function chunk(t,d){const T=Buffer.from(t,"latin1");const L=Buffer.alloc(4);L.writeUInt32BE(d.length);const C=Buffer.alloc(4);C.writeUInt32BE(crc32(Buffer.concat([T,d])));return Buffer.concat([L,T,d,C]);}
function solidPng(r,g,b,s=16){const i=Buffer.alloc(13);i.writeUInt32BE(s,0);i.writeUInt32BE(s,4);i[8]=8;i[9]=2;const row=Buffer.concat([Buffer.from([0]),...Array(s).fill(Buffer.from([r,g,b]))]);return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",i),chunk("IDAT",zlib.deflateSync(Buffer.concat(Array(s).fill(row)))),chunk("IEND",Buffer.alloc(0))]);}
const NL = String.fromCharCode(10);
const REPS = Number(process.argv[2] ?? 2);
const SAW = /xanh l|green|xanh$/i;
const tally = { saw: 0, denied: 0, toolhunt: 0, poolerr: 0, timeout: 0 };
for (let n = 0; n < REPS; n++) {
  const { agent } = await post("createAgent", { name: `Rate${n}` });
  await post("sendPrompt", { agentId: agent.id, content: "Chào, trả lời ngắn.", clientNonce: `x${Date.now()}${n}` });
  await sleep(11000);
  const up = await post("uploadAttachment", { filename: "green.png", bytesBase64: solidPng(0,200,0).toString("base64") });
  const before = (await post("getAgentTranscript", { id: agent.id, limit: 200 })).entries?.length ?? 0;
  await post("sendPrompt", { agentId: agent.id, content: "", attachmentPaths: [up.path], attachmentNames: ["green.png"], clientNonce: `y${Date.now()}${n}` });
  let verdict = "timeout", said = "", tools = "";
  for (let i = 0; i < 55; i++) {
    await sleep(1000);
    const fresh = ((await post("getAgentTranscript", { id: agent.id, limit: 200 })).entries ?? []).slice(before);
    said = fresh.filter((e) => e.kind === "send-message").map((e) => e.message?.content ?? "").join(" ");
    tools = fresh.filter((e) => e.kind === "tool-call").map((e) => e.name).join(",");
    if (said.includes("[grokbot2] Pool error")) { verdict = "poolerr"; break; }
    if (SAW.test(said)) { verdict = "saw"; break; }
    if (/kh(ô|o)ng th(ấ|a)y|ch(ư|u)a th(ấ|a)y|tr(ố|o)ng|g(ử|u)i l(ạ|a)i/i.test(said)) { verdict = tools ? "toolhunt" : "denied"; break; }
  }
  tally[verdict]++;
  console.log(`rep ${n + 1}: ${verdict}${tools ? ` (tools: ${tools})` : ""} — ${said.split(NL).join(" ").slice(0, 80)}`);
  await post("deleteAgents", { ids: [agent.id] });
}
console.log("tally:", JSON.stringify(tally));
