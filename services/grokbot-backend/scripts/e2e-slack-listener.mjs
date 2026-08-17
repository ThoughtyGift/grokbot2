/**
 * Tầng 1 Slack, end to end with a FAKE Slack payload — no real Slack needed.
 * Proves: url_verification handshake echoes the challenge, and an event_callback wakes a routine
 * whose trigger is a Slack listener, running it with the message as context.
 */
import fs from "node:fs";
const T=fs.readFileSync(".data/gateway-token.txt","utf8").trim();
const gw=async(m,a)=>{const r=await fetch("http://127.0.0.1:8788/gw/api/"+m,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${T}`},body:JSON.stringify(a||{})});return r.json();};
const slack=(b)=>fetch("http://127.0.0.1:8788/gw/slack/events",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(b)}).then(r=>r.json());
const pass=[];const step=(n,ok,d="")=>{pass.push(ok);console.log(`${ok?"PASS":"FAIL"}  ${n}${d?"  — "+d:""}`);};

// 1. handshake
const h=await slack({type:"url_verification",challenge:"abc123"});
step("handshake tra ve challenge", h?.challenge==="abc123", JSON.stringify(h));

// 2. tao mot bot + routine trigger Slack
const made=await gw("createAgent",{name:"slack-listener"}); const id=made?.agent?.id??made?.id;
await gw("createAgentAutomation",{id,spec:{name:"Slack cmd",prompt:"Xu ly lenh Slack va tra loi.",trigger:"slack_mention"}});
const before=((await gw("getAgentTranscriptTail",{agentId:id}))?.entries??[]).length;

// 3. ban su kien Slack gia -> routine phai chay
const ev=await slack({type:"event_callback",event:{type:"app_mention",text:"@bot tong hop tin tuc",channel:"C123",thread_ts:"1700.1",user:"U1"}});
step("su kien Slack danh thuc routine", ev?.fired>=1, `fired=${ev?.fired}`);

// 4. routine chay that -> transcript tang, run history co "event"
const t0=Date.now();while(Date.now()-t0<60000){const rows=await gw("listAgents",{});if(!rows.some(r=>r.id===id&&r.isRunning))break;await new Promise(r=>setTimeout(r,1500));}
const after=((await gw("getAgentTranscriptTail",{agentId:id}))?.entries??[]).length;
step("routine thuc su chay (transcript tang)", after>before, `${before} -> ${after}`);
const run=(await gw("getAgentAutomations",{id}))[0]?.runs?.[0];
step("run history ghi trigger 'event'", run?.trigger==="event", JSON.stringify(run));

// 5. context Slack co trong prompt gui cho agent
const firstUserMsg=((await gw("getAgentTranscriptTail",{agentId:id}))?.entries??[]).filter(e=>e.kind==="message").pop();
step("agent nhan context Slack (channel/thread)", /Slack|C123|thread_ts/.test(String(firstUserMsg?.content??"")), JSON.stringify(String(firstUserMsg?.content??"").slice(0,60)));

await gw("deleteAgents",{agentIds:[id]});
const ok=pass.filter(Boolean).length;console.log(`\n${ok}/${pass.length} PASS`);process.exit(ok===pass.length?0:1);
