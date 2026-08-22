# How the client adopts an entry it did not create

Why a reply the backend already has takes a minute or more to appear, and why the typing
indicator never shows. One cause, several symptoms.

## The client is not polling a list — it is replicating a log

The renderer keeps a **replica** of each transcript, not a cached array. Fetched pages and
live events both go through it (`services/grokbot-backend/scripts/grep-fe.mjs "ingestEvent"`):

```js
ingestEvent(e) {
  const { ordered: t } = e;
  if (t != null && t.replicaKey === this.options.replicaKey) {
    if (this.epoch == null || t.epoch !== this.epoch) {
      this.joinOrStartAttempt();
      this.bufferForeignBounded(t.epoch, t.sequence, e.event);   // parked, not applied
      return;
    }
    if (t.sequence > this.highestObserved) this.highestObserved = t.sequence;
    …
```

Every event carries an ordering envelope:

```
ordered : { replicaKey, epoch, sequence }
event   : { type: "removed", id } | { type: "cleared" } | { type, entry }
replicaKey = `transcript:${agentId}`
```

## Why polling alone cannot install a new entry

This is the page-install path. `X.anchor` is the client's `observedAnchor`:

```js
D = (j, Z, X) => {
  if (X.anchor == null) {
    const ae = j.replica.view();
    if (ae.epoch != null || ae.value !== X.windowAtDispatch || L(j)) return;   // <- discarded
    x(j, Z.entries);                                                           // first load only
    R(j, Z.nextBeforeSeq);
    return;
  }
  j.replica.ingestSnapshot({
    replicaKey: pde(j.agentId),
    epoch: X.anchor.epoch,
    throughSequence: X.anchor.sequence,
    coverage: { kind: "transcript-live-range", … },
    value: { isInstalled: true, liveRange: le, entries: Z.entries },
  });
}
```

`observedAnchor` is only ever set from an **event's** `ordered` envelope. So with no events:

- there is no anchor, so every fetch takes the `X.anchor == null` branch
- that branch installs **only** while nothing is installed yet and the window has not changed
  since the request was dispatched
- once the first page is in, `ae.value !== X.windowAtDispatch` holds and every later poll is
  **discarded**

The transcript is fetched every 7–8s, contains the new entry, and is thrown away. It appears
eventually only because some other path forces a full resync.

## What this explains

| Symptom | Cause |
|---|---|
| A reply lands in the backend in 3s and shows up a minute or more later | polls discarded; only a resync installs |
| The typing indicator never appears | presence rides the same path — by the time it is adopted the turn is over |
| Messages typed **into** the app appear instantly | those are applied locally, never through the replica |

It also explains why this looked like three separate bugs, and why the SSE stream was a dead
end: the transport was never the problem — the payload has no ordering envelope, so the
replica cannot accept it.

## What a fix needs

1. An **epoch** per agent transcript: stable while the process lives, changed when history is
   rewritten. Sequence is already there — `seq` is now stable and monotonic (see `test-seq`).
2. Transcript pages to carry the envelope so the client can anchor without waiting for an
   event.
3. An event per change, `{ordered: {replicaKey: `transcript:${agentId}`, epoch, sequence},
   event: {type, entry}}`, delivered on whatever channel electron-main is listening to —
   which is still unidentified. `/gw/events` is open and connected, but nothing in
   `gateway-protocol.ts` reads it, so the consumer has to be found before the events have
   anywhere to go.

### Step 2 does not work — verified before building it

The fetch-completion path reads the response for `entries` and `nextBeforeSeq` and nothing
else; the epoch and sequence come from `se.anchor`, captured from `j.observedAnchor` at
DISPATCH time:

```js
const se = { anchor: j.observedAnchor, attemptId: …, windowAtDispatch: Z.value };
F(j).then(le => { … D(j, le, se) … });
```

So a page cannot carry an envelope that the client will read. Putting one there would have
been dead code, and the plan above was wrong. Only an event can set the anchor, which makes
step 3 not merely the unknown but the only route.

### What the plain path tells us

The no-anchor branch installs when three things hold: no epoch yet, the replica value is
unchanged since dispatch, and no anchor exists. That branch is live — it is why entries
arrive at all, late rather than never. Anything that mutates the replica between dispatch and
completion (an optimistic local send, a resync) makes that poll's result get dropped, and the
next chance is 7–8s later.

So the realistic options are: find the event channel electron-main consumes (step 3), or
accept the plain path and reduce what disturbs it. Neither is a change to the page shape.

## The roster is replicated the same way — and that is the indicator

The typing indicator reads `isRunning` / `isComposingMessage` off the **agent record**, so it
travels with the roster, not the transcript. The roster is the same kind of replica:

```js
ingestAgentsEvent: we => {
  we.ordered == null
    ? x = b(Pe)                                              // no envelope -> wholesale replace
    : x.ingestSnapshot({ replicaKey: we.ordered.replicaKey,
                         epoch: we.ordered.epoch,
                         throughSequence: we.ordered.sequence,
                         coverage: we.coverage ?? {kind:"complete-roster"}, value: Pe })
},
ingestAgentUpserted: we => {
  const { ordered: Pe } = we;
  Pe != null && x.ingestEvent({ ordered: Pe, event: { agent: …, activeAgentId: … } })
}                // ^ dropped outright when there is no envelope
```

Two useful facts fall out:

- A **full roster** with no `ordered` envelope is accepted and replaces everything. That path
  works today.
- A **single-agent update** without an envelope is discarded, so presence changes can never
  arrive incrementally.

And `listAgents` is not among the methods the app polls (measured: `getAgentTranscriptTail`,
`getAgentChannels`, `getAgentWorkflows`, `getSubagents`, `getAsyncTasks`, `openAgentTail`,
`getAgentAutomations` — no `listAgents`). So the roster is re-read only on specific triggers,
which is why presence sits at whatever it was when the roster was last installed.

## The animation itself is not missing

The client component is complete (`EJn`): it returns
`{isMounted, isExiting, mode, activity, activityElapsedMs}` with `typing` / `working` modes,
a 140 ms exit transition, the activity label and an elapsed timer. Nothing needs building on
that side. It has simply never been given a reason to mount.

## Three guesses at the SSE payload, none of which worked

The channel is confirmed: the app's main process opens `/gw/events` with
`accept: text/event-stream`, user-agent `node` (undici inside Electron main). Presence is
also confirmed correct on the wire — captured from our own stream:

```
roster seq=1  running=true  composing=false  activity={"kind":"thinking"}   -> "working"
roster seq=2  running=true  composing=true   activity=null                  -> "typing"
roster seq=3  running=false composing=false  activity=null                  -> "none"
```

Three payload shapes were tried against the real app. None changed anything:

1. transcript events with `{ordered:{replicaKey:`transcript:${id}`,epoch,sequence}, event:{type,entry}}`
2. roster events with `{ordered:{replicaKey:"roster",…}, agent, activeAgentId}`
3. a full roster snapshot on connect, with `coverage:{kind:"complete-roster"}`, to establish
   the epoch — since the client buffers every event as foreign until it has one

All three were derived from RENDERER function signatures (`ingestEvent`, `ingestAgentsEvent`,
`ingestAgentUpserted`). That is the flaw in the reasoning: those describe what the renderer
receives over the coordinator port, not what electron-main parses off the SSE stream. The
inference that main forwards the envelope as-is rests on `replicaKey` appearing zero times in
`main.cjs` — which equally supports main not participating in this at all, with the renderer
fed from somewhere else entirely.

## Found: the parser is in a different process

`main.cjs` was the wrong file. The SSE client lives in `dist/node-agent-coordinator/main.cjs`
— a separate 140 KB bundle, unminified, with its original comments. That is the "coordinator"
the renderer refers to, and it is the only place `text/event-stream`, `/events` and `/api`
appear outside undici.

```js
var GATEWAY_API_PREFIX = "/api";
var GATEWAY_EVENTS_PATH = "/events";
var GATEWAY_HEALTH_PATH = "/health";

dispatchEventBlock(block, vncProxy) {
  const dataLines = block.split("
").filter(l => l.startsWith("data:")).map(l => l.slice(5).trim());
  if (dataLines.length === 0) return;
  const event = JSON.parse(dataLines.join("
"));
  if (typeof event.channel !== "string" || event.channel.length === 0) return;   // <-- here
  this.options.onEvent({ channel: event.channel, payload: event.payload });
}
```

**Every event needs `channel` and `payload`.** This backend had been sending
`{kind, agentId, ordered, event}` — no `channel` — so every event it ever emitted was
discarded on that line, silently. That is why fixing the envelope *inside* the payload three
times changed nothing: none of it ever got past the first check to be looked at.

Channel names come from the client's own method-to-domain map: `transcript`, `roster`,
`send`, `widgets`, `approvals`, `capabilities`, `sharing`, `automations`, plus `forever-box`.

## Result — the first numbers were a false positive

The "0.4s" and "3.1s" reported after the `channel` fix were **not real**. The marker was
embedded in the PROMPT, so the moment the user's own message rendered, the check matched. It
was measuring the echo of the send, never the reply. Retracted.

`scripts/e2e-debug.mjs` measures each stage separately and uses a marker only a reply can
contain. Against the running app:

```
ok   1. backend answers
ok   2. app is on the event stream          connected=1
ok   3. app window reachable
ok   4. a bot is open                       header says "Marketing"
ok   5. backend produced the reply          5.0s
ok   6. presence moved on the wire          working -> typing -> working -> none
FAIL 7. app drew the indicator              not seen
FAIL 8. app rendered the reply              not within 40s
        transcript grew 10 -> 13
```

So the backend is right, presence is right, the stream is connected — and the app applies
none of it. The `channel` wrapper was necessary (without it the decoder drops every event on
its first line) but it is not sufficient. What remains unknown is the PAYLOAD shape each
channel expects, which the coordinator forwards untouched: `onEvent({channel, payload})`.

Two harness lessons, both of which had produced wrong conclusions earlier: identify the open
bot from the CHAT HEADER rather than by matching transcript text against the screen, and
never put the marker in the prompt.

The lesson worth keeping: three correct payloads failed because of a wrapper, and nothing
reported an error at any point. When repeated correct-looking fixes change nothing at all,
the thing to question is whether the message is being *read*, not what is inside it.

---

## Chưa sửa: replica lệch rồi không tự neo lại (18/08, đo trên phiên phát lại 66 lượt)

**Triệu chứng người dùng thấy.** Khung hội thoại đứng yên trong khi bot vẫn chạy: sidebar cập nhật
đúng (giờ, dòng preview mới), nhưng khung chat chậm ~7 lượt. Mở một bot **mới được agent tạo ra giữa
chừng** (`Gmail`, `Discord CSKH`, `Quản lý`) thì **quay vòng mãi**, không bao giờ hiện nội dung.

**Những gì đã loại trừ — bằng số đo, không phải suy đoán:**

| Nghi ngờ | Kết quả đo | Kết luận |
|---|---|---|
| Backend treo | 83 entry, seq **2415** và tăng đều, `status: healthy` | **không** |
| Epoch đổi do restart | epochHint client `1786989236125` vs backend `…130` — lệch **5 ms**, cùng tiến trình | **không** |
| Lỗ hổng số thứ tự | nghe trực tiếp `/gw/events` 45 s, seq 2300→2415 **liên tục, không nhảy** | **không** |
| Gateway nghẽn | `openAgentTail` **4–12 ms** mọi bot, kể cả tail **107 KB** | **không** |
| Client không thèm hỏi | `openAgentTail` **1 → 12** sau các cú bấm; phản hồi có dữ liệu (4.243 byte) | **không** |

Giả thuyết đầu tiên của tôi — "backend khởi động lại làm đổi epoch" — **sai**, và phép đo 5 ms là thứ
bác bỏ nó. Ghi lại vì nó là cái bẫy tự nhiên nhất ở đây: `EPOCH = Date.now()` *thật sự* đổi mỗi lần
khởi động, nên lời giải thích nghe rất hợp lý mà vẫn không phải nguyên nhân của lần này.

**Phép thử phân định.** Bấm sang bot khác rồi quay lại `Thư ký` → khung **đuổi kịp ngay lập tức**.
Nghĩa là dữ liệu vẫn tới được khi có một lần đọc lại, còn luồng sự kiện thì không tự đưa replica về
đúng trạng thái.

**Nguyên nhân.** Client dựng khung chat từ replica cục bộ của nó. Ta có đúng một cơ chế "thay nguyên
khối" — gói **không kèm `ordered`**, đã ghi rõ trong chú thích ở `gateway.ts`:

> Sent without `ordered` on purpose. The client's own handler reads that as "replace wholesale"
> (`we.ordered == null ? x = b(Pe) : x.ingestSnapshot(…)`)

nhưng ta **chỉ dùng nó cho roster**, lúc client nối lại luồng. Transcript thì không bao giờ được gửi
ảnh chụp. Hệ quả gồm hai lớp:

1. Replica của một hội thoại đang mở, một khi lệch, **không có đường về** — mọi sự kiện sau đó là
   append lên một nền sai.
2. Bot **sinh ra sau khi client đã nối luồng** thì client **chưa từng có replica**, nên khung chat
   không có gì để dựng và quay vòng mãi. Sidebar vẫn đúng vì nó đi bằng roster, một replica khác.

**Cách sửa (chưa làm).** Gửi ảnh chụp transcript **không kèm `ordered`** ở hai thời điểm:

- khi client mở một hội thoại mà nó chưa có replica — đường `openAgentTail`;
- khi luồng sự kiện nối lại, song song với ảnh chụp roster đang có sẵn ở `/gw/events`.

Kèm theo: `nextTranscriptOrdered` và `EPOCH` hiện đều **sinh lại từ đầu mỗi lần tiến trình khởi
động**, trong khi lịch sử được nạp lại nguyên vẹn từ đĩa — tức một lần khởi động lại **không phải** là
"history rewritten" như chú thích ở `chat.ts` giả định. Nên cân nhắc lưu epoch + seq xuống `.data` để
restart không còn là một lần lệch replica nữa.

**Vì sao chưa sửa ngay:** sửa `src/` sẽ khiến `tsx watch` khởi động lại và giết phiên phát lại đang ở
54/66 lượt — mất 23 phút dữ liệu đối chiếu với bản gốc. Để làm một thể sau khi phát lại xong.
