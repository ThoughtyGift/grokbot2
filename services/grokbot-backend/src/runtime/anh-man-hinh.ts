/**
 * Ảnh màn hình nào đáng đưa vào bản ghi hội thoại, ảnh nào chỉ cần model nhìn.
 *
 * `computer_use` chụp lại sau mỗi hành động, vì model bấm theo toạ độ và "nhìn lại" là bước nó sẽ
 * quên. Nhưng mỗi tấm còn được ĐÍNH vào bản ghi, và bản ghi là thứ người đọc — nên sáu thao tác
 * thành sáu tấm trong một bong bóng chat. Người dùng nhìn thấy và hỏi "tại sao ra nhiều ảnh như
 * này" (30/08).
 *
 * Model thì không cần chúng: pool chở ĐÚNG MỘT ảnh mỗi request (xem `see` trong ToolCtx), nên chỉ
 * tấm cuối tới nơi. Năm tấm kia trả giá bên người mà không phục vụ ai.
 *
 * Nên tách hai câu hỏi: model luôn được nhìn (`see` mọi bước, rẻ), còn ĐÍNH thì có luật.
 *
 * ── Ba luật, mỗi luật một lý do ─────────────────────────────────────────────────────────────────
 *
 *   tấm ĐẦU của lượt         luôn đính — không có nó thì người không biết bot khởi hành từ đâu
 *   hành động HỎNG           luôn đính — đúng lúc người cần nhìn nhất
 *   còn lại                  đính khi màn hình đổi ĐÁNG KỂ so với tấm ĐÃ ĐÍNH gần nhất
 *
 * "Đáng kể" đo bằng độ dài JPEG. Đây là phép so thô, và tôi viết ra rằng nó thô: JPEG là luồng
 * entropy nên độ dài phản ánh lượng chi tiết chứ không phản ánh vị trí thay đổi. Đổi lại nó rẻ,
 * không cần thư viện giải nén nào, và bắt đúng thứ đáng bắt — gõ một chữ vào ô tìm kiếm gần như
 * không đổi độ dài, mở một cửa sổ mới thì đổi hẳn. Ngưỡng để ở đây, dạng số, để đo lại và chỉnh.
 *
 * So với tấm ĐÃ ĐÍNH chứ không phải tấm liền trước: màn hình trôi từng chút một qua mười bước thì
 * mỗi bước đều dưới ngưỡng, nhưng cộng dồn lại đã là một màn hình khác. Mốc phải là thứ người
 * đang nhìn, không phải thứ họ không thấy.
 */

/** Đổi quá bao nhiêu phần (theo độ dài JPEG) thì coi là màn hình đã khác. */
export const NGUONG_DOI = 0.04;

/** Bỏ qua tối đa bao nhiêu bước liên tiếp trước khi đính một tấm dù màn hình có vẻ đứng yên. */
export const TOI_DA_BO_QUA = 4;

type Moc = { doDaiDaDinh: number; boQua: number };

const moc = new Map<string, Moc>();

/**
 * Bắt đầu lại cho một lượt mới: tấm tiếp theo sẽ được đính dù giống hệt tấm cũ.
 *
 * Gọi khi một lượt mở ra. Không gọi thì hai lượt liền nhau dùng chung mốc, và lượt sau mở đầu
 * bằng im lặng — người vừa nhờ một việc mới mà không thấy gì.
 */
export const quenManHinh = (agentId: string): void => { moc.delete(agentId); };

/**
 * Ảnh này có nên nằm lại trong bản ghi không?
 *
 * `anhBase64` là phần dữ liệu (không tính tiền tố `data:`); chỉ ĐỘ DÀI của nó được dùng.
 */
export function nenDinhAnh(agentId: string, anhBase64: string, ket: { ok: boolean }): boolean {
  const cu = moc.get(agentId);
  const doDai = anhBase64.length;

  // Tấm đầu của lượt: luôn đính, và nó thành mốc.
  if (cu == null) {
    moc.set(agentId, { doDaiDaDinh: doDai, boQua: 0 });
    return true;
  }

  // Hỏng thì đính, nhưng KHÔNG dời mốc: ảnh lỗi thường là màn hình cũ y nguyên, lấy nó làm mốc
  // thì bước kế tiếp — bước sửa được lỗi — lại bị coi là "không đổi gì".
  if (!ket.ok) { cu.boQua = 0; return true; }

  const lech = Math.abs(doDai - cu.doDaiDaDinh) / Math.max(cu.doDaiDaDinh, 1);
  if (lech > NGUONG_DOI) {
    moc.set(agentId, { doDaiDaDinh: doDai, boQua: 0 });
    return true;
  }

  cu.boQua += 1;
  if (cu.boQua > TOI_DA_BO_QUA) {
    moc.set(agentId, { doDaiDaDinh: doDai, boQua: 0 });
    return true;
  }
  return false;
}
