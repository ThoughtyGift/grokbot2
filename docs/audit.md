# FE / BE coverage audit

Snapshot of which Grok Bot FE surfaces the backend actually serves. Verdict: a thin but
genuinely-working chat spine — after the P0 pass, core chat + roster are usable.

## Works
- **Boot + identity** — auth JWT + bootstrap gates (`GetMe`, `GetSandAccessStatus=GRANTED`,
  `EnsureSandBox`…) → renders past the paywall.
- **Roster** — list / count / create / **rename / delete / duplicate / hide / unread** (P0 ✅).
- **Chat** — multi-turn text via the Claude pool, agent naming, **progressive (typing) reveal**,
  **interrupt** a running turn, **reactions**, **conversation outline**, prompt-acceptance (P0 ✅).
- **Shell** — SSE refresh, settings render + onboarding bypass, `/gw/health` green.

## Surface matrix

| Priority | Surface | Status |
|----------|---------|--------|
| P0 | Bot roster / sidebar | **WORKS** (list/create/rename/delete/duplicate/hide/unread) |
| P0 | Chat transcript | **WORKS (text)** — streaming reveal + interrupt + reactions + outline; no tool-call/widget entries yet |
| P0 | Composer | **WORKS (text)** — attachments/images/voice/@mentions pending |
| P0 | Run controls | **interrupt WORKS**; kickstart/broadcast pending |
| P1 | Approval flows (auto-review, tool-permission) | MISSING |
| P1 | Agent edit / notifications / avatars | PARTIAL (rename done; avatars/notifications pending) |
| P1 | Trays, Settings write | STUB |
| P2 | workflows, automations, channels, subagents, MCP/plugins mgmt, skills publish, teach, sharing/rooms, forever-box, updates, egress, **VNC**, feedback | mostly MISSING |

## Next (P1 / P2)
See [roadmap.md](roadmap.md). Biggest remaining chat gaps: tool-call/widget entry kinds +
approval pipeline (needed the moment the agent uses a tool), attachments/images, real token
streaming (needs a streaming pool endpoint — current reveal is client-side progressive).
