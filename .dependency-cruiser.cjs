/**
 * Luật phụ thuộc giữa các gói — và nguồn của sơ đồ kiến trúc.
 *
 *   pnpm arch:check    kiểm luật (đỏ nếu vi phạm)
 *   pnpm arch:graph    vẽ lại sơ đồ vào docs/architecture/
 *
 * ── Vì sao có file này ──────────────────────────────────────────────────────────────────────────
 *
 * `docs/architecture.md` sửa lần cuối 25/08, `docs/architecture/coupling-inventory.md` 22/08, còn
 * `services/grokbot-backend/src` thì sửa hôm nay. Sơ đồ vẽ tay **trễ 6–9 ngày** so với thứ đang
 * chạy — đúng cái bệnh mà `scripts/trang-thai.mjs` đã chẩn cho tài liệu trạng thái ("ba nguồn sự
 * thật thì luôn có ít nhất hai cái sai"), chỉ là chưa ai áp cho sơ đồ.
 *
 * Nên: sơ đồ do MÁY vẽ từ import thật, và ranh giới kiến trúc thành luật máy đỏ được — thay vì một
 * bảng markdown mà người đọc phải tin.
 *
 * Không chọn MCP cho việc này dù có vài cái: đây là CLI, tốn 0 token ngữ cảnh mỗi lượt, còn repo
 * đã nạp sẵn 9 MCP.
 */
module.exports = {
  forbidden: [
    /*
     * ── Ranh giới thật của repo này ────────────────────────────────────────────────────────────
     *
     * `@grokbot2/cursor-acl` là lớp CHỐNG NHIỄM (anti-corruption): mọi thứ biết tên lệnh của
     * Cursor sống trong đó, và nó gọi ngược ra ngoài **chỉ qua `ports.ts`**. Hôm nay ranh giới ấy
     * sạch — đo 31/08, không file nào trong `packages/cursor-acl/src` import `services/`. Luật này
     * không sửa gì; nó KHOÁ hiện trạng lại trước khi ai đó vô tình phá.
     *
     * Phá thì hỏng ra sao: ACL nhập luôn kiểu của backend là hai bên dính nhau, và cái giá phải
     * trả muộn hơn nhiều — lúc muốn đổi backend mà không đổi được phương ngữ client.
     */
    {
      name: "acl-khong-goi-nguoc-backend",
      severity: "error",
      comment:
        "packages/cursor-acl là lớp chống nhiễm: nó chỉ được gọi ra ngoài qua ports.ts. " +
        "Import thẳng services/ là làm hai bên dính nhau — xem packages/cursor-acl/src/index.ts.",
      from: { path: "^packages/cursor-acl/src" },
      to: { path: "^services/" },
    },
    {
      name: "proto-khong-goi-nguoc",
      severity: "error",
      comment:
        "packages/grokbot-proto chỉ mã hoá/giải mã protobuf. Nó không được biết gì về backend hay " +
        "về ACL — biết là nó thành nơi thứ hai chứa logic nghiệp vụ.",
      from: { path: "^packages/grokbot-proto/src" },
      to: { path: "^(services/|packages/cursor-acl)" },
    },

    /*
     * ── Luật chung, nhưng có lý do cụ thể ở repo này ───────────────────────────────────────────
     */
    {
      name: "khong-vong-tron",
      severity: "error",
      comment:
        "Import vòng tròn. Repo này đã trả giá một lần cho họ hàng của nó: `anh-cho-client.ts` " +
        "cần hàng rào `isInternalHost` của `tools.ts`, và nếu tools.ts cũng import ngược lại thì " +
        "cả hai module cùng nửa-khởi-tạo, hỏng theo cách chỉ lộ ra lúc chạy.",
      from: {},
      to: { circular: true },
    },
    {
      name: "khong-import-file-khong-ton-tai",
      severity: "error",
      comment: "Đường dẫn không giải được — thường là đổi tên file mà quên sửa chỗ gọi.",
      from: {},
      to: {
        couldNotResolve: true,
        /*
         * `@electron/asar` CỐ Ý không nằm trong dependencies.
         *
         * Chỉ hai script dò dùng nó, và chỉ khi người ta chạy tay để trích bundle của hãng —
         * `patch-client.mjs` tự lấy qua `npx` ở lần dùng đầu. Đưa nó thành dependency thật là bắt
         * mọi máy cài bộ giải asar cho một việc hiếm; giữ nguyên và ghi lý do ở đây thì rẻ hơn.
         */
        pathNot: "^@electron/asar$",
      },
    },
    {
      name: "khong-dung-devDependency-trong-ma-chay",
      severity: "error",
      comment:
        "Mã chạy thật không được import gói chỉ có trong devDependencies: máy dev thì chạy, máy " +
        "cài từ bộ cài thì chết — và chết ở nơi không ai chạy test.",
      from: { path: "^(services|packages)/.+/src", pathNot: "\\.test\\.ts$" },
      to: { dependencyTypes: ["npm-dev"] },
    },
  ],

  options: {
    doNotFollow: { path: "node_modules" },

    /*
     * Bỏ qua: bản dựng, dữ liệu, và mọi thứ không phải mã nguồn của mình.
     *
     * `dist` phải bỏ vì workspace package trỏ tới `dist/` — không bỏ thì mỗi cạnh xuất hiện hai
     * lần, một qua nguồn một qua bản dựng, và sơ đồ đọc thành mớ bòng bong.
     */
    exclude: {
      path: "(^|/)(node_modules|dist|\\.turbo|\\.data|\\.venv-stt|coverage|docs|infra/patches)(/|$)",
    },

    /*
     * Sơ đồ chỉ vẽ mã CỦA MÌNH.
     *
     * Không giới hạn thì `fs`, `path`, `http`, `crypto`… chiếm nửa sơ đồ và đẩy bốn gói thật vào
     * một góc. Biết backend dùng `node:sqlite` là hữu ích, nhưng đó là việc của `package.json`,
     * không phải của một bức tranh dùng để nhìn ra ranh giới giữa các gói.
     *
     * Luật `forbidden` ở trên KHÔNG bị ảnh hưởng: chúng chạy trên toàn bộ đồ thị, kể cả phần bị
     * loại khỏi hình — nên "không dùng devDependency trong mã chạy" vẫn bắt được.
     */
    includeOnly: { path: "^(apps|packages|services)/" },

    // `tsconfig.depcruise.json` chứ không phải `tsconfig.base.json`: nó thêm `paths` trỏ gói
    // workspace về `src` thay vì `dist`. Lý do đầy đủ nằm trong chính file đó.
    tsConfig: { fileName: "tsconfig.depcruise.json" },
    tsPreCompilationDeps: true,

    /*
     * Repo là ESM với đuôi `.js` trong import — dep-cruiser cần biết để nối `.js` về `.ts`.
     *
     * `mainFields` đặt `source` lên TRƯỚC `main` vì một lý do làm sơ đồ SAI nếu bỏ qua: mỗi gói
     * workspace khai `main: "dist/index.js"`, mà `dist` thì bị `exclude`. Kết quả là cạnh
     * `services/grokbot-backend/src → packages/cursor-acl` BIẾN MẤT khỏi sơ đồ, dù `gateway.ts:10`
     * import nó thật. Một sơ đồ thiếu đúng cạnh quan trọng nhất còn tệ hơn không có sơ đồ — nó
     * trông đáng tin.
     *
     * Đo được 31/08: trước khi thêm dòng này, sơ đồ chỉ hiện `scripts → cursor-acl`, làm như backend
     * không hề dùng lớp chống nhiễm.
     */
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["source", "import", "require", "node", "default"],
      mainFields: ["source", "module", "main"],
      extensions: [".ts", ".mts", ".js", ".mjs", ".json"],
    },

    reporterOptions: {
      /*
       * `archi`: gom về mức ngay dưới `apps/ packages/ services/` — sơ đồ cấp KIẾN TRÚC, đọc được
       * trong một màn hình. Sơ đồ cấp file thì đúng nhưng không ai nhìn nổi: backend có 78 file.
       */
      archi: {
        collapsePattern: "^(apps|packages|services)/[^/]+/(src/[^/]+|[^/]+)",
      },
      dot: {
        collapsePattern: "^(apps|packages|services)/[^/]+",
      },
    },
  },
};
