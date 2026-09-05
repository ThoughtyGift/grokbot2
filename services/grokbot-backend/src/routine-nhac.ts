/**
 * Bot NÓI khi người dùng bấm trên bảng Routine — đo từ app gốc 0.43 (cache client, bot "dr eggbot", 05/09):
 *
 *     ⚙ Disabled routine · transcript-healthcheck
 *     ⚙ Enabled routine  · transcript-healthcheck
 *     BOT  btw `transcript-healthcheck` vừa bị tắt (paused). muốn bật lại không?
 *     ⚙ Updated routine  · transcript-healthcheck
 *     BOT  ok — `transcript-healthcheck` đã bật lại, giờ fire weekdays 8:44 và mỗi ngày 00:15 local.
 *
 * Tức mỗi thao tác trên bảng (bật · tắt · sửa · tạo · xoá) vừa để lại một hàng sự kiện, vừa làm bot lên tiếng
 * MỘT câu — không phải câu chat của người dùng, không có tin người dùng nào trong bản ghi. Bên ta hàng sự kiện đã có
 * (`pushTranscriptEvent`), phần "bot lên tiếng" là file này: gom các thao tác dồn dập trong một nhịp ngắn (bấm bật rồi
 * sửa lịch ngay — app gốc cũng trả một câu cho cả hai), rồi gửi một lời nhắc IM LẶNG (`silent: true`) cho lượt kế.
 *
 * Chỉ gọi từ CỔNG GATEWAY (thao tác của người dùng trên giao diện). Bot tự sửa routine bằng tool thì nó đã đang nói
 * về việc ấy — nhắc nữa là nó tự trả lời chính mình.
 *
 * Tách khỏi `automations.ts` để bài test tiêm `gui`/`dangChay` giả và đo được nhịp gom, không cần kho thật.
 */

export type HanhDongRoutine = "created" | "updated" | "deleted" | "enabled" | "disabled";

export interface ThayDoiRoutine {
  action: HanhDongRoutine;
  name: string;
  /** Mô tả lịch/kích hoạt đọc được (từ `describe(trigger)`), nếu còn routine. */
  lich?: string;
}

const DONG_TU: Record<HanhDongRoutine, string> = {
  created: "TẠO",
  updated: "SỬA",
  deleted: "XOÁ",
  enabled: "BẬT lại",
  disabled: "TẮT (tạm dừng)",
};

const GOI_Y: Record<HanhDongRoutine, string> = {
  created: "xác nhận routine mới và lịch chạy của nó",
  updated: "nói lại lịch hoặc nội dung MỚI trong một câu",
  deleted: "ghi nhận đã xoá, không tiếc nuối",
  enabled: "xác nhận đã bật và nói lại lịch chạy",
  disabled: "xác nhận nó đang tạm dừng và hỏi có muốn bật lại không",
};

/** Lời nhắc im lặng cho một nhịp thao tác — thuần, để test đọc nguyên văn. */
export function soanLoiNhac(ds: readonly ThayDoiRoutine[]): string {
  if (ds.length === 0) return "";
  const dong = ds.map((d) => `- ${DONG_TU[d.action]} routine "${d.name}"${d.lich ? ` (${d.lich})` : ""}`);
  const cuoi = ds[ds.length - 1];
  return [
    "[Bảng Routine — thao tác của người dùng trên giao diện, KHÔNG phải câu chat; không có tin nào của họ trong hội thoại]",
    `Người dùng vừa:`,
    ...dong,
    "",
    `Trả lời đúng MỘT câu ngắn, giọng như đang nói chuyện, tên routine để trong dấu \`: ${GOI_Y[cuoi.action]}.`,
    "Không gọi công cụ, không hỏi gì ngoài câu đó, không kể lại toàn bộ nội dung routine.",
  ].join("\n");
}

export interface NguoiNhacOpts {
  /** Gửi lời nhắc im lặng cho bot — ở gateway là `sendPrompt({agentId, content, silent:true})`. */
  gui: (agentId: string, content: string) => void;
  /** Bot đang giữa lượt? Gửi lúc đó là cắt lượt của họ — chờ. */
  dangChay: (agentId: string) => boolean;
  /** Nhịp gom (ms). App gốc trả một câu cho cả "bật + sửa" cách nhau vài giây. */
  treMs?: number;
  /** Chờ bot rảnh tối đa (ms) rồi bỏ — một lượt dài 10 phút thì câu "vừa tắt routine" đã hết ý nghĩa. */
  choToiDaMs?: number;
  setTimeoutFn?: typeof setTimeout;
}

/**
 * Tạo người nhắc: `ghi(agentId, thayDoi)` mỗi thao tác; sau `treMs` không có gì thêm thì gửi một lời nhắc gom.
 */
export function taoNguoiNhac(o: NguoiNhacOpts): { ghi: (agentId: string, d: ThayDoiRoutine) => void; dangCho: (agentId: string) => number } {
  const treMs = o.treMs ?? 1500;
  const choToiDaMs = o.choToiDaMs ?? 60_000;
  const st = o.setTimeoutFn ?? setTimeout;
  const hang = new Map<string, { ds: ThayDoiRoutine[]; batDauCho: number }>();
  const xa = (agentId: string): void => {
    const h = hang.get(agentId);
    if (!h) return;
    if (o.dangChay(agentId)) {
      if (Date.now() - h.batDauCho > choToiDaMs) { hang.delete(agentId); return; }
      st(() => xa(agentId), treMs);
      return;
    }
    hang.delete(agentId);
    o.gui(agentId, soanLoiNhac(h.ds));
  };
  return {
    ghi(agentId, d) {
      const h = hang.get(agentId);
      if (h) { h.ds.push(d); return; }   // đã có hẹn — nhập vào cùng nhịp, hẹn cũ sẽ gửi cả hai
      hang.set(agentId, { ds: [d], batDauCho: Date.now() });
      st(() => xa(agentId), treMs);
    },
    dangCho: (agentId) => hang.get(agentId)?.ds.length ?? 0,
  };
}
