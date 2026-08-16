/**
 * Transcript sequence numbers.
 *
 * The property that matters is STABILITY across calls, and it is invisible in a single
 * response: a positional seq looks perfectly well-formed until you fetch twice and compare.
 * That is why this bug survived every earlier suite.
 */
import { createAgent, sendPrompt, transcriptTail } from "../src/chat.ts";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${ok ? "" : `  ${String(detail).slice(0, 160)}`}`);
};
const seqOf = (page) => Object.fromEntries(page.entries.map((e) => [e.id, e.seq]));

const a = createAgent({ name: "SeqTest" });
// No pool key needed: the user entry lands synchronously, which is all this measures.
for (let i = 0; i < 4; i += 1) sendPrompt({ agentId: a.id, content: `msg ${i}` });

const first = transcriptTail({ id: a.id, limit: 500 });
check("entries came back", first.entries.length > 0, JSON.stringify(first).slice(0, 120));
check("every entry has a numeric seq", first.entries.every((e) => typeof e.seq === "number"));
check("seq increases with position", first.entries.every((e, i, arr) => i === 0 || e.seq > arr[i - 1].seq),
  first.entries.map((e) => e.seq).join(","));

console.log("\nstability — the whole point");
const before = seqOf(first);
const second = transcriptTail({ id: a.id, limit: 500 });
check("same seq on a second identical fetch",
  first.entries.every((e) => seqOf(second)[e.id] === before[e.id]),
  JSON.stringify(seqOf(second)));

// Add more, then re-read: existing entries must keep their numbers.
for (let i = 0; i < 3; i += 1) sendPrompt({ agentId: a.id, content: `later ${i}` });
const third = transcriptTail({ id: a.id, limit: 500 });
check("existing seq unchanged after new entries arrive",
  Object.entries(before).every(([id, s]) => seqOf(third)[id] === undefined || seqOf(third)[id] === s),
  JSON.stringify(seqOf(third)));
check("new entries got higher seq", Math.max(...third.entries.map((e) => e.seq)) > Math.max(...first.entries.map((e) => e.seq)));

console.log("\npaging still works");
const paged = transcriptTail({ id: a.id, limit: 3 });
check("a short page returns the newest entries", paged.entries.length === 3);
check("the page keeps the same seq values",
  paged.entries.every((e) => seqOf(third)[e.id] === e.seq),
  JSON.stringify(seqOf(paged)));
check("hasMore is set when older entries exist", paged.hasMore === true);
check("nextBeforeSeq points at the oldest of the page", paged.nextBeforeSeq === paged.entries[0].seq,
  `${paged.nextBeforeSeq} vs ${paged.entries[0].seq}`);

const older = transcriptTail({ id: a.id, limit: 3, beforeSeq: paged.nextBeforeSeq });
check("beforeSeq returns strictly older entries",
  older.entries.every((e) => e.seq < paged.entries[0].seq),
  `${older.entries.map((e) => e.seq).join(",")} vs ${paged.entries[0].seq}`);
check("paging does not renumber anything",
  older.entries.every((e) => seqOf(third)[e.id] === e.seq),
  JSON.stringify(seqOf(older)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
