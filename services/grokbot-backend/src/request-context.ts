/**
 * Request-scoped owner — multi-tenant Phase 2 (docs/plan/multi-tenant-roadmap.md).
 *
 * The roster and transcripts live in-memory (chat/state.ts Maps), and ~26 read/write sites reach
 * them directly. Threading an owner argument through all of them — and through the ACL's
 * `(args)=>unknown` ports — would be a second contract to keep in sync. Instead the backend HTTP
 * entry (index.ts) wraps each `/gw` dispatch in `runWithOwner(owner, …)`, and any domain function
 * reads `currentOwner()`. AsyncLocalStorage carries it across the awaits inside a command handler.
 *
 * Backward compatible: outside a request (background turns, tests, no token) `currentOwner()` returns
 * the single default identity — the same `auth0|grokbot2-user` every pre-Phase-2 agent is owned by —
 * so the desktop app, which only ever sends the default token, keeps seeing exactly what it did.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { DEFAULT_USER } from "./auth.js";

const store = new AsyncLocalStorage<{ owner: string }>();

export function runWithOwner<T>(owner: string, fn: () => T): T {
  return store.run({ owner }, fn);
}

/** The caller's owner id, or the default identity when called outside a scoped request. */
export function currentOwner(): string {
  return store.getStore()?.owner ?? DEFAULT_USER.authId;
}
