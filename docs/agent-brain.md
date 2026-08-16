# The agent brain — what ships, what doesn't

Written after extracting the shipped client bundle, because the question "can we just take
the original brain?" has a hard answer that changes how the backend must be built.

Regenerate with:

```bash
node services/grokbot-backend/scripts/extract-tools.mjs \
  <path-to>/renderer/assets/index-*.js docs/extracted
```

---

## 1. The short answer

**No — the brain does not ship in the app, and no amount of extraction will produce it.**

The desktop app is a *renderer and a hand*. The *decision-making* is server-side.

```
        ┌── system prompt ──┐
        │  agent loop       │   Cursor's servers (aiserver.v1)   ← NEVER shipped
        │  model choice     │
        └───────────────────┘
                 │  emits ClientSideToolV2Call
                 ▼
        ┌───────────────────┐
        │  the box          │   Linux pod: runs bash, files, the desktop
        └───────────────────┘
                 │  local-exec channel (box asks the desktop)
                 ▼
        ┌───────────────────┐
        │  Grok Bot desktop │   renders tool cards, executes local requests
        └───────────────────┘
```

**Proof that the prompt is absent**: the whole bundle contains exactly three matches for a
system prompt, and all three are protobuf *field names* — `system_prompt_override`,
`custom_system_prompt`, `system_prompt_spec`. There is no prompt text, no tool-choice logic,
and no loop. Searches for the usual openings (`You are a…`) return zero.

So the brain in `services/grokbot-backend/src/chat.ts` is, and must be, **ours**.

## 2. What *is* extractable — and it is a lot

The renderer carries the full descriptor set, so every name survives minification.

| Extracted | Count | File |
|---|---|---|
| Tools in `ClientSideToolV2` | **54** (48 with param schemas) | `docs/extracted/tool-catalog.json` |
| `aiserver.v1` + `agent.v1` messages | **2496** + **928** | `docs/extracted/proto-messages.json` |
| Enums | **182** | `docs/extracted/proto-enums.json` |

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
