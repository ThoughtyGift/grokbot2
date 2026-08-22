/**
 * The in-process domain event bus.
 *
 * Domain modules announce that something changed, in grokbot2 terms, and say nothing about who
 * cares. The ACL is the subscriber that turns these into SSE frames — which channel, which
 * envelope and whether an entry is `appended` or `updated` are all client facts and none of
 * them belong here.
 *
 * This replaces four single-slot sinks (`setUpdateSink`, `setRosterSink`, `setBoxStatusSink`,
 * `setAutomationsSink`). Each of those let exactly one listener exist and had the domain hold a
 * callback the transport handed it; the bus inverts that, which is what lets a listener be added
 * for the native API (Phase 7) without the domain learning about a second transport.
 *
 * Delivery is synchronous and failures are contained: a subscriber that throws must not abort
 * the turn that published, because the publisher's work is already done and the frame is a
 * side effect of it.
 */
export type DomainEvent =
  /** An entry was added to a transcript, or an existing one changed (streaming counts). */
  | { type: "transcript.append"; agentId: string }
  /** A roster row changed. No `agentId` means "the whole list did" — a delete, say. */
  | { type: "agent.upserted"; agentId?: string }
  /** An agent's computer went from off to running, or back. */
  | { type: "computer.status"; agentId: string }
  /** An agent's routines were created, edited, deleted, toggled or run. */
  | { type: "automations.changed"; agentId: string };

export type DomainEventType = DomainEvent["type"];

const subscribers = new Set<(e: DomainEvent) => void>();

/** Returns an unsubscribe function, so a test can listen without leaking into the next one. */
export function subscribe(fn: (e: DomainEvent) => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

export function publish(e: DomainEvent): void {
  for (const fn of subscribers) {
    try {
      fn(e);
    } catch (err) {
      console.error(`[events] subscriber threw on ${e.type}:`, err);
    }
  }
}
