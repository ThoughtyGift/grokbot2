/**
 * Trần số lượt chạy CÙNG LÚC của một người — việc cuối còn mở của roadmap đa người dùng.
 *
 * Vì sao cần. `inflight` khoá theo `agentId` (`chat/state.ts`), nên nó chặn được "hai lượt cùng
 * viết vào một bot" và **không chặn gì** ở tầng người: một chủ có 10 bot thì mở được 10 lượt song
 * song, mỗi lượt là một lời gọi pool thật. Suốt thời gian backend còn `GROKBOT2_AUTH=off` thì điều
 * đó vô hại vì mọi request đều là một danh tính duy nhất. Từ 07/09 `enforce` đã bật và vé riêng
 * theo từng người có hiệu lực, nên "nhiều người" thành chuyện đo được — và không ai giữ cửa.
 *
 * Vì sao là MODULE RIÊNG. `turn.ts` kéo cả pool lẫn box lẫn kho SQLite, nên một bài đo nạp nó là
 * nạp cả hệ (bẫy "bộ test xoá kho thật", bảng theo dõi §7). Phép đếm ở đây thuần và **tiêm được**
 * hai nguồn của nó, đúng nếp `chep-tep.ts`: bài đo dựng lấy chủ và danh sách đang chạy, không cần
 * kho nào.
 *
 * Vì sao mặc định 4. Chính dự án này dựng "đội" 4 bot con mỗi con một routine (bảng theo dõi §2),
 * nên 4 là số lượt song song CÓ THẬT mà một người tạo ra trong thiết kế của mình; chặn dưới mức đó
 * là chặn một tính năng đang chạy đúng. `GROKBOT2_MAX_TURNS_PER_USER=0` tắt hẳn.
 *
 * Cái trần này KHÔNG áp cho lượt nối tiếp. Nó được gọi từ `startTurn`, còn `continueAfterTool` và
 * nhánh thử-lại gọi thẳng `runTurn` (bảng theo dõi §7) — nên một lượt đã bắt đầu thì luôn chạy hết,
 * không bị cắt giữa đường vì một bot khác của cùng chủ vừa khởi động.
 */

/** 0 hoặc số không hợp lệ = tắt. Đọc lúc GỌI để bài đo đổi được mà không nạp lại module. */
export const tranLuotMoiNguoi = (): number => {
  const n = Number(process.env.GROKBOT2_MAX_TURNS_PER_USER ?? 4);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

export interface KetQuaTran {
  /** Có phải từ chối lượt này không. */
  qua: boolean;
  /** Số lượt của cùng chủ đang chạy, KHÔNG tính bot đang gửi. */
  dang: number;
  /** Trần đang áp; 0 nghĩa là tắt. */
  tran: number;
}

/**
 * Chủ của `agentId` đang có bao nhiêu lượt khác chạy, và thế đã quá trần chưa.
 *
 * `agentId` tự loại khỏi phép đếm, và đó là điều kiện đúng đắn chứ không phải tiểu tiết: khi
 * `startTurn` chạy thì `sendPrompt` ĐÃ đặt controller cho chính bot ấy vào `inflight` (nó vừa
 * `abort()` lượt cũ của cùng bot). Đếm cả nó thì trần 1 sẽ chặn mọi lượt đầu tiên — một cái trần
 * tự đóng cửa với chính người mở nó.
 */
export function quaTranLuot(
  agentId: string,
  chuCua: (id: string) => string,
  dangChay: Iterable<string>,
): KetQuaTran {
  const tran = tranLuotMoiNguoi();
  if (tran <= 0) return { qua: false, dang: 0, tran: 0 };
  const chu = chuCua(agentId);
  let dang = 0;
  for (const id of dangChay) {
    if (id === agentId) continue;
    if (chuCua(id) === chu) dang++;
  }
  return { qua: dang >= tran, dang, tran };
}

/** Câu nói cho NGƯỜI DÙNG, không phải cho quản trị viên — và phải có lối đi tiếp. */
export const cauQuaTran = (k: KetQuaTran): string =>
  `Bạn đang có ${k.dang} lượt chạy cùng lúc, trần là ${k.tran}. `
  + `Lượt này chưa gửi đi — chờ một lượt xong rồi gửi lại, hoặc bấm dừng ở một bot đang chạy.`;
