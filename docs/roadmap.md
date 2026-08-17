# Roadmap

Status here is **measured**, not remembered: each line says how it was checked. The detailed
evidence for every parity claim lives in [`parity.md`](./parity.md).

## Done

**Foundation** — redirect seam + auth stub · ConnectRPC bootstrap gates · box gateway + SSE ·
chat bridge to the Claude pool.

**Chat and roster** — roster mutations (rename / delete / duplicate / unread / hide) ·
`interruptAgentRun` · reactions · conversation outline · multi-turn context · real token
streaming (`streamPool` over `/v1/chat/completions` with `stream:true`, used by `chat.ts`) ·
`setHostSettings` merges partial patches and persists.

**Tools — 24 of the original's 54** (`scripts/tool-coverage.mjs`, read off the live tool map).
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

**Follow-up from the same discovery.** We use 2 of the 16 pushable channels. `forever-box` is
the valuable next one — it would push computer-pane status instead of waiting for the client's
poll, which is the lag behind "the Computer button takes a while to appear". Then `subagents`,
`outline`, `automations`, `host-settings`, `tray`.

### 2. ~~Per-bot computer pane~~ — DONE
Scoped to a running `computerUse` subagent, the way the original does it (parity.md §2z).
Verified in the app: a browsing bot shows `webview=1` / "Surfer's screen", an idle bot shows no
pane. Remaining and separate: one X display still means one picture, so two bots browsing at the
same moment see the same desktop. Giving each its own would need an Xvfb + x11vnc per bot.

### 3. Agent exchange viewer
Clicking a `Messaged X` marker in the original opens a read-only pane of the two bots'
conversation (`openAgentExchange`, `tunnelPeer` / `tunnelEntries`, "This chat is view-only").
The entries we already emit are the right data. The unknown is the method that loads
`tunnelEntries` — no name in the client's 85-method table matches, so it needs a
click-and-read-the-log pass on the original, the way `respondToWidget` was pinned. **Do not
guess it.**

### 4. Images from a URL
Remote image URLs do not render — the client fetches nothing from third-party hosts
("Couldn't load image"), which is why the original always attaches bytes. To show images found
on a page we must download and stage them; `stageImage()` measures PNG only, so JPEG sizing
comes first or the renderer gets no width/height and draws a blank frame.

### 5. Smaller, known-shaped
- `getAsyncTasks` returns `[]`; its content is background shells and cloud agents, which this
  backend does not have.
- `ingestSubagentsEvent({parentAgentId, subagents})` — the subagent list updates only on poll.
- Three e2e scripts (`e2e-memory`, `e2e-ask-question`, `e2e-box-tools`) spawn their own backend
  and die on the port; they need to reuse the running one.

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
