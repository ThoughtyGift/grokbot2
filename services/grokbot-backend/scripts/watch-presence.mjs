import fs from "node:fs";
const T=fs.readFileSync(".data/gateway-token.txt","utf8").trim();
const res=await fetch("http://127.0.0.1:8788/gw/events",{headers:{authorization:"Bearer "+T}});
const reader=res.body.getReader(); const dec=new TextDecoder(); let buf="";
process.stdout.write("watching presence/roster events...\n");
for(;;){const{done,value}=await reader.read();if(done)break;buf+=dec.decode(value,{stream:true});
  for(const line of buf.split("\n")){if(!line.startsWith("data:"))continue;
    try{const j=JSON.parse(line.slice(5).trim());
      if(j.channel==="agent-upserted"){const a=j.payload?.agent;process.stdout.write(`agent-upserted ${a?.id} isRunning=${a?.isRunning} composing=${a?.isComposingMessage} activity=${JSON.stringify(a?.currentActivity??null)}\n`);}
      else if(j.channel==="agents"){process.stdout.write(`agents-list n=${(j.payload?.agents||[]).length}\n`);}
    }catch{}}
  buf=buf.slice(buf.lastIndexOf("\n")+1);}
