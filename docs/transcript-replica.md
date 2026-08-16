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

Step 3 is the unknown. Steps 1 and 2 are ours and can be done first: an anchored page install
is a real branch in the client, and it may be enough on its own.

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
