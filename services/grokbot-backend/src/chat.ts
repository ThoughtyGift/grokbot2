/**
 * Chat bridge — turns the stubbed box gateway into an agent host backed by the
 * Claude pool. `sendPrompt` appends the user turn, calls the pool, and stores the
 * assistant turn; the frontend reads it back via `getAgentTranscriptTail`.
 *
 * Transcript entry shapes were reconstructed from the client bundle:
 *   { kind: "user-message", entryId, text, images, timestampMs, clientNonce? }
 *   { kind: "agent-message", entryId, agentId, agentOwnerAuthId, authorName, text, images, timestampMs }
 */
import { callPool, type PoolMessage } from "@grokbot2/pool-client";
import { config, loadPoolKey } from "./config.js";

export const AUTH_ID = "auth0|grokbot2-user";

type Entry =
  | { kind: "user-message"; entryId: string; text: string; images: []; timestampMs: number; clientNonce?: string }
  | {
      kind: "agent-message";
      entryId: string;
      agentId: string;
      agentOwnerAuthId: string;
      authorName: string;
      text: string;
      images: [];
      timestampMs: number;
    };

export interface AgentRecord {
  id: string;
  name: string;
  agentOwnerAuthId: string;
  createdAtMs: number;
  unread: boolean;
}

const agents = new Map<string, AgentRecord>();
const transcripts = new Map<string, Entry[]>();
let entrySeq = 1;

/** SSE nudge sink — set by the gateway so chat updates reach the frontend. */
let onUpdate: (agentId: string) => void = () => {};
export function setUpdateSink(fn: (agentId: string) => void): void {
  onUpdate = fn;
}

export function createAgent(args: { name?: string } = {}): AgentRecord {
  const id = `agent-${agents.size + 1}`;
  const rec: AgentRecord = {
    id,
    name: args.name || "Claude",
    agentOwnerAuthId: AUTH_ID,
    createdAtMs: Date.now(),
    unread: false,
  };
  agents.set(id, rec);
  transcripts.set(id, []);
  return rec;
}

export const listAgents = (): AgentRecord[] => [...agents.values()];
export const countAgents = (): number => agents.size;
export const transcriptTail = (agentId?: string) => ({
  entries: (agentId && transcripts.get(agentId)) || [],
  hasMore: false,
});

export interface SendArgs {
  agentId?: string;
  content?: string;
  prompt?: string;
  text?: string;
  richText?: { text?: string };
  clientNonce?: string;
}

export function sendPrompt(args: SendArgs) {
  let agentId = args.agentId || [...agents.keys()][0];
  if (!agentId) agentId = createAgent({}).id;
  const text = args.content ?? args.prompt ?? args.text ?? args.richText?.text ?? "";

  const t = transcripts.get(agentId) ?? [];
  transcripts.set(agentId, t);

  const userEntry: Entry = {
    kind: "user-message",
    entryId: `e${entrySeq++}`,
    text,
    images: [],
    timestampMs: Date.now(),
    clientNonce: args.clientNonce,
  };
  t.push(userEntry);

  const aEntry: Entry = {
    kind: "agent-message",
    entryId: `e${entrySeq++}`,
    agentId,
    agentOwnerAuthId: AUTH_ID,
    authorName: "Claude",
    text: "",
    images: [],
    timestampMs: Date.now(),
  };
  t.push(aEntry);
  onUpdate(agentId);

  const key = loadPoolKey();
  if (!key) {
    aEntry.text = "[grokbot2] Chưa có key — dán hal_xxx vào services/grokbot-backend/pool-key.txt";
    onUpdate(agentId);
    return { accepted: true, entryId: userEntry.entryId, agentId };
  }

  const history: PoolMessage[] = t
    .filter((e) => e.kind === "user-message" || (e.kind === "agent-message" && e.text))
    .map((e) => ({ role: e.kind === "user-message" ? "user" : "assistant", content: e.text }));

  void callPool(history.length ? history : [{ role: "user", content: text }], {
    url: config.poolUrl,
    key,
    model: config.model,
    system: config.system,
  }).then((r) => {
    aEntry.text = r.ok ? (r.text ?? "") : `[grokbot2] Pool error: ${r.error}`;
    aEntry.timestampMs = Date.now();
    onUpdate(agentId);
  });

  return { accepted: true, entryId: userEntry.entryId, agentId };
}
