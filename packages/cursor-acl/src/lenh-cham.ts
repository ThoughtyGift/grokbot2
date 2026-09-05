/**
 * Đồng hồ cho từng lệnh gateway — trả lời câu "backend có trả lời không, và mất bao lâu".
 *
 * Vì sao có nó (06/09/2026, bảng theo dõi §5 mục 19): bản ghi sống trên client 0.43 đứng một lần —
 * thẻ mới không lên màn dù SSE và `getAgentTranscriptTail` đều đủ. Client coi khung SSE là tiếng gõ
 * rồi tự tải đuôi, và trong lúc MỘT lượt tải chưa về thì mọi tiếng gõ sau chỉ ghi cờ. Nếu lượt tải ấy
 * không bao giờ về, pane đứng tới khi tải lại. Backend không có số nào để nói lượt ấy đã về hay chưa —
 * đây là con số đó. Không sửa hành vi, chỉ đo: ghi thời gian mỗi lệnh, kêu khi một lệnh quá chậm hoặc
 * chưa về sau `stuckMs`, và phơi bảng qua `GET /gw/__coverage` (khoá `cham`).
 */

export interface SoLenh {
  n: number;
  maxMs: number;
  /** số lượt vượt `slowMs` */
  cham: number;
  /** số lượt còn treo (đã báo "chưa về") — về được thì trừ lại */
  treo: number;
  lastSlowAtMs?: number;
}

export interface DongHoLenh {
  /** Gọi khi bắt đầu xử lý; trả hàm `xong()` phải gọi đúng một lần khi reply đã đi. */
  batDau(name: string): () => void;
  snapshot(): Record<string, SoLenh>;
}

export interface TuyChonDongHo {
  /** vượt ngưỡng này là một dòng log — mặc định 5 s */
  slowMs?: number;
  /** chưa về sau ngưỡng này là "treo": một dòng log ngay lúc ấy, không đợi tới khi về — mặc định 30 s */
  stuckMs?: number;
  log?: (line: string) => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

export function taoDongHoLenh(o: TuyChonDongHo = {}): DongHoLenh {
  const slowMs = o.slowMs ?? 5_000;
  const stuckMs = o.stuckMs ?? 30_000;
  const log = o.log ?? ((l) => console.warn(l));
  const now = o.now ?? Date.now;
  const setTimer = o.setTimer ?? ((fn, ms) => { const h = setTimeout(fn, ms); (h as { unref?: () => void }).unref?.(); return h; });
  const clearTimer = o.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const bang = new Map<string, SoLenh>();
  const cua = (name: string): SoLenh => bang.get(name) ?? (bang.set(name, { n: 0, maxMs: 0, cham: 0, treo: 0 }), bang.get(name)!);

  return {
    batDau(name) {
      const t0 = now();
      const s = cua(name);
      s.n += 1;
      let daBaoTreo = false;
      let daXong = false;
      const timer = setTimer(() => {
        if (daXong) return;
        daBaoTreo = true;
        s.treo += 1;
        log(`[gateway] ${name} CHƯA VỀ sau ${Math.round(stuckMs / 1000)} s — client 0.43 sẽ đứng bản ghi tới khi lượt này kết thúc`);
      }, stuckMs);
      return () => {
        if (daXong) return;
        daXong = true;
        clearTimer(timer);
        const ms = now() - t0;
        if (ms > s.maxMs) s.maxMs = ms;
        if (daBaoTreo) { s.treo -= 1; log(`[gateway] ${name} đã về sau ${ms} ms (từng báo treo)`); }
        else if (ms > slowMs) { s.cham += 1; s.lastSlowAtMs = now(); log(`[gateway] ${name} chậm: ${ms} ms`); }
      };
    },
    snapshot() {
      return Object.fromEntries([...bang].sort());
    },
  };
}
