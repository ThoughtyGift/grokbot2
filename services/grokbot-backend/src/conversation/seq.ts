import type { Entry } from "./types.js";

export const TOOL_ECHO = "🔧 ";
export const isToolEcho = (e: Entry): boolean =>
  e.kind === "send-message" && e.message.type === "text" && e.message.content.startsWith(TOOL_ECHO);

export const textOf = (e: Entry): string =>
  e.kind === "message" ? e.content : e.kind === "send-message" && e.message.type === "text" ? e.message.content : "";

export function ensureSeq(agentId: string | undefined, all: Entry[], persist?: () => void): (Entry & { seq: number })[] {
  let assigned = false;
  let prev = 0;
  for (const e of all) {
    if (typeof e.seq !== "number" || e.seq <= prev) {
      const fromId = /^e(\d+)$/.exec(e.id)?.[1];
      const n = fromId ? Number(fromId) : 0;
      e.seq = n > prev ? n : prev + 1;
      assigned = true;
    }
    prev = e.seq;
  }
  if (assigned && agentId) persist?.();
  return all as (Entry & { seq: number })[];
}
