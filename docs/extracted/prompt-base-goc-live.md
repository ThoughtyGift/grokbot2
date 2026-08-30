# System prompt gốc **đang vận hành** (live, server-bơm)

> Xuất 2026-08-30 từ **chính agent Grok Bot đang chat**, không từ `app.asar`.
> Asar 0.30.0 không chứa văn xuôi (`prompt-base-goc-0.30.md`). Đây là cách lấy được bản mới nhất.
> Đã **cắt**: user-memory, roster bot, schema tool JSON, id máy, bí mật.
> Giữ: bộ lõi hành vi + chương sản phẩm. Tên tool giọng nói trong phiên này: **`SendToUser`**.

Mapping: [`prompt-base-mapping-live-vs-grokbot2.md`](./prompt-base-mapping-live-vs-grokbot2.md).

## Không phải gì

- Không phải dump `prompt-base.ts` (cái đó là [`prompt-base-hien-hanh.md`](./prompt-base-hien-hanh.md)).
- Không phải 0.20 host (`prompt-base-goc-0.20.md`).
- Không bắt được từ `api2.cursor.sh` trên dây — đây là bản **đã inject** vào context model.

## Xương chương (live)

```
You are Grok Bot, a warm, concise desktop assistant.

## How a turn works          (Reply first; Pick the surface; Work out loud; Show work; Close the loop)
## SendToUser is your only voice
## Reply first, then keep the user posted
## Tone
## Reply length and shape
## Showing your work
## Never fabricate data
## Asking for decisions      (widget; secret-request)
## Threaded replies
## Where you work            (box | MCP | web | user PC via machineId)
## Long-running commands     (block_until_ms)
## Delegating background work  (Task: executor, browserUse, computerUse, watchVideo)
## Managing plugins and MCP servers
## Reaching services that have no connector
## Debugging the box
## The Grok Bot app UI
## Matching the user's writing style
## Cursor Origin
## Code changes              (CloudAgent bắt buộc cho repo)
## Autonomy
## Initiative
## When your own action needs approval   (Auto-review)
## Security
## Untrusted content
## Multitasking              (TodoWrite, executor)
## Purchases                 (Stripe Link)
## Your box / The box desktop
```

Runtime (không phải văn xuôi lõi, vẫn bơm mỗi lượt): Agent profile, Memory, Routines, Skills catalog, Timezone, MCP status, tool descriptors.

## Lệch so với 0.20 (để port)

1. `SendMessage` → `SendToUser` (cùng shape text/widget/attachment).
2. Máy user: `ExternalShell` → `Shell`/`Read` + `machineId` từ `ListMachines`.
3. CloudAgent **bật** (0.20 còn template `${cloudAgentsEnabled ? …}`).
4. Subagent: `browserUse` ưu tiên hơn `computerUse`; `watchVideo` / `videoReview`.
5. Thêm Untrusted content, Multitasking, Purchases, Origin chi tiết, Code changes (cấm clone).
6. Safety overlay DISALLOW (cyber exploit, child_sex, bio, …) — lớp riêng, không nằm host 0.20.

## Đoạn lõi (rút, đủ để diff xương với 0.20)

Mở đầu giống 0.20, đổi kênh giọng nói:

```text
You are Grok Bot, a warm, concise desktop assistant.

## How a turn works
Every task follows the same rhythm:
1. Reply first. … first action is a plain text SendToUser, before any tool call …
   Exception: ReactToMessage tapback = both the turn.
2. Pick the surface. Own computer (Read, Shell) default; MCP; web (WebSearch, WebFetch);
   user's registered computers via ListMachines + machineId.
3. Work out loud.
4. Show your work.
5. Close the loop. Deliver inside SendToUser; widget if a decision is required.

## SendToUser is your only voice
Plain assistant text is inner monologue. Nothing is delivered until SendToUser.
Ack ≠ delivery. Results of work go in SendToUser before the turn ends.
```

Phần Tone / Reply length / Never fabricate / Autonomy / Initiative **cùng gia đình 0.20** (gb2 đã KEEP).

Phần **không có** trong gb2 `prompt-base.ts`: only-voice, Where you work đầy đủ, CloudAgent, Origin, Code changes, Threaded replies, Long-running commands, App UI map, Security, Untrusted content, Multitasking, Purchases.

## Kết luận map

**Có, map được xương.** Live vẫn là cây 0.20 + lớp 0.29/0.30 (cloud, máy user, untrusted, purchases).

**Không** dán live vào `prompt-base.ts`: sẽ gọi `SendToUser`/`CloudAgent`/`ListMachines` — BE grokbot2 không có (hoặc stub).

Việc đúng: lấy bảng trên, KEEP thêm Untrusted + Time; không bật CloudAgent/Origin/Purchases cho đến khi có cổng.
