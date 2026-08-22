---
description: After a Strangler phase — run gates, local E2E if the app is up, then advance
---

1. Backend must be on `:8788`. From **F3**, local Grok Bot on CDP `9222` is **required** (gate RED if missing) — `pnpm dev:app`.
2. `pnpm phase:gate` — current phase from `docs/parity-runs/phase-current.json` (human copy: `docs/state/phase-state.json`). `--phase 0` and `--phase P0` are the same. `--phase F3` measures F3 **without** moving the pointer.
3. If PASS and the work for this phase is done: `pnpm phase:advance`.
4. Update the matching row on the Notion board (Status → Hoàn tất) and start the next phase's task.
5. Do **not** skip a red gate. Record the JSON under `docs/parity-runs/phase-N-gate.json`.
