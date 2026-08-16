# Parity — what the local app still lacks

Measured against the original running side by side (`--user-data-dir` + separate CDP port, see
`HANDOFF.md` §3), plus the descriptors and prompts extracted from the shipped bundles.

Method note: the box gateway is called from the **main process**, so renderer network capture
shows nothing (`capture-box.mjs` and the first `diff-capabilities.mjs` both came back empty for
this reason). The usable probes are the rendered DOM (`scripts/diff-capabilities.mjs`), the
extracted tool catalog, and the extracted base system prompt.

---

## 1. Measured difference, both apps live

`node scripts/diff-capabilities.mjs --cdp http://127.0.0.1:9333` (original) vs `:9222` (local):

| Surface | Original | Local |
|---|---|---|
| attachments | 24 | **0** |
| inline images | 4 | **0** |
| "Open computer" card | 2 | **0** |
| routine event triggers ("When @mentioned…") | 1 | **0** |
| routine cron triggers | 21 | 9 |
| tool cards | 2 | 2 |
| screen pane | 1 | 1 |

Chat, roster, transcripts, reactions, the approval loop, cron routines and the VNC pane are at
parity. Everything below is the remainder.

## 2. Fix first — we are emitting a field nobody reads

`chat.ts` declares `TextMsg.images?: string[]` (and the same on `kind:"message"`). It is never
assigned anywhere — and even if it were, **the renderer has no such path**. (The one place images
do flow, `readImageAttachment`, feeds the *model*, not the transcript.) Attachments render
through exactly one function:

```js
if (kind === "user-attachment")   → { path: file_path, name: file_name }        // snake_case
if (kind === "send-message" && message.type === "attachment")
                                  → { path: message.url, name: message.file_name }
```

So `images` is dead — the same class of bug as the five in `HANDOFF.md` §5. Until this is
fixed, **no screenshot can ever appear in the transcript**, which is why `browser_take_screenshot`
can only report a byte count and why the browser and computer work stays half-blind. A resolved
attachment can also render as *"Image unavailable"* when its `status` is `missing`, which is the
placeholder visible in the original's own transcript.

This is the highest value-per-effort item in the list: it unblocks every visual tool at once.

## 3. Tools: 9 of 54 — but most of the 45 do not matter

The catalog is Cursor's IDE heritage. Ignore `go_to_definition`, `fix_lints`, `read_lints`,
`apply_agent_diff`, `connect_scm`, `fetch_pull_request`, `search_symbols`, `reapply` and friends —
Grok Bot never uses them.

What the base system prompt actually leans on (mention counts from the extracted 32.8 KB prompt):
`box` 31 · `SendMessage` 14 · `cloud agent` 12 · `widget` 7 · `screenshot` 6 · `routine` 5 ·
`MCP` 5 · `subagent` 4 · `attachment` 4 · `channel` 3. The prompt names almost no tools directly
(`task` 16 is the exception) — it is written in terms of *surfaces*.

| Missing tool | Why it matters here |
|---|---|
| `task_v2` / `task` | how `browserUse` / `computerUse` subagents are invoked at all |
| `ask_question` | the "Your answer" widget — the FE renders it, we have never emitted one |
| `call_mcp_tool` / `get_mcp_tools` | the original is seen attaching a Telegram MCP mid-conversation |
| `web_search` / `web_fetch` | no box needed; cheap |
| `todo_write` / `todo_read`, `create_plan` | multi-step work the user can watch |
| `computer_use` | desktop actions (11-action oneof), complements the browser tools |
| `edit_file_v2`, `delete_file`, `write_shell_stdin` | we can read the box but not mutate it |
| `generate_image`, `record_screen`, `send_to_user` | visible surfaces the original uses |

## 4. Gateway surfaces still stubbed

Answering the declared shape, no feature behind them:

- **Channels / listeners** — `getAgentChannels`, `connectChannel`, `getListenerIntegrations`,
  `getListenerConnectUrl`. This is what a routine triggered by *"When @mentioned anywhere on
  Slack"* needs; our routines are cron-only.
- **Cloud agents** — `getCloudAgentInfo: () => null` (12 mentions in the base prompt).
- **Skills publishing, workflows, groups, teach recording, MCP servers, plugins, secrets.**
- **Shared rooms** (9 methods) — still needs a real relay; faking it creates rooms nobody joins.

## 5. The architectural gap

Our loop is one tool per turn, one string argument, an approval card every time. The original
does multi-step autonomous work — open Telegram, screenshot, read, decide, ask the user — inside
a single turn, with parallel tool calls and subagents.

Closing that is a bigger change than any single tool: multi-call turns, a tool result channel
that carries images, and subagent dispatch (`task_v2`).

**The system prompt is no longer a blocker.** `buildSandBaseSystemPrompt` (32,829 chars) is
extracted — see `agent-brain.md` and `docs/extracted/subagent-prompts.md`. `chat.ts` still runs a
short hand-written Vietnamese prompt. Adapting the real one is probably the largest behaviour
change available per unit of effort, and it is now a copy-and-adapt job rather than guesswork.

## 6. Suggested order

1. **Attachment contract** (§2) — small, unblocks every visual tool.
2. **`ask_question`** — the widget already renders; we only have to emit it.
3. **Adopt the extracted base prompt** — behaviour parity without new plumbing.
4. **`task_v2` + subagents** — makes the browser tools usable the way the original uses them.
5. **MCP tools** (`get_mcp_tools` / `call_mcp_tool`).
6. **Channels/listeners** → event-triggered routines.
7. `web_search`/`web_fetch`, `todo_*`, `create_plan`, box file mutation.
