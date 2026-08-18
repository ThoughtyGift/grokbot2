/** Tang 1 GitHub, end to end with a FAKE webhook payload — no real GitHub needed. */
import fs from "node:fs";
const T=fs.readFileSync(".data/gateway-token.txt","utf8").trim();
const gw=async(m,a)=>{const r=await fetch("http://127.0.0.1:8788/gw/api/"+m,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${T}`},body:JSON.stringify(a||{})});return r.json();};
const gh=(event,b)=>fetch("http://127.0.0.1:8788/gw/github/events",{method:"POST",headers:{"content-type":"application/json","x-github-event":event},body:JSON.stringify(b)}).then(r=>r.json());
const pass=[];const step=(n,ok,d="")=>{pass.push(ok);console.log(`${ok?"PASS":"FAIL"}  ${n}${d?"  — "+d:""}`);};
// 1. ping handshake
const p=await gh("ping",{zen:"Keep it simple"});
step("ping handshake tra 200", p?.pong===true, JSON.stringify(p));
// 2. routine trigger github
const made=await gw("createAgent",{name:"gh-listener"}); const id=made?.agent?.id??made?.id;
await gw("createAgentAutomation",{id,spec:{name:"PR watcher",prompt:"Tom tat PR moi.",trigger:"github pr-opened"}});
const before=((await gw("getAgentTranscriptTail",{agentId:id}))?.entries??[]).length;
// 3. pull_request opened -> routine chay
const ev=await gh("pull_request",{action:"opened",repository:{full_name:"cinai/web"},sender:{login:"khanhduy"},pull_request:{number:42,title:"Add feature",html_url:"https://github.com/cinai/web/pull/42"}});
step("PR opened danh thuc routine", ev?.fired>=1, `kind=${ev?.kind} fired=${ev?.fired}`);
const t0=Date.now();while(Date.now()-t0<60000){const rows=await gw("listAgents",{});if(!rows.some(r=>r.id===id&&r.isRunning))break;await new Promise(r=>setTimeout(r,1500));}
const after=((await gw("getAgentTranscriptTail",{agentId:id}))?.entries??[]).length;
step("routine chay that (transcript tang)", after>before, `${before} -> ${after}`);
const run=(await gw("getAgentAutomations",{id}))[0]?.runs?.[0];
step("run history ghi trigger 'event'", run?.trigger==="event", JSON.stringify(run?.trigger));
const firstMsg=((await gw("getAgentTranscriptTail",{agentId:id}))?.entries??[]).filter(e=>e.kind==="message").pop();
step("agent nhan context GitHub (repo/PR)", /GitHub|cinai\/web|#42/.test(String(firstMsg?.content??"")), JSON.stringify(String(firstMsg?.content??"").slice(0,50)));
await gw("deleteAgents",{agentIds:[id]});
const ok=pass.filter(Boolean).length;console.log(`\n${ok}/${pass.length} PASS`);process.exit(ok===pass.length?0:1);
