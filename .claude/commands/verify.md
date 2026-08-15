---
description: Typecheck the workspace and smoke-test the backend chat flow
---

1. `pnpm typecheck` — must be clean across all workspace packages.
2. Start the backend, then exercise the chat flow over HTTP (no GUI needed):
   - `POST /gw/api/createAgent {}` → returns an agent record with an `id`.
   - `POST /gw/api/sendPrompt { "agentId": "<id>", "content": "test" }` → `{ accepted: true }`.
   - `POST /gw/api/getAgentTranscriptTail { "agentId": "<id>" }` → `entries` contains a
     `user-message` and an `agent-message` (Claude reply if `pool-key.txt` is set, else a placeholder).
3. Report anything that isn't WORKS; do not claim success without the transcript check passing.
