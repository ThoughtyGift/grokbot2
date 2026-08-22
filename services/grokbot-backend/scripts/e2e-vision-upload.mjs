/**
 * E2E for the USER upload → vision path (the "đính ảnh, hỏi ảnh này là gì" flow).
 *
 * The app's real sequence: uploadAttachment(bytes) → {url}, then sendPrompt with that url in
 * `attachments`. readImageAttachment resolves the staged bytes and pool-client routes them to
 * /v1/messages so the model actually SEES the picture. Two different solid colors are sent in
 * two turns: if the model names both correctly, it is reading THESE bytes — not echoing a cached
 * "red" and not guessing one lucky color.
 */
import zlib from "node:zlib";
import { gwHeaders } from "./gw-auth.mjs";

const GW = "http://localhost:8788/gw/api";
const post = async (m, b) => (await fetch(`${GW}/${m}`, {
  method: "POST", headers: { "content-type": "application/json", ...gwHeaders() }, body: JSON.stringify(b),
})).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── valid solid-color PNG (proper zlib stream + CRCs) ──────────────────────────
function crc32(buf){let c=~0;for(const b of buf){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^(0xEDB88320&-(c&1));}return ~c>>>0;}
function chunk(type,data){const t=Buffer.from(type,"latin1");const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(Buffer.concat([t,data])));return Buffer.concat([len,t,data,crc]);}
function solidPng(r,g,b,size=16){
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(size,0);ihdr.writeUInt32BE(size,4);ihdr[8]=8;ihdr[9]=2;
  const row=Buffer.concat([Buffer.from([0]),...Array(size).fill(Buffer.from([r,g,b]))]);
  const raw=Buffer.concat(Array(size).fill(row));
  const idat=zlib.deflateSync(raw);
  const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",ihdr),chunk("IDAT",idat),chunk("IEND",Buffer.alloc(0))]);
  return "data:image/png;base64,"+png.toString("base64");
}

let pass=0, fail=0;
const check=(n,ok,d)=>{ok?pass++:fail++;console.log(`  ${ok?"ok  ":"FAIL"} ${n}${d?`  — ${d}`:""}`);};

const CASES=[
  { label:"BLUE",  rgb:[0,0,255],   dataUrl:solidPng(0,0,255),   match:/blue|^xanh[.!\s]*$|xanh d[uươ]|xanh l[aạ]m|xanh biển|màu xanh/i },
  { label:"YELLOW",rgb:[255,255,0], dataUrl:solidPng(255,255,0), match:/yellow|vàng/i },
];

const { agent } = await post("createAgent", { name: "VisionUpload" });
console.log(`agent ${agent.id}\n`);

for (const c of CASES) {
  console.log(`Case ${c.label} rgb(${c.rgb.join(",")})`);
  // 1. upload — exactly what the composer does when you attach a file
  const up = await post("uploadAttachment", { dataUrl: c.dataUrl, fileName: `${c.label.toLowerCase()}.png` });
  check("uploadAttachment ok", up?.ok === true && !!up.url, up?.url || up?.reason);
  if (!up?.ok) continue;

  // 2. read it back the way the desktop preview does — proves the bytes staged & measured
  const img = await post("readAttachmentImage", { path: up.url });
  check("staged & measured", img?.width > 0 && img?.height > 0, img ? `${img.width}x${img.height}` : "null");

  // 3. send the prompt WITH the attachment — the vision turn
  const before = (await post("getAgentTranscript", { id: agent.id, limit: 200 })).entries?.length ?? 0;
  await post("sendPrompt", {
    agentId: agent.id,
    content: "Bức ảnh này màu gì? Trả lời ngắn gọn bằng một từ.",
    attachments: [{ path: up.url, name: up.fileName }],
    clientNonce: `v${Date.now()}${Math.random()}`,
  });

  // 4. poll for the assistant reply
  let reply = "";
  for (let i=0;i<45;i++){
    await sleep(1000);
    const t = await post("getAgentTranscript", { id: agent.id, limit: 200 });
    const fresh = (t.entries ?? []).slice(before);
    const bot = fresh.filter(e => (e.kind==="send-message"||e.author?.kind==="agent"||e.role==="assistant") && !e.streaming);
    const last = bot[bot.length-1];
    const txt = last?.message?.content ?? last?.content ?? "";
    if (txt && txt.trim() && !/^\[grokbot2\]/.test(txt)) { reply = txt.trim(); break; }
  }
  check(`model described the image`, c.match.test(reply), reply ? `"${reply.slice(0,80)}"` : "no reply in 45s");
  console.log("");
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
