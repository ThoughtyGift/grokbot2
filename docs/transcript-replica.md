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

**Stop guessing here.** Three shapes tried blind is the signal. What settles it is seeing
what a real box sends on that stream, which needs an entitled account, or finding the SSE
parser in `main.cjs` by structure rather than by string search — every `text/event-stream`
and `EventSource` hit so far has been undici's bundled library, not the app's own use of it.
