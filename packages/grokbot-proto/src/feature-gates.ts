/**
 * `AnalyticsService/BootstrapStatsig` — cửa mà client hỏi để biết **tính năng nào được bật**.
 *
 * Đây là chỗ "Teach a task" đã biến mất, và nó chưa bao giờ có mặt. Trong chính bản dựng của
 * client, nút Teach nằm sau một cổng tính năng:
 *
 *     function hEe(){ return ds(rt().experiments.snapshots)?.featureGates
 *                       ?.sand_teach_by_demonstration ?? false }
 *
 * và cái "+" cạnh ô nhập chỉ **mở ra menu** (Attach file / Teach a task) khi cổng đó bật:
 *
 *     const P = t && (!S || f == null);          // S = hEe()
 *     _ = S && f != null ? {} : { onClick: m };  // cổng tắt ⇒ "+" là nút đính kèm, không có menu
 *
 * Cổng lấy giá trị từ tiến trình chính, và tiến trình chính lấy từ **backend của ta**:
 *
 *     fetch(new URL("aiserver.v1.AnalyticsService/BootstrapStatsig", backendUrl), {method:"POST"})
 *       → { config: "<chuỗi JSON bootstrap của Statsig>" }
 *
 * Backend cũ rơi vào nhánh mặc định của `handleBootstrapRpc` và trả `{}` — đúng 200, nhưng
 * **không có khoá `config`**, nên client bỏ qua, không dựng được Statsig, và mọi cổng rơi về mặc
 * định đóng gói sẵn. `sand_teach_by_demonstration` mặc định là `false`. Đo được: `curl` vào
 * `:8788/aiserver.v1.AnalyticsService/BootstrapStatsig` trả đúng hai ký tự `{}`.
 *
 * Vì sao không sửa bằng biến môi trường: client CÓ đọc `SAND_FEATURE_GATE_OVERRIDES`, nhưng chỉ
 * khi `canUseFeatureFlagOverrides()` — tức bản dev hoặc tài khoản nội bộ của hãng. Bản ta chạy
 * không phải cả hai, nên biến đó bị bỏ qua. Trả `config` mới là đường của hợp đồng.
 */

/**
 * Cổng bật sẵn — **chỉ những gì backend này làm được thật**.
 *
 * Bật một cổng cho tính năng chưa có phía máy chủ là vẽ ra một nút bấm vào thì hỏng, nên danh
 * sách này ngắn có chủ ý. `startTeachRecording`/`stopTeachRecording`/`getTeachRecordingStatus` đã
 * có trong `packages/cursor-acl/src/commands.ts` và `services/grokbot-backend/src/teach.ts`.
 */
const DEFAULT_GATES: Readonly<Record<string, boolean>> = {
  sand_teach_by_demonstration: true,
  /*
   * Mục `Settings → Usage & Billing`. Renderer lọc mục "usage" ra khỏi Settings khi cổng này đóng
   * (`yrn()`: `ZL.filter(o => o.id === "usage" ? sand_usage_page && … : …)`), nên thiếu nó thì mọi
   * thứ phía sau vô hình dù đúng đến đâu. Bật được vì phía máy chủ có thật từ 02/09: billing
   * `enforce` chạy, `GetCurrentPeriodUsage` + `GetSandUsageStatus` trả số từ bảng `usage`/`plans`.
   * Luồng đã trích + ánh xạ: docs/plan/usage-billing-page.md.
   */
  sand_usage_page: true,
  /*
   * Bảng `Settings → Computer` — máy THẬT của người dùng.
   *
   * Gốc của bảng đó chỉ vẽ mục *Computers* khi cả ba điều kiện đúng, đọc từ renderer:
   *
   *     e.cursorAuth.status.kind === "logged-in" && ke("sand_multi_machine_local_exec") && i
   *
   * Ta đã đăng nhập, nên cờ này là thứ duy nhất còn thiếu — và đó là lý do bảng Computer bên ta
   * trống trơn trong khi app gốc hiện `DESKTOP-7D2FJG8`.
   *
   * Bật SAU khi đường ống thông, đúng luật của tệp này ("chỉ những gì backend làm được thật"):
   * daemon nhận việc qua SSE, `local_shell` chạy được lệnh (`hostname` → `DESKTOP-7D2FJG8`),
   * `local_read` đọc được tệp, và cả hai đi qua thẻ xin quyền không có đường tắt.
   */
  sand_multi_machine_local_exec: true,
  /*
   * Marketplace → tab **Bots** và nút **Share as template** (client 0.43).
   *
   * Renderer 0.43 chỉ tải danh sách bot cộng đồng khi `sand_marketplace_bots_v2` bật (`cyt()`:
   * `featureGates?.sand_marketplace_bots_v2!==!0 ? Promise.resolve() : botMarketplace.preload()`), và
   * nút chia sẻ mẫu đọc `sand_share_bot` (+ menu ở header `sand_header_template_share_menu`). Mặc định
   * hãng là TẮT — trên máy chủ này bật được vì phía sau có thật (05/09): kho listing + hồ sơ người tạo
   * (`marketplace.ts`), RPC `ListPublicGrokBotMarketplaceListings` / `GetGrokBotTemplateImportDetails`,
   * blob recipe, và `getHostStatus.capabilities` mang `botTemplateJsonShareV1`. Đo: `scripts/e2e-marketplace.mjs`.
   */
  sand_marketplace_bots_v2: true,
  sand_share_bot: true,
  sand_header_template_share_menu: true,
};

/**
 * `GROKBOT2_FEATURE_GATES="a=1,b=0"` — mở/đóng thêm cổng mà không phải dựng lại.
 *
 * Tên cổng không có trong bản dựng thì client lặng lẽ bỏ qua (`computeSnapshot` chỉ duyệt các
 * khoá nó biết), nên gõ sai một tên là vô hại chứ không làm hỏng cái gì.
 */
function envGates(): Record<string, boolean> {
  const raw = (process.env.GROKBOT2_FEATURE_GATES ?? "").trim();
  if (!raw) return {};
  const out: Record<string, boolean> = {};
  for (const part of raw.split(",")) {
    const [name, value] = part.split("=", 2).map((s) => s.trim());
    if (name) out[name] = value === "1" || value === "true" || value === "on";
  }
  return out;
}

/**
 * Chuỗi bootstrap mà `StatsigClient.dataAdapter.setData()` ăn được.
 *
 * Hai chi tiết phải đúng, đọc từ SDK nhúng trong bản dựng:
 *
 *  - **Không** đặt `response_format`. `setValues` chọn `V2InitializeContainer` khi
 *    `response_format === "init-v2"`, còn lại dùng V1 — và chỉ V1 tra cứu bằng **tên trần**
 *    (`e[name] ?? e[_DJB2(name)]`). Với V2 thì tên phải băm sẵn, tức là ta phải nhúng thuật toán
 *    băm của họ vào đây để đổi một chữ `true`.
 *  - `has_updates: true` và `time` phải ≥ mốc hiện có, nếu không `setValues` bỏ nguyên gói.
 *
 * `user` cũng nằm trong chuỗi này chứ không phải tham số riêng: tiến trình chính đọc lại chính nó
 * (`JSON.parse(config).user ?? {}`) để dựng StatsigUser.
 */
export function statsigBootstrapConfig(userId: string, nowMs = Date.now()): string {
  const gates = { ...DEFAULT_GATES, ...envGates() };
  const featureGates: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(gates)) {
    featureGates[name] = { name, value, rule_id: "grokbot2", secondary_exposures: [] };
  }
  return JSON.stringify({
    has_updates: true,
    time: nowMs,
    hash_used: "none",
    user: { userID: userId },
    evaluated_keys: { userID: userId },
    feature_gates: featureGates,
    dynamic_configs: {},
    layer_configs: {},
    sdkParams: {},
    derived_fields: {},
    generator: "grokbot2",
  });
}

/** Thân câu trả lời của `BootstrapStatsig`: một khoá `config` mang chuỗi ở trên. */
export function bootstrapStatsigJson(userId: string): string {
  return JSON.stringify({ config: statsigBootstrapConfig(userId) });
}
