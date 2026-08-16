# FE / BE coverage audit

Two numbers matter, and they measure different things:

- **Method coverage** — `node services/grokbot-backend/scripts/e2e-coverage.mjs` replays every
  coordinator method the client bundle declares. Currently **78 / 87 handled**.
- **Argument shapes** — a method can be "handled" and still be dead if the handler reads the
  wrong key. Five such bugs were found and fixed by extracting the FE's literal call sites
  (`{id}` vs `{agentId}`, `profile.name`, `isEnabled`, `resolution`, the reaction shape).
  Run the backend with `GROKBOT2_LOG=1` to log each method's args as they arrive.

## Works (verified in the running app)

| Surface | Notes |
|---------|-------|
| Boot, auth, render | self-minted JWT, bootstrap gates, main window |
| Roster | list · create · rename · delete · duplicate · hide · unread · avatar · notification flags |
| Chat | send, real replies from the Claude pool, streaming, markdown, message-enter animation |
| Reactions | chips render; clicking the same emoji toggles it off |
| Tool calls | model emits `TOOL_CALL:` → approval card → approve → result → follow-up answer |
| Transcript | paging (`beforeSeq`), outline, search, interrupt |
| Persistence | agents, transcripts, settings and the acceptance ledger survive restarts |

## Stubbed — shape-correct, no feature behind it

These answer their declared shape (array / record / null) so the UI shows an honest empty
state instead of mis-parsing, but nothing is implemented: workflows, channels & listeners,
skill publishing, subagents, async tasks, cloud agent, teach recording, media search, groups,
trays, MCP servers, plugins/marketplace.

**Shape-correct is not the same as read-correct.** Two stubs answered a plausible shape and
still crashed the UI, because the client reads those fields without a guard:
`getForeverBoxStatus` returning `{status:"disabled"}` (no `state`/`vncUrl`/`agentId`) left the
computer pane dark, and `getSharingState` returning `{}` threw on `v.rooms.map(…)`. Check what
the client *reads*, not just what it accepts.

## Missing — needs real infrastructure

| Gap | Why it can't just be stubbed |
|-----|------------------------------|
| **Exec daemon** (running commands in the box) | needs a real daemon on the box; the *screen* does not depend on it |
| **Shared rooms** (9 methods) | multiplayer needs a relay server; faking it creates rooms nobody can join |
| **Voice input / transcription** | needs an audio pipeline |
| **Attachments beyond one image** | upload/stage/download are host-side surfaces |
| **Updates, real usage/billing** | server-authoritative on Cursor's side |

## Notes

- Model latency through the pool: gemini-2.5-flash ~0.8s · gemini-3.7-flash ~2s (default) ·
  sonnet ~5.7s · haiku ~6s · grok-4.5 ~12s. Override with `GROKBOT2_MODEL`.
- The pool's streaming route intermittently returns no deltas; the backend falls back to the
  non-streaming route so a reply is never lost.
