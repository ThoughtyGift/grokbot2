// Read our own event stream and show what a client would receive.
const res = await fetch("http://127.0.0.1:8788/gw/events", { headers: { accept: "text/event-stream" } });
const reader = res.body.getReader();
const dec = new TextDecoder();
setTimeout(async () => {
  await fetch("http://127.0.0.1:8788/gw/api/sendPrompt", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ agentId: "agent-35", content: "nói: OK" }),
  });
}, 800);
const t0 = Date.now();
while (Date.now() - t0 < 20000) {
  const { value, done } = await reader.read();
  if (done) break;
  for (const line of dec.decode(value).split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const j = JSON.parse(line.slice(6));
    if (j.kind === "ready") continue;
    console.log(JSON.stringify({ kind: j.kind, ordered: j.ordered, eventType: j.event?.type, entryId: j.event?.entry?.id, entrySeq: j.event?.entry?.seq }));
  }
}
process.exit(0);
