/**
 * Thẻ **On-Demand** trong Settings → Usage & Billing nói tiếng của MÌNH, không nói tiếng của hãng.
 *
 * Vì sao cần: backend đã phát được `SandOnDemandSettings` (field 13 của `GetSandUsageStatus`) với
 * `dashboard_url` trỏ trang gói của mình. Nhưng CHỮ trên thẻ thì nướng trong renderer, backend
 * không với tới. Đo sống 09/09 trên client `0.43.20260907` với `GROKBOT2_CHECKOUT_URL` đặt tạm —
 * pane vẽ đúng ba dòng này:
 *
 *     On-Demand
 *     Enable on-demand spend in the Cursor dashboard. A credit card may be required.
 *     [ Open Cursor Dashboard ]
 *
 * Tức link đúng mà chữ sai: người dùng của mình được bảo đi sang dashboard của Cursor. Nên bật khối
 * ấy mà không có bản vá này là một quyết định sản phẩm tồi, và hai thứ phải đi cùng một lần phát hành.
 *
 * ── VÌ SAO VÁ THÀNH PHẦN CHỨ KHÔNG VÁ CATALOG ────────────────────────────────────────────────
 * Ba chuỗi ấy là ba khoá i18n, và chúng sống trong **26 catalog ngôn ngữ** (0.43; 0.29 có 16): bản
 * tiếng Anh nằm trong `index-<băm>.js`, các bản còn lại mỗi ngôn ngữ một `chunk-settings-<băm>.js`
 * — tiếng Việt ở `chunk-settings-DO_VEBcd.js` đã có sẵn câu *"Mở bảng điều khiển Cursor"*. Vá theo
 * catalog là **104 chuỗi cứng**, mỗi chuỗi một bản dịch khác nhau, kể cả tiếng Ả Rập và Hebrew — và
 * 26 tên tệp mang băm nội dung phải trỏ lại sau MỖI lần hãng dựng lại.
 *
 * Vá tại nơi TIÊU THỤ thì chỉ còn **một tệp và ba neo** mỗi bản client, và nó độc lập ngôn ngữ: mọi
 * locale đều nhận chữ của mình. Giá phải trả, nói thẳng: chữ của mình chỉ có MỘT thứ tiếng, nên
 * người dùng locale khác thấy tiếng Việt. Với cinai thì đó là đánh đổi đúng chiều; nếu một ngày cần
 * đa ngữ thật thì chỗ làm là catalog, không phải đây.
 *
 * Đo trước khi viết (không đoán): mỗi neo xuất hiện **đúng 1 lần trong đúng 1 tệp** của bundle bản
 * ấy, và **0 lần** trong bundle bản kia — nên `split(find).join(replace)` không trượt sang chỗ nào,
 * và `pickVariant` không thể chọn nhầm biến thể.
 *
 * ── BA BẢN CLIENT, ĐO NGÀY 09/09 ─────────────────────────────────────────────────────────────
 *
 *   0.20 (`C:\cai`)      không có thẻ On-Demand: 0/102 tệp renderer nhắc `AHtE5A|zXR11a|wTN8Sv`,
 *                        cũng không có `sand_on_demand_settings` ⇒ `obsoleteWhenMissing`.
 *   0.29 (`C:\cai029`)   `usage-pane-DQtI9FZx.js`      — `i({id:…})`, `a.jsx(O,{id:…})`
 *   0.43 (`C:\cai043`)   `chunk-usage-pane-Ddtsn1Jl.js`— `l({id:…})`, `n.jsx(R,{id:…})`
 *
 * Cùng một pane, cùng bốn cổng (`!p||n===null||!n.visible||!n.eligible`), chỉ tên rút gọn đổi —
 * đúng lý do `variants` tồn tại (xem chú thích `pickVariant` trong `patch-client.mjs`).
 *
 * ── GIÒN Ở ĐÂU, VÀ MỘT CHỖ `--verify` KHÔNG BẮT ĐƯỢC ─────────────────────────────────────────
 * Tên tệp renderer **mang băm nội dung**, nên một lần hãng dựng lại là hai tên dưới đây không còn
 * tồn tại. Chỗ đáng biết: lúc ấy `--verify` **KHÔNG đỏ**. Nó duyệt `targetsOf(p)`, bỏ qua mọi tệp
 * vắng mặt, rồi rơi vào nhánh `obsoleteWhenMissing` và in một dòng **xanh**. Cùng họ với bẫy
 * *"`--verify` mù với thân đã đổi"* (bảng theo dõi §7, 08/09): một cửa kiểm xanh vì nó không nhìn.
 * Nên câu `obsoleteWhenMissing` dưới đây tự mang lời cảnh báo — thấy nó in ra khi đang vá 0.29/0.43
 * thì việc phải làm là TRỎ LẠI tên tệp, không phải mừng.
 *
 * Ba neo `{id:"…"}` thì bền hơn nhiều: khoá i18n là hằng của mã nguồn, không phải của bản dựng.
 *
 * Đổi câu chữ = sửa ba hằng dưới đây rồi PHÁT HÀNH lại; không có đường nào đưa chữ mới tới máy đã
 * cài mà không qua một lần phát hành (bộ cài chở-app là bản tự chứa, không có asar để vá đè).
 */

/** Nút. Của hãng: "Open Cursor Dashboard". */
const NUT = "Mở trang gói cinai";

/**
 * Hai câu mô tả, chọn theo `enabled` của `SandOnDemandSettings`.
 *
 * Backend hiện luôn gửi `enabled:false` (ta không có cơ chế on-demand nào của riêng mình), nên câu
 * thực tế người dùng thấy là `TAT`. `BAT` viết sẵn cho ngày `enabled` lấy được từ cinapi — để nhánh
 * kia không rơi lại về chữ của hãng.
 */
const TAT = "Quản lý gói và mức dùng thêm tại cinai.app.";
const BAT = "Mức dùng thêm tính theo gói cinai. Quản lý giới hạn tại cinai.app.";

const FILE_029 = "dist/renderer/assets/usage-pane-DQtI9FZx.js";
const FILE_043 = "dist/renderer/assets/chunk-usage-pane-Ddtsn1Jl.js";

const KHONG_CO =
  "0.20 chưa có thẻ On-Demand. Trên 0.29/0.43 dòng này KHÔNG được xuất hiện — " +
  "nó có nghĩa tên tệp chunk đã đổi theo băm nội dung, phải trỏ lại `file`";

/**
 * Một bản vá cho mỗi neo — `variants` là để phân biệt PHIÊN BẢN client, không phải để gộp nhiều
 * phép thay trong một id (xem `computer-tab.mjs`, cũng là một mảng vì cùng lý do).
 *
 * `chu` đi qua `JSON.stringify` thành một chuỗi literal: chỗ bị thay là một BIỂU THỨC (lời gọi hàm
 * dịch, hoặc một phần tử React), và cả hai chỗ tiêu thụ đều nhận chuỗi — `description:` của thẻ và
 * `children:` của nút (đo cả hai bản, 09/09). Viết chữ trần không có nháy là bundle hỏng cú pháp.
 */
const the = (id, chu, neo029, neo043) => {
  const marker = `/*grokbot2:${id}*/`;
  const replace = `${marker}${JSON.stringify(chu)}`;
  return {
    id,
    summary: `thẻ On-Demand: ${id.replace("on-demand-", "")} nói tiếng của mình`,
    obsoleteWhenMissing: KHONG_CO,
    variants: [
      { version: "0.29.0", file: FILE_029, find: neo029, expected: 1, replace, marker },
      { version: "0.43.0", file: FILE_043, find: neo043, expected: 1, replace, marker },
    ],
  };
};

export default [
  /*
   * `f = n.enabled ? <dịch>({id:"AHtE5A"}) : <dịch>({id:"zXR11a"})`, rồi `description: f` — hàm dịch
   * trả về chuỗi, nên thay cả lời gọi bằng một chuỗi literal là đúng kiểu, không đổi hình biểu thức.
   */
  the("on-demand-mo-ta-bat", BAT, 'i({id:"AHtE5A"})', 'l({id:"AHtE5A"})'),
  the("on-demand-mo-ta-tat", TAT, 'i({id:"zXR11a"})', 'l({id:"zXR11a"})'),
  /*
   * `d = <jsx>(<Trans>, {id:"wTN8Sv"})` rồi `children: d` trên nút pill. Thay cả phần tử bằng một
   * chuỗi vẫn hợp lệ vì React nhận chuỗi làm children.
   */
  the("on-demand-nut", NUT, 'a.jsx(O,{id:"wTN8Sv"})', 'n.jsx(R,{id:"wTN8Sv"})'),
];
