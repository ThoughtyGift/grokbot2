/**
 * Đồng hồ lệnh gateway — đo bằng đồng hồ giả, không chờ thật.
 *
 *   npx tsx --test packages/cursor-acl/src/lenh-cham.test.ts
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { taoDongHoLenh } from "./lenh-cham.js";

function dungGia() {
  let t = 1_000;
  const timers: { fn: () => void; at: number; id: number }[] = [];
  let id = 0;
  return {
    now: () => t,
    tick(ms: number) {
      t += ms;
      for (const x of [...timers].sort((a, b) => a.at - b.at)) {
        if (x.at <= t) { timers.splice(timers.indexOf(x), 1); x.fn(); }
      }
    },
    setTimer: (fn: () => void, ms: number) => { const h = { fn, at: t + ms, id: ++id }; timers.push(h); return h; },
    clearTimer: (h: unknown) => { const i = timers.indexOf(h as never); if (i >= 0) timers.splice(i, 1); },
  };
}

test("lệnh nhanh: đếm n, maxMs, không log", () => {
  const g = dungGia(); const logs: string[] = [];
  const d = taoDongHoLenh({ ...g, log: (l) => logs.push(l) });
  const xong = d.batDau("getAgentTranscriptTail");
  g.tick(120); xong();
  assert.deepEqual(d.snapshot().getAgentTranscriptTail, { n: 1, maxMs: 120, cham: 0, treo: 0 });
  assert.deepEqual(logs, []);
});

test("lệnh chậm hơn slowMs: một dòng log, đếm `cham`", () => {
  const g = dungGia(); const logs: string[] = [];
  const d = taoDongHoLenh({ ...g, slowMs: 5_000, log: (l) => logs.push(l) });
  const xong = d.batDau("sendPrompt");
  g.tick(7_000); xong();
  const s = d.snapshot().sendPrompt;
  assert.equal(s.cham, 1); assert.equal(s.maxMs, 7_000); assert.equal(s.lastSlowAtMs, 8_000);
  assert.match(logs[0], /sendPrompt chậm: 7000 ms/);
});

test("lệnh chưa về sau stuckMs: kêu NGAY lúc ấy, về rồi thì trừ `treo` và nói đã về", () => {
  const g = dungGia(); const logs: string[] = [];
  const d = taoDongHoLenh({ ...g, stuckMs: 30_000, log: (l) => logs.push(l) });
  const xong = d.batDau("getAgentTranscriptTail");
  g.tick(30_000);
  assert.equal(d.snapshot().getAgentTranscriptTail.treo, 1);
  assert.match(logs[0], /getAgentTranscriptTail CHƯA VỀ sau 30 s/);
  g.tick(5_000); xong();
  assert.equal(d.snapshot().getAgentTranscriptTail.treo, 0);
  assert.match(logs[1], /đã về sau 35000 ms/);
  assert.equal(logs.length, 2);
});

test("xong() gọi hai lần chỉ tính một; lệnh về trước stuckMs thì không bao giờ báo treo", () => {
  const g = dungGia(); const logs: string[] = [];
  const d = taoDongHoLenh({ ...g, log: (l) => logs.push(l) });
  const xong = d.batDau("listAgents");
  g.tick(10); xong(); xong();
  g.tick(60_000);
  assert.deepEqual(d.snapshot().listAgents, { n: 1, maxMs: 10, cham: 0, treo: 0 });
  assert.deepEqual(logs, []);
});
