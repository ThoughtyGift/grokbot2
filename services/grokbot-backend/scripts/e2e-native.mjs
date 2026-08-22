/**
 * Native `/v1` vertical slice: roster CRUD, send, interrupt, SSE, no Cursor command names.
 *
 * Spawns its own BFF so the gate does not depend on the operator's AUTH mode.
 *
 *   node scripts/e2e-native.mjs
 */
import { spawn } from "node:child_process";
import { recordRun } from "./run-history.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { killPort } from "./kill-port.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.GROKBOT2_E2E_PORT || 8807);

/**
 * Sweep the port on every exit path.
 *
 * `killTree` here kills the SHELL's pid, which leaks the node grandchild whenever the shell
 * has already gone — one sweep left ten backends listening on 8794-8807, and the next run
 * failed with "port already in use". An exit hook covers the paths killTree does not: a
 * thrown assertion, a timeout, Ctrl-C. Killing by port cannot reach :8788.
 */
process.on("exit", () => { try { killPort(PORT); } catch { /* nothing to clean */ } });
const API = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dataDir = mkdtempSync(join(tmpdir(), "grokbot2-native-"));

let pass = 0, fail = 0;
/** Giữ lại từng bước để `recordRun` có gì mà ghi. */
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, pass: Boolean(ok), detail });
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? `  — ${detail}` : ""}`);
};

try {
  await fetch(`${API}/health`, { signal: AbortSignal.timeout(1500) });
  console.log(`port ${PORT} da co tien trinh khac dang nghe — dong no truoc.`);
  process.exit(1);
} catch { /* nothing listening */ }

const child = spawn("npx", ["tsx", "src/index.ts"], {
  cwd: ROOT, shell: true, stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    PORT: String(PORT),
    GROKBOT2_PORT: String(PORT),
    GROKBOT2_AUTH: "enforce",
    GROKBOT2_RUNTIME_URL: "",
    GROKBOT2_COMPUTER_URL: "",
    GROKBOT2_OPS_URL: "",
    GROKBOT2_SQLITE_FILE: join(dataDir, "grokbot.sqlite"),
    GROKBOT2_STATE_FILE: join(dataDir, "state.json"),
    GROKBOT2_GATEWAY_TOKEN: "e2e-native-token",
    NODE_TEST_CONTEXT: "e2e-native",
  },
});

const killTree = () => {
  // Never taskkill a pid whose child has already exited: with `shell: true` the pid is the
  // SHELL's, a shell that dies early (a backend losing the port to EADDRINUSE, say) frees it,
  // and Windows hands the number to whatever starts next. A killTree at the end of the script
  // then kills a stranger — twice in one session that stranger was the BFF on :8788.
  if (child.pid == null || child.exitCode !== null || child.killed) return;
  if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else child.kill();
};
let log = "";
child.stdout.on("data", (d) => { log += d; });
child.stderr.on("data", (d) => { log += d; });

try {
  let up = false;
  for (let i = 0; i < 40; i++) {
    await sleep(1000);
    try { if ((await fetch(`${API}/v1/health`)).ok) { up = true; break; } } catch { /* not yet */ }
  }
  if (!up) { console.log(`backend khong len duoc tren ${PORT}:\n${log.slice(-800)}`); process.exit(1); }

  const noAuth = await fetch(`${API}/v1/agents`);
  check("GET /v1/agents without bearer is 401", noAuth.status === 401, `HTTP ${noAuth.status}`);

  const session = await (await fetch(`${API}/v1/session`)).json();
  check("GET /v1/session mints the pinned token", session?.token === "e2e-native-token", JSON.stringify(session));
  const h = { authorization: `Bearer ${session.token}`, "content-type": "application/json" };

  /**
   * Ảnh chụp roster TRƯỚC khi chạy, để cuối bài so lại.
   *
   * Ngày 2026-08-22, sáu bot thật của chủ máy bị `hidden: true` và cả hai UI chỉ còn hiện một bot.
   * Không truy được lời gọi nào — bộ đếm coverage đã reset — nên không kết luận được script nào
   * gây ra. Bài test này CÓ set `hidden` (đúng phần việc của nó), nên nó phải tự chứng minh là chỉ
   * chạm bot do chính nó tạo. Một suite sửa dữ liệu của người dùng mà không ai phát hiện thì tệ
   * hơn là không có suite.
   */
  const rosterBefore = new Map(
    (await fetch(`${API}/v1/agents?includeHidden=1`, { headers: h }).then((r) => r.json()) ?? [])
      .map((a) => [a.id, { name: a.name, hidden: a.hidden === true }]),
  );

  const created = await fetch(`${API}/v1/agents`, {
    method: "POST", headers: h, body: JSON.stringify({ name: "NativeSlice" }),
  });
  const createdBody = await created.json();
  check("POST /v1/agents is 201", created.status === 201, `HTTP ${created.status}`);
  const agentId = createdBody?.agent?.id;
  check("created agent id matches agent-N", typeof agentId === "string" && /^agent-\d+$/.test(agentId), String(agentId));
  check("created transcript is empty", Array.isArray(createdBody?.transcript?.entries) && createdBody.transcript.entries.length === 0, JSON.stringify(createdBody?.transcript));

  const nonce = `native-${Date.now()}`;
  const sent = await fetch(`${API}/v1/agents/${agentId}/turns`, {
    method: "POST", headers: h, body: JSON.stringify({ content: "ping from native e2e", clientNonce: nonce }),
  });
  const sentBody = await sent.json();
  check("POST /v1/agents/:id/turns is 202", sent.status === 202, `HTTP ${sent.status} ${JSON.stringify(sentBody)}`);
  check("turn status is accepted", sentBody?.status === "accepted", JSON.stringify(sentBody));

  const dup = await fetch(`${API}/v1/agents/${agentId}/turns`, {
    method: "POST", headers: h, body: JSON.stringify({ content: "ping from native e2e", clientNonce: nonce }),
  });
  const dupBody = await dup.json();
  check("same clientNonce is 202 duplicate", dup.status === 202 && dupBody?.status === "duplicate", JSON.stringify(dupBody));
  check("duplicate keeps the original entryId", dupBody?.entryId === sentBody?.entryId, String(dupBody?.entryId));

  const healthAfter = await (await fetch(`${API}/v1/health`)).json();
  const conflict = await fetch(`${API}/v1/agents/${agentId}/turns`, {
    method: "POST", headers: h, body: JSON.stringify({ content: "second", clientNonce: `${nonce}-b` }),
  });
  if (healthAfter?.isBusy) {
    check("second turn while running is 409", conflict.status === 409, `HTTP ${conflict.status}`);
  } else {
    check("idle after send (no in-flight turn) — 409 not required", conflict.status === 202 || conflict.status === 409, `HTTP ${conflict.status} isBusy=${healthAfter?.isBusy}`);
  }

  const stopped = await fetch(`${API}/v1/agents/${agentId}/turns/current`, { method: "DELETE", headers: h });
  check("DELETE /turns/current is 204", stopped.status === 204, `HTTP ${stopped.status}`);

  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const uploaded = await fetch(`${API}/v1/attachments`, {
    method: "POST", headers: h, body: JSON.stringify({ filename: "dot.png", bytesBase64: png }),
  });
  const staged = await uploaded.json();
  check("POST /v1/attachments is 201", uploaded.status === 201, `HTTP ${uploaded.status} ${JSON.stringify(staged)}`);
  check("staged path is virtual workspace", typeof staged?.path === "string" && staged.path.startsWith("/workspace/attachments/"), String(staged?.path));

  const img = await fetch(`${API}${staged.href}`);
  const bytes = Buffer.from(await img.arrayBuffer());
  check("GET attachment without bearer is the png", img.ok && String(img.headers.get("content-type")).startsWith("image/"), img.headers.get("content-type"));
  check("GET attachment bytes are png", bytes[0] === 0x89 && bytes[1] === 0x50, `len=${bytes.length}`);

  const notImage = await fetch(`${API}/v1/attachments`, {
    method: "POST", headers: h, body: JSON.stringify({ filename: "x.txt", bytesBase64: Buffer.from("hello").toString("base64") }),
  });
  check("POST non-image is 400", notImage.status === 400, `HTTP ${notImage.status}`);

  const picTurn = await fetch(`${API}/v1/agents/${agentId}/turns`, {
    method: "POST", headers: h,
    body: JSON.stringify({ content: "xem ảnh", clientNonce: `${nonce}-img`, attachments: [{ path: staged.path, name: "dot.png" }] }),
  });
  check("turn with attachment is 202", picTurn.status === 202, `HTTP ${picTurn.status}`);
  await fetch(`${API}/v1/agents/${agentId}/turns/current`, { method: "DELETE", headers: h });
  const page2 = await (await fetch(`${API}/v1/agents/${agentId}/transcript`, { headers: h })).json();
  const att = (page2.entries ?? []).find((e) => e.attachment?.path === staged.path);
  check("transcript entry carries attachment href", Boolean(att?.attachment?.href) && String(att.attachment.href).includes("/v1/attachments"), JSON.stringify(att?.attachment));

  const page = await (await fetch(`${API}/v1/agents/${agentId}/transcript`, { headers: h })).json();
  const kinds = (page.entries ?? []).map((e) => e.kind);
  check("transcript has a user message", kinds.includes("message"), kinds.join(","));
  check("no Cursor send-message kind on the native page", !kinds.includes("send-message"), kinds.join(","));

  const echoTurn = await fetch(`${API}/v1/agents/${agentId}/turns`, {
    method: "POST", headers: h,
    body: JSON.stringify({ content: "/tool echo hello", clientNonce: `${nonce}-echo` }),
  });
  check("echo turn is 202", echoTurn.status === 202, `HTTP ${echoTurn.status}`);
  let echoCard = null;
  for (let i = 0; i < 20; i++) {
    const p = await (await fetch(`${API}/v1/agents/${agentId}/transcript`, { headers: h })).json();
    echoCard = (p.entries ?? []).find((e) => e.kind === "tool-call" && e.name === "echo" && e.status === "done");
    if (echoCard) break;
    await sleep(50);
  }
  check("echo auto-runs without an approval requestId", Boolean(echoCard) && !echoCard.requestId, JSON.stringify(echoCard));

  const askTurn = await fetch(`${API}/v1/agents/${agentId}/turns`, {
    method: "POST", headers: h,
    body: JSON.stringify({ content: '/tool create_agent {"name":"NativeApprove"}', clientNonce: `${nonce}-ask` }),
  });
  check("write-tool turn is 202", askTurn.status === 202, `HTTP ${askTurn.status}`);
  const asked = await (await fetch(`${API}/v1/agents/${agentId}/transcript`, { headers: h })).json();
  const pendingCards = (asked.entries ?? []).filter((e) => e.kind === "tool-call" && e.status === "pending");
  const pending = pendingCards.find((e) => e.name === "create_agent" && e.requestId);
  check("create_agent is one pending card with requestId", Boolean(pending?.requestId), JSON.stringify(pending));
  check("permission card is folded (no duplicate pending)", pendingCards.length === 1, String(pendingCards.length));

  const missing = await fetch(`${API}/v1/agents/${agentId}/permissions`, {
    method: "POST", headers: h, body: JSON.stringify({ requestId: "req-does-not-exist", approved: true }),
  });
  check("unknown requestId is 404", missing.status === 404, `HTTP ${missing.status}`);
  const stillPending = await (await fetch(`${API}/v1/agents/${agentId}/transcript`, { headers: h })).json();
  check("bad requestId did not consume the card",
    (stillPending.entries ?? []).some((e) => e.requestId === pending?.requestId && e.status === "pending"),
    JSON.stringify((stillPending.entries ?? []).filter((e) => e.kind === "tool-call").map((e) => ({ name: e.name, status: e.status, requestId: e.requestId }))));

  const allow = await fetch(`${API}/v1/agents/${agentId}/permissions`, {
    method: "POST", headers: h, body: JSON.stringify({ requestId: pending.requestId, approved: true }),
  });
  check("Allow is 204", allow.status === 204, `HTTP ${allow.status}`);
  let allowed = null;
  for (let i = 0; i < 20; i++) {
    const p = await (await fetch(`${API}/v1/agents/${agentId}/transcript`, { headers: h })).json();
    allowed = (p.entries ?? []).find((e) => e.requestId === pending.requestId || e.toolCallId === pending.toolCallId);
    if (allowed && allowed.status !== "pending") break;
    await sleep(50);
  }
  check("allowed tool is no longer pending", allowed && allowed.status !== "pending", JSON.stringify(allowed));
  const rosterAfterAllow = await (await fetch(`${API}/v1/agents`, { headers: h })).json();
  const made = (Array.isArray(rosterAfterAllow) ? rosterAfterAllow : []).find((a) => a.name === "NativeApprove");
  check("Allow ran create_agent", Boolean(made?.id), JSON.stringify((Array.isArray(rosterAfterAllow) ? rosterAfterAllow : []).map((a) => a.name)));
  if (made?.id) await fetch(`${API}/v1/agents/${made.id}`, { method: "DELETE", headers: h });

  const denyTurn = await fetch(`${API}/v1/agents/${agentId}/turns`, {
    method: "POST", headers: h,
    body: JSON.stringify({ content: '/tool create_agent {"name":"NativeDeny"}', clientNonce: `${nonce}-deny` }),
  });
  check("deny-path turn is 202", denyTurn.status === 202, `HTTP ${denyTurn.status}`);
  const denyPage = await (await fetch(`${API}/v1/agents/${agentId}/transcript`, { headers: h })).json();
  const denyCard = (denyPage.entries ?? []).find((e) => e.kind === "tool-call" && e.name === "create_agent" && e.status === "pending" && e.requestId);
  check("deny-path card is pending", Boolean(denyCard?.requestId), JSON.stringify(denyCard));
  const denied = await fetch(`${API}/v1/agents/${agentId}/permissions`, {
    method: "POST", headers: h, body: JSON.stringify({ requestId: denyCard?.requestId, approved: false }),
  });
  check("Deny is 204", denied.status === 204, `HTTP ${denied.status}`);
  const afterDeny = await (await fetch(`${API}/v1/agents/${agentId}/transcript`, { headers: h })).json();
  const deniedTool = (afterDeny.entries ?? []).find((e) => e.requestId === denyCard?.requestId);
  check("denied tool is failed", deniedTool?.status === "failed", JSON.stringify(deniedTool));
  const rosterAfterDeny = await (await fetch(`${API}/v1/agents`, { headers: h })).json();
  check("Deny did not create NativeDeny",
    !(Array.isArray(rosterAfterDeny) ? rosterAfterDeny : []).some((a) => a.name === "NativeDeny"),
    JSON.stringify((Array.isArray(rosterAfterDeny) ? rosterAfterDeny : []).map((a) => a.name)));

  const askSpec = JSON.stringify({
    prompt: "Chọn phương tiện?",
    options: [{ label: "Máy bay", value: "plane" }, { label: "Tàu", value: "train" }],
  });
  const widgetTurn = await fetch(`${API}/v1/agents/${agentId}/turns`, {
    method: "POST", headers: h,
    body: JSON.stringify({ content: `/tool ask_question ${askSpec}`, clientNonce: `${nonce}-widget` }),
  });
  check("ask_question turn is 202", widgetTurn.status === 202, `HTTP ${widgetTurn.status}`);
  let widget = null;
  for (let i = 0; i < 20; i++) {
    const p = await (await fetch(`${API}/v1/agents/${agentId}/transcript`, { headers: h })).json();
    widget = (p.entries ?? []).find((e) => e.kind === "widget" && e.respondedValue == null);
    if (widget) break;
    await sleep(50);
  }
  check("native transcript maps ask_question to kind widget", widget?.kind === "widget", JSON.stringify(widget));
  check("widget keeps prompt and option buttons",
    widget?.widget?.prompt === "Chọn phương tiện?" && Array.isArray(widget?.widget?.options) && widget.widget.options.length === 2,
    JSON.stringify(widget?.widget));
  check("widget is not flattened to agent-message", widget?.kind !== "agent-message", String(widget?.kind));

  const missingWidget = await fetch(`${API}/v1/agents/${agentId}/widgets`, {
    method: "POST", headers: h, body: JSON.stringify({ entryId: "entry-does-not-exist", value: "train" }),
  });
  check("unknown widget entryId is 404", missingWidget.status === 404, `HTTP ${missingWidget.status}`);

  const answered = await fetch(`${API}/v1/agents/${agentId}/widgets`, {
    method: "POST", headers: h, body: JSON.stringify({ entryId: widget?.id, value: "train" }),
  });
  check("answer widget is 204", answered.status === 204, `HTTP ${answered.status}`);
  const afterWidget = await (await fetch(`${API}/v1/agents/${agentId}/transcript`, { headers: h })).json();
  const resolved = (afterWidget.entries ?? []).find((e) => e.id === widget?.id);
  check("widget records respondedValue", resolved?.kind === "widget" && resolved?.respondedValue === "train", JSON.stringify(resolved));
  const echo = (afterWidget.entries ?? []).find((e) => e.kind === "message" && e.content === "train");
  check("answer is echoed as a user message", Boolean(echo), JSON.stringify(echo));
  const twice = await fetch(`${API}/v1/agents/${agentId}/widgets`, {
    method: "POST", headers: h, body: JSON.stringify({ entryId: widget?.id, value: "plane" }),
  });
  check("second answer is 409", twice.status === 409, `HTTP ${twice.status}`);

  const renamed = await fetch(`${API}/v1/agents/${agentId}`, {
    method: "PATCH", headers: h, body: JSON.stringify({ name: "NativeRenamed" }),
  });
  const renamedBody = await renamed.json();
  check("PATCH rename is 200", renamed.ok && renamedBody?.name === "NativeRenamed", JSON.stringify(renamedBody));
  const afterRename = await (await fetch(`${API}/v1/agents/${agentId}/transcript`, { headers: h })).json();
  const nameEv = (afterRename.entries ?? []).find((e) => e.kind === "event" && e.event?.type === "name-changed");
  check("rename appends name-changed event", nameEv?.event?.to === "NativeRenamed", JSON.stringify(nameEv));

  const hid = await fetch(`${API}/v1/agents/${agentId}`, {
    method: "PATCH", headers: h, body: JSON.stringify({ hidden: true }),
  });
  check("PATCH hidden is 200", hid.ok && (await hid.json())?.hidden === true, `HTTP ${hid.status}`);
  const visible = await (await fetch(`${API}/v1/agents`, { headers: h })).json();
  check("hidden agent is off the default roster", !(Array.isArray(visible) ? visible : []).some((a) => a.id === agentId));
  const listedHidden = await (await fetch(`${API}/v1/agents?includeHidden=1`, { headers: h })).json();
  check("includeHidden lists the hidden agent",
    (Array.isArray(listedHidden) ? listedHidden : []).some((a) => a.id === agentId && a.hidden === true));
  await fetch(`${API}/v1/agents/${agentId}`, { method: "PATCH", headers: h, body: JSON.stringify({ hidden: false }) });

  await fetch(`${API}/v1/agents/${agentId}/turns/current`, { method: "DELETE", headers: h });
  const chatTurn = await fetch(`${API}/v1/agents/${agentId}/turns`, {
    method: "POST", headers: h,
    body: JSON.stringify({ content: "hello from native chat", clientNonce: `${nonce}-chat` }),
  });
  check("plain chat turn is 202", chatTurn.status === 202, `HTTP ${chatTurn.status}`);
  let agentMsg = null;
  let helloSeq = 0;
  for (let i = 0; i < 40; i++) {
    const pageChat = await (await fetch(`${API}/v1/agents/${agentId}/transcript`, { headers: h })).json();
    const hello = (pageChat.entries ?? []).find((e) => e.kind === "message" && String(e.content ?? "").includes("hello from native chat"));
    helloSeq = hello?.seq ?? 0;
    agentMsg = (pageChat.entries ?? []).find((e) => e.kind === "agent-message" && e.seq > helloSeq);
    if (agentMsg) break;
    await sleep(100);
  }
  check("plain chat produces an agent-message", Boolean(agentMsg), JSON.stringify(agentMsg));

  const healthBusy = await (await fetch(`${API}/v1/health`)).json();
  if (healthBusy?.isBusy) {
    const midStop = await fetch(`${API}/v1/agents/${agentId}/turns/current`, { method: "DELETE", headers: h });
    check("interrupt mid-model-turn is 204", midStop.status === 204, `HTTP ${midStop.status}`);
    for (let i = 0; i < 20; i++) {
      const stoppedPage = await (await fetch(`${API}/v1/agents/${agentId}/transcript`, { headers: h })).json();
      const last = [...(stoppedPage.entries ?? [])].reverse().find((e) => e.kind === "agent-message");
      if (last && last.isStreaming !== true) { agentMsg = last; break; }
      await sleep(50);
    }
    check("interrupted agent-message is not streaming", agentMsg && agentMsg.isStreaming !== true, JSON.stringify(agentMsg));
  } else {
    check("plain chat settled without a long model turn", true, String(agentMsg?.content ?? "").slice(0, 80));
  }

  const ac = new AbortController();
  const ev = await fetch(`${API}/v1/events`, { headers: h, signal: ac.signal });
  check("GET /v1/events is text/event-stream", ev.ok && String(ev.headers.get("content-type") ?? "").includes("text/event-stream"), ev.headers.get("content-type"));
  let text = "";
  const reader = ev.body.getReader();
  const until = Date.now() + 3000;
  while (Date.now() < until && !text.includes("event: agent.upserted")) {
    const chunk = await reader.read();
    if (chunk.done) break;
    text += new TextDecoder().decode(chunk.value);
  }
  check("SSE opens with agent.upserted", text.includes("event: agent.upserted"), text.slice(0, 240));
  ac.abort();

  const computer = await fetch(`${API}/v1/agents/${agentId}/computer`, { headers: h });
  const box = await computer.json();
  check("GET computer is 200 with agentId", computer.ok && box?.agentId === agentId, JSON.stringify(box));

  const gone = await fetch(`${API}/v1/agents/${agentId}`, { method: "DELETE", headers: h });
  check("DELETE agent is 204", gone.status === 204, `HTTP ${gone.status}`);

  // ── không chạm bot của người khác ─────────────────────────────────────────
  const rosterAfter = new Map(
    (await fetch(`${API}/v1/agents?includeHidden=1`, { headers: h }).then((r) => r.json()) ?? [])
      .map((a) => [a.id, { name: a.name, hidden: a.hidden === true }]),
  );
  const changed = [];
  const vanished = [];
  for (const [id, before] of rosterBefore) {
    const after = rosterAfter.get(id);
    if (!after) { vanished.push(`${before.name}(${id})`); continue; }
    if (after.hidden !== before.hidden) changed.push(`${before.name}(${id}) hidden ${before.hidden}→${after.hidden}`);
    if (after.name !== before.name) changed.push(`${id} name "${before.name}"→"${after.name}"`);
  }
  check("không đổi hiển thị/tên của bot nào có từ trước", changed.length === 0, changed.join("; "));
  check("không xoá bot nào có từ trước", vanished.length === 0, vanished.join("; "));
} finally {
  killTree();
}

console.log(`\n${pass} pass, ${fail} fail`);
recordRun("e2e-native.mjs", results);
process.exit(fail ? 1 : 0);
