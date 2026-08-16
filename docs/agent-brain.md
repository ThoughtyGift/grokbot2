# The agent brain — what ships, what doesn't

Written after extracting the shipped client bundle, because the question "can we just take
the original brain?" has a hard answer that changes how the backend must be built.

Regenerate with:

```bash
# descriptors + tool catalog, from the RENDERER bundle
node services/grokbot-backend/scripts/extract-tools.mjs \
  <path-to>/renderer/assets/index-*.js docs/extracted

# prompts, from the BOX HOST bundle — a different file, and the one that matters
node services/grokbot-backend/scripts/extract-prompts.mjs \
  <path-to>/host/host-main.cjs docs/extracted
```

---

## 1. The short answer — corrected

> **Superseded.** The first version of this document concluded "the brain does not ship, and no
> amount of extraction will produce it." **That was wrong**, and the error is worth recording
> because it is a research trap, not a typo: the search was run against
> `dist/renderer/assets/index-*.js` only. The prompts live in `dist/host/host-main.cjs` — the
> **box host**, which ships inside the very same `app.asar`. Searching one bundle and concluding
> something about the app is how you miss 33 KB of prompt sitting in the next file over.

What actually ships, in `host-main.cjs`:

| | |
|---|---|
| `buildSandBaseSystemPrompt` | **32,829 chars** — Grok Bot's own base system prompt |
| `SAND_AUTO_REVIEW_CLASSIFIER_SYSTEM_PROMPT` | 58,221 chars |
| 38 more prompts | subagent reminders, compaction, summarisation, wake/revival prompts |
| 6 subagent configs | permission mode + model + which reminder |
| 7 tool allowlists | which tools each subagent may use |

Identified by content, not by name: the base prompt contains 14 mentions of `SendMessage`,
32 of `box`, 12 of `cloud agent`, 11 of `MCP`, and rules about routines and reaction-only
turns — i.e. it describes Grok Bot's behaviour, not a generic IDE assistant. It is assembled at
runtime from flags (`${cloudAgentsEnabled ? … : …}`), so it is a *template*, not a fixed string.

Everything is in `docs/extracted/subagent-prompts.{json,md}`.

**What still does not ship**: the agent *loop* — model choice per turn, when to stop, how tool
results re-enter context. The prompt is the instruction set; the server still runs the machine.

```
        ┌── agent loop ─────┐
        │  turn control     │   Cursor's servers (aiserver.v1)   ← still NEVER shipped
        │  model routing    │
        └───────────────────┘
                 │  emits ClientSideToolV2Call
                 ▼
        ┌───────────────────┐
        │  the box          │   Linux pod: bash, files, desktop
        │  host-main.cjs    │   ← the prompts ARE here
        └───────────────────┘
                 │  local-exec channel (box asks the desktop)
                 ▼
        ┌───────────────────┐
        │  Grok Bot desktop │   renders tool cards, executes local requests
        └───────────────────┘
```

So the loop in `services/grokbot-backend/src/chat.ts` must still be ours — but its **system
prompt no longer has to be guessed**.

## 2. What *is* extractable — and it is a lot

Two bundles, two different harvests. Search **both**.

| Extracted | Count | Bundle | File |
|---|---|---|---|
| Tools in `ClientSideToolV2` | **54** (48 with param schemas) | renderer | `docs/extracted/tool-catalog.json` |
| `aiserver.v1` + `agent.v1` messages | **2496** + **928** | renderer | `docs/extracted/proto-messages.json` |
| Enums | **182** | renderer | `docs/extracted/proto-enums.json` |
| Prompts (incl. the base system prompt) | **40** | **host** | `docs/extracted/subagent-prompts.json` |
| Subagent configs / tool allowlists | **6** / **7** | **host** | same |
| Browser MCP actions (`cursor-ide-browser`) | **16** | **host** | same |

### The browser surface

The browser is **not** bespoke code — it is an MCP provider, `cursor-ide-browser`, wrapped in a
`browserUse` subagent (`AGENT_ONLY`, model `claude-4.5-sonnet`, stateful/resumable, with
`READ/GLOB/GREP/TODO_WRITE/SEMANTIC_SEARCH` for local context). Its 16 actions:

```
browser_navigate · browser_snapshot · browser_take_screenshot · browser_click
browser_mouse_click_xy · browser_type · browser_fill · browser_select_option
browser_press_key · browser_scroll · browser_drag · browser_get_bounding_box
browser_highlight · browser_evaluate · browser_tabs · browser_cdp
```

That is near 1:1 with Playwright MCP, so "porting the browser" means pointing the loop at a
browser MCP — not writing an automation layer. The box-side browser it drives is plain
`google-chrome` on the desktop (see `box-architecture.md`).

### The 54 tools

Cursor's IDE heritage shows — many are repo tools the box never uses. The ones that matter
for a computer-using agent:

| Tool | Params |
|---|---|
| `computer_use` | `actions[]` → the desktop |
| `run_terminal_command_v2` | `command, cwd, new_session, is_background, require_user_approval` |
| `read_file_v2` | `target_file, offset, limit, chars_limit, enable_line_numbers` |
| `list_dir_v2` | `target_directory, ignore_globs[]` |
| `glob_file_search` | `target_directory, glob_pattern` |
| `ripgrep_raw_search` | `pattern, path, glob, output_mode, context_before/after, case_insensitive` |
| `web_search` / `web_fetch` | `search_term` / `url` |
| `ask_question` | `title, questions[], run_async` |
| `todo_write` / `todo_read` | `todos[], merge` / `read` |
| `task_v2` | `description, prompt, subagent_type, model, name, mode` |
| `create_plan` | `plan, title, steps[], todos[], overview` |
| `call_mcp_tool` / `get_mcp_tools` | `server, tool_name, tool_args` |
| `record_screen` | `mode, tool_call_id, save_as_filename` |
| `generate_image`, `reflect`, `await`, `send_to_user`, `ai_attribution` | no params |

Full list with every field: `docs/extracted/tool-catalog.json`.

### `computer_use` — the desktop contract

`agent.v1.ComputerUseAction` is a oneof over eleven actions:

```
mouse_move · click · mouse_down · mouse_up · drag · scroll
type · key · wait · screenshot · cursor_position
```

This is the vocabulary the VNC box speaks. Relevant when the viewer work resumes.

### `ask_question` — the "Your answer" widget

The widget seen in the original app but missing locally is this tool:

```
AskQuestionParams  { title, questions[], run_async }
  Question         { id, prompt, options[], allow_multiple }
  Option           { id, label }
AskQuestionResult.Answer { question_id, selected_option_ids[], freeform_text }
```

The FE already renders it; the backend has simply never emitted one.

## 3. Where the local brain stands

`chat.ts` today implements a small hand-written loop: the model is told to answer with
`TOOL_CALL: <name>(<arg>)`, and six pure tools are available — `echo, time, reverse, upper,
count, calc`. They touch nothing outside the process. **None of this came from the original**;
it was written to prove the approval pipeline end to end, and it does.

The gap is vocabulary, not architecture. The loop already does the right dance
(model → tool-call entry → approval card → result → follow-up answer). Renaming the tools to
the real ones and giving them real implementations is incremental work on a proven path.

### Suggested order

1. `run_terminal_command_v2`, `read_file_v2`, `list_dir_v2`, `glob_file_search`,
   `ripgrep_raw_search` — real, but executed **on the box over the exec daemon**, never on the
   user's Windows machine. This also builds the exec channel the VNC viewer may be waiting for.
2. `web_search` / `web_fetch` — no box needed.
3. `ask_question` — unlocks the widget surface the original has and we don't.
4. `computer_use` — after the viewer works.

### Known mismatch to fix while doing this

The FE renders a tool card by status: `pending` → spinner, **`failed`** → error icon,
anything else → wrench. The backend emits `error`, so a failed tool currently shows a plain
wrench instead of an error. Same class of bug as the five in `HANDOFF.md`.

## 4. Legal note

Extraction here is read-only inspection of a locally installed binary, for interoperability
with the owner's own account and infrastructure. No Cursor server prompt or model weight is
copied, because none is present. See `docs/legal.md`.
