> **ARCHIVED.** Đây là bản roadmap trước lần đổi hướng 2026-08-20, viết bằng tiếng Anh, đo theo `parity.md`. Bản đang có hiệu lực là [`ROADMAP.md`](../../ROADMAP.md) ở gốc repo. Giữ lại vì phần "Status here is measured" là nguồn của kỷ luật đo hiện tại.

# Roadmap

Status here is **measured**, not remembered: each line says how it was checked. The detailed
evidence for every parity claim lives in [`parity.md`](../parity.md).

## Done

**Foundation** — redirect seam + auth stub · ConnectRPC bootstrap gates · box gateway + SSE ·
chat bridge to the Claude pool.

**Chat and roster** — roster mutations (rename / delete / duplicate / unread / hide) ·
`interruptAgentRun` · reactions · conversation outline · multi-turn context · real token
streaming (`streamPool` over `/v1/chat/completions` with `stream:true`, used by `chat.ts`) ·
`setHostSettings` merges partial patches and persists.

**Tools — 28 of the original's 54** (`scripts/tool-coverage.mjs` via `tool-registry.mts`; floor in [`parity-runs/fe-goc-baseline.json`](../parity-runs/fe-goc-baseline.json)). The older “24 of 54” / `parity-report` “9/54” figures were the same live map counted three different ways — F0 collapsed them.
Shell and files (`run_terminal_command_v2`, `read_file_v2`, `edit_file_v2`, `edit_file`,
`delete_file`, `list_dir_v2`, `glob_file_search`, `ripgrep_raw_search`) · `web_search` /
`web_fetch` · `task_v2` subagents · MCP (`get_mcp_tools`, `call_mcp_tool`) · `ask_question` ·
`todo_read` / `todo_write` / `create_plan` · `knowledge_base` · plus 16 `browser_*` actions,
`message_agent`, `create_agent`, `rename_agent`, `attach_file`, `request_box_help`, drafts.
Multi-step: one user message may run up to 8 tools (`MAX_TOOL_STEPS`).

**The box** — Xvfb + xfwm4 + compositor + dock + terminal + file manager + Chrome, all under
systemd as the unprivileged user `box`; exec daemon deployed with `write` / `replace` /
`remove` / `readBytes`; sandbox holds over the public route (14/14 in `test-real-box.mjs`,
including escape attempts). Browser drives the box's own Chrome over an SSH tunnel, one tab per
bot.

**Transcript surfaces** — attachments (images and plain files, with `readAttachmentText` /
`readAttachmentChunk`) · the ask_question widget · email/Slack draft cards · the inline
`Computer` handoff card (`boxRequestId` / `boxInstruction` / `boxResolution`) · agent-to-agent
messages, including fan-out · sidebar rows with time and last-message preview.

**System prompt** — 79 of 179 chapters (~7.2k tokens), ported not copied. Indices re-verified
against a fresh extraction of the current bundle (identical, segment for segment);
`check-prompt.mjs` passes all five decoder gates; `audit-keep.mjs` prints every chapter kept and
dropped so the selection can be judged.

## Next

### 1. ~~Roster live-update~~ — DONE
We were broadcasting on `channel: "roster"`, which is not one of the sixteen channels the
coordinator accepts; it dropped every frame silently before the renderer saw it. Renamed to
`agent-upserted` / `agents` (parity.md §2w). Measured: a new bot appears in ~1.5s without a
reload, and the avatar animates during a turn.

**Follow-up from the same discovery.** ~~We use 2 of the 16 pushable channels.~~ Three now:
`forever-box` pushes computer-pane status on transitions instead of leaving it to the client's
poll (parity.md §2ad, `scripts/e2e-box-push.mjs` 9/9). Remaining and unpushed: `subagents`,
`outline`, `automations`, `host-settings`, `tray`.

**Closed while wiring that:** `ensureForeverBox` started a computer session with nothing to end
it — only the end of a *turn* armed the release, and opening a pane is not a turn. It now arms
the release at the same moment. Answering `off` instead would have been wrong: the client's
placeholder spins for ever on an ensure that reports off (parity.md §2ad).

### 2. ~~Per-bot computer pane~~ — DONE
Scoped to a running `computerUse` subagent, the way the original does it (parity.md §2z).
Verified in the app: a browsing bot shows `webview=1` / "Surfer's screen", an idle bot shows no
pane. Remaining and separate: one X display still means one picture, so two bots browsing at the
same moment see the same desktop. Giving each its own would need an Xvfb + x11vnc per bot.

### 3. Agent exchange viewer — the unknown was a wrong assumption, not a missing method
The blocker here was "find the gateway method that loads `tunnelEntries`". There is none, and
that is why no name in the 85-method table matched. Read off the bundle:

```js
le = useMemo(() => v == null ? [] : v.isGroup ? O : Uan(u, v.id, self), [v, u, O, t])
//                                              ^ u = the transcript ALREADY on screen
function Uan(entries, peerId, self) {          // pure filter, no I/O
  for (const r of entries) {
    if (r.kind !== "message") continue;                       // not "send-message"
    if (r.toAgent?.id !== peerId && r.fromAgent?.id !== peerId) continue;
    out.push({ kind: "send-message", id: r.id, author: r.toAgent ? self : r.fromAgent,
               message: { type: "text", content: r.content }, timestampMs: r.timestampMs });
  }
}
```

For a 1:1 peer the pane is a client-side filter over entries the app already holds. Only the
group case loads anything, and it loads through the ordinary transcript store —
`PBe(id) → $Mt(id) → transcript.load(id)` — the same path the main chat uses, which we already
serve. So the contract is entirely a *shape* obligation on our entries, and `messageAgent`
already meets it: outbound `{kind:"message", role:"assistant", content, toAgent:{id,name}}`,
inbound `{kind:"message", role:"user", content, fromAgent:{id,name}}` written by `sendPrompt`.

`scripts/e2e-exchange.mjs` asserts the shape by re-implementing `Uan` against a real exchange
(4/4).

**Still open, and now with a sharper question.** The click no longer needs a human —
`element.click()` drives this app fine (`Input.dispatchMouseEvent` never did) — but there is
nothing to click: `scripts/e2e-remaining.mjs` opens the sender's conversation and finds no
`[aria-label^="Open exchange with"]` chip and no "Messaged" marker anywhere on screen. The
messages render as ordinary bubbles instead.

Every client gate our entries must pass, they pass on paper:

```js
VIn(entry) = entry.kind === "message" && fm(entry)
fm(n)      = n.kind === "message" && (n.fromAgent != null || n.toAgent != null)
Rde(n)     = n.toAgent != null && n.toAgent.kind !== "agent"   // exclusion; we send kind:"agent"
```

and `messageAgent` writes `{kind:"message", role:"assistant", content, toAgent:{id,name,kind:"agent"}}`.
So something downstream of `KIn`/`YWn` rejects them for a reason not yet found — do NOT guess it.
The next step is to find where an entry list becomes rows and see which branch ours takes,
rather than adding fields speculatively.

### 4. ~~Images from a URL~~ — DONE
`attach_image({url, alt})` downloads and stages the bytes, the only thing that works: the
client refuses third-party image URLs (parity.md §2u). `imageSize()` grew from PNG-only to
PNG · JPEG · GIF · WebP, mime and extension are read from the bytes rather than the caller, and
the fetch is fenced against internal addresses because the URL comes from the model. Measured
14/14 in `scripts/e2e-attach-image.mjs`, plus a live turn that attached two Wikipedia photos
with zero markdown links.

The batch form is in too: `{"urls":[…]}` attaches up to 8 in ONE tool step, so a request for
several images cannot eat the whole `MAX_TOOL_STEPS` budget. Fetched in order rather than in
parallel, so the transcript matches what was asked for; the internal-address fence still applies
per URL, asserted with a batch that mixes good URLs and `127.0.0.1:9223` (17/17).

### 5. Smaller, known-shaped
- `getAsyncTasks` returns `[]`; its content is background shells and cloud agents, which this
  backend does not have.
- `ingestSubagentsEvent({parentAgentId, subagents})` — the subagent list updates only on poll.
- ~~Three e2e scripts die on the port.~~ Not the port — they already guarded it and killed the
  tree. Two real causes: the gateway now runs `GROKBOT2_AUTH=enforce`, so their unauthenticated
  calls got 401 and the script died on `undefined.id` a line later (they send `gwHeaders()` now;
  the spawned backend reuses the saved token rather than minting one, so nothing is clobbered);
  and `e2e-memory` guarded on `GROKBOT2_BOX_EXEC_URL` in its OWN process, which a plain `node`
  shell never has — it reads the repo-root `.env` itself now. Also fixed one ruler: the
  ask_question test regex-matched the machine value (`tau_hoa`) against a natural-language reply,
  so it could only pass if the model parroted an internal id. Now: 17/17 · 6/6 · 7/7.

## Not worth doing
- **Channels / listeners.** The original ships exactly two connector manifests, Discord and
  Slack, both `availability: "coming-soon"` with an empty `connectGuide`. Nothing to connect.
- **Draft send.** `onSend` and `onDiscard` are empty functions in the shipped client; the card
  renders and the buttons do nothing. Ours matches by doing the same.
- **The Cursor IDE tools** (14 of the 30 missing) — `semantic_search_full`, `go_to_definition`,
  `fix_lints`, `fetch_pull_request` and friends. There is no code workspace to point them at.

## Management
- [ ] Expose backend health/config to the OpenClaw `admin-dashboard` (a "Grok Bot" tab).
- [ ] Per-box lifecycle (create/stop/status) reusing the dashboard's account model.
