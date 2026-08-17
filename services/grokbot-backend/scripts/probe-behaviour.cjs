/**
 * Did the prompt change the BEHAVIOUR, or only the text?
 *
 * Sends one input and reports what the turn actually did — which tools ran, how long the reply
 * is — instead of eyeballing the prose. Two chapters are on trial: the escalation ladder (85),
 * which should make the agent open a site rather than answer from memory, and reply length
 * (42-50), which should keep an ordinary answer short.
 */
const GW = "http://localhost:8788/gw/api";
const post = async (m, b) => (await fetch(`${GW}/${m}`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b),
})).json();

const CASES = [
  { tag: "website", text: "Đây là website của t https://cinai.tv/ kiểm cho t 1tr$ từ website này", wantTool: true },
  { tag: "ngan",    text: "Thu do cua Viet Nam ten la gi?", wantTool: false },
  { tag: "chao",    text: "chao ban", wantTool: false },
];

(async () => {
  for (const c of CASES) {
    const { agent } = await post("createAgent", { name: `B_${c.tag}` });
    const t0 = Date.now();
    await post("sendPrompt", { agentId: agent.id, content: c.text, clientNonce: `n${t0}` });
    let entries = [];
    for (let i = 0; i < 100; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      entries = (await post("getAgentTranscript", { id: agent.id, limit: 60 })).entries ?? [];
      const last = entries[entries.length - 1];
      const pending = entries.find((e) => e.message?.type === "local-tool-permission" && e.message.ask?.status === "pending");
      if (pending) break;
      if (last?.kind === "send-message" && last.message?.type === "text" && last.streaming === false && (last.message.content ?? "").length > 0) break;
    }
    const tools = entries.filter((e) => e.kind === "tool-call").map((e) => e.name);
    const reply = [...entries].reverse().find((e) => e.kind === "send-message" && e.message?.type === "text" && (e.message.content ?? "").length > 0)?.message.content ?? "";
    const lines = reply.split("\n").filter((l) => l.trim()).length;
    const headings = (reply.match(/^#{1,4}\s|\*\*[^*]+\*\*:/gm) ?? []).length;
    console.log(`── ${c.tag}  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    console.log(`   tools : ${tools.length ? tools.join(", ") : "(khong goi tool nao)"}   ${c.wantTool ? (tools.length ? "OK" : "<= MONG DOI CO TOOL") : (tools.length ? "(co tool)" : "OK")}`);
    console.log(`   reply : ${reply.length} ky tu · ${lines} dong · ${headings} tieu de/bullet dam`);
    console.log(`   dau   : ${reply.replace(/\s+/g, " ").slice(0, 110)}`);
  }
})();
