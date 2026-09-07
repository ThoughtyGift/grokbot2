/**
 * Patch: bảng **Settings → Computer** đọc máy từ backend của mình, thay vì từ máy chủ của hãng.
 *
 * Người dùng nối máy Windows vào bot thành công — lệnh chạy thật, `hostname` trả `DESKTOP-7D2FJG8`
 * — nhưng bảng Computer vẫn trống trơn và trông y như "chưa kết nối". Nó trống vì bảng ấy chưa bao
 * giờ đi qua backend này. Hai cửa, cả hai đều của hãng, đọc thẳng từ bundle 0.29:
 *
 *   1. cờ thí nghiệm, mặc định TẮT:
 *
 *          sand_multi_machine_local_exec:{client:!0,default:!1}
 *
 *   2. và ngay cả khi cờ bật, `getMachines` đòi một tài khoản Cursor THẬT rồi gọi API hãng:
 *
 *          getMachines:i(async()=>{ … Ne(h.kind==="logged-in","Machine roster requires a signed-in
 *            account."); … return await listSandMachines(T=>p.getValidAccessToken(T), n.getTeamId, …) })
 *
 * Mình đăng nhập bằng auth của mình nên trượt ngay cửa đầu, renderer nhận `null`, và:
 *
 *          return a.length===0 ? null : a          ← rỗng thì bảng không vẽ gì
 *
 * ── Vì sao là HAI bản vá chứ không phải một ─────────────────────────────────────────────────────
 *
 * `patch-client.mjs` `break` ngay khi một bản vá khớp xong file đầu tiên (`applyOne`, dòng ~341).
 * Gộp cờ renderer và cầu IPC main vào cùng một `id` thì vá được file trước, bỏ im file sau — và
 * triệu chứng sẽ là "cờ bật, bảng vẫn trống", loại lỗi tốn cả buổi. Nên: hai `id`, cùng một câu
 * chuyện, để cạnh nhau trong một file.
 *
 * ── Giòn ở đâu ──────────────────────────────────────────────────────────────────────────────────
 *
 * Tên file renderer mang băm nội dung (`index-DO1aF_xy.js`) nên mỗi lần hãng dựng lại là tên đổi,
 * và bản vá gãy ĐỎ kèm đúng id của nó — cố ý, nhưng phải nhớ trỏ lại. `main.cjs` thì tên ổn định.
 * Tên hàm rút gọn (`eyn`, `s`) cũng đổi theo mỗi bản dựng, nên cả hai neo dưới đây đều tránh tên
 * hàm và chỉ bám vào phần cấu trúc: chuỗi cờ, và cụm `getSandMachines:` cùng lời gọi của nó.
 */

const RENDERER = "dist/renderer/assets/index-DO1aF_xy.js";
const MAIN = "dist/electron-main/main.cjs";
/** 0.43: `main.cjs` chỉ còn vỏ; toàn bộ cursorAccount nằm ở đây. */
const MAIN043 = "dist/electron-main/main-app.cjs";

/**
 * Cờ bị đọc HAI lần: một lần lúc khởi tạo, một lần trong `subscribe` để tắt lại nếu hãng gỡ cờ.
 *
 *     let n=null,s=e.get()?.featureGates?.sand_multi_machine_local_exec??!1
 *     …
 *     const a=e.get()?.featureGates?.sand_multi_machine_local_exec??!1
 *
 * `split().join()` thay cả hai bằng một neo duy nhất, và cả hai vế đều đúng cú pháp sau khi thay
 * (`s=!0`, `a=!0`). Chỉ vá chỗ đầu thì lần cập nhật snapshot kế tiếp tắt cờ lại, và bảng sẽ hiện
 * một giây rồi biến mất.
 */
const co = {
  id: "computer-tab-flag",
  summary: "bật sand_multi_machine_local_exec tại chỗ renderer đọc nó (cả hai chỗ)",
  /*
   * 0.43 bỏ hẳn cờ này (0 lần trong 712 cờ của main, 0 lần trong renderer; `isMultiMachineLocalExecEnabled`
   * cũng mất). Bảng Computer nay chỉ chờ trạng thái đăng nhập (`S8t.bindAuth` → `cd(s)`), không chờ cờ.
   * Neo là chính TÊN cờ nên "không thấy" ở đây đúng nghĩa là "không còn", không phải đổi hình dạng.
   */
  obsoleteWhenMissing: "0.43 bỏ cờ sand_multi_machine_local_exec — bảng Computer không còn nằm sau cờ",
  variants: [
    {
      version: "0.29.0",
      file: RENDERER,
      find: "e.get()?.featureGates?.sand_multi_machine_local_exec??!1",
      expected: 2,
      replace: "/*grokbot2:computer-tab*/!0",
      marker: "/*grokbot2:computer-tab*/",
    },
  ],
};

/**
 * Thân mới của `getSandMachines`, viết một dòng vì nó được nhét vào bundle đã rút gọn.
 *
 * Hình dạng trả về phải khớp `fromProto` của chính client, không được đoán — đọc từ main 0.29:
 *
 *     function s0t(n,e){return{machineId:n.machineId,label:n.label,isCurrent:n.machineId===e,
 *       ...zMe(n.localToolPermission)?{localToolPermission:n.localToolPermission}:{}}}
 *
 * Địa chỉ backend lấy từ `SAND_BACKEND_URL` (launcher đặt sẵn — `infra/scripts/run.ps1`), khoá từ
 * `GROKBOT2_GATEWAY_TOKEN`.
 *
 * `cn()` là hàm module-level của main trả về machine-id THẬT của máy này (đọc từ secret store, id
 * mà daemon local-exec cũng khai trong `hello`). Gửi nó xuống để backend biết hàng nào là "Current
 * computer". Không có nó thì backend phải đoán bằng "máy mới thấy nhất", và đoán đó sai đúng vào
 * lúc quan trọng: khi app vừa mở, daemon của MÁY NÀY chưa cắm, nên máy mới thấy nhất lại là một
 * máy khác. Đo được đúng như vậy ngày 30/08 — bảng gắn nhãn "Current computer" cho một máy ảo.
 *
 * Bọc try/catch riêng: `cn()` hỏng thì vẫn hỏi backend, chỉ mất dấu "máy hiện tại" chứ không mất
 * cả bảng.
 *
 * Hỏng thì trả `null`, KHÔNG ném: renderer bọc lời gọi này trong `unavailableCodes`, nên một ngoại
 * lệ lạ ở đây nổi lên thành lỗi đỏ giữa Settings. `null` chỉ làm bảng trống — đúng bằng hiện trạng
 * trước khi có bản vá, tức là không tệ hơn.
 *
 * `AbortSignal.timeout` chứ không để treo: lời gọi này đồng bộ với việc mở Settings, backend chết
 * thì bảng phải trống ngay chứ không được treo cả hộp thoại.
 */
/**
 * @param {string} wrap  tên hàm bọc handler của bundle: `s` (0.29) · `o` (0.43) — cùng một `__name`.
 * @param {string} idFn  hàm module-level trả machine-id thật: `cn` (0.29) · `ot` (0.43); cùng thân
 *                       `(n=<store>)=>readSecret(...)`, chỉ đổi tên rút gọn.
 */
const thanMoi = (wrap, idFn) => `getSandMachines:${wrap}(async()=>{try{`
  // Chờ vé của NGƯỜI DÙNG — nhưng CHỈ khi không còn gì để dùng thay.
  //
  // Bảng hỏi ĐÚNG MỘT LẦN lúc app khởi động (bẫy 30/08) và box nối sau đó vài giây, nên "chưa có vé
  // thì thôi" nghĩa là bảng trống suốt phiên. Nhưng chờ VÔ ĐIỀU KIỆN thì trên máy dev — nơi
  // `GROKBOT2_GATEWAY_TOKEN` có sẵn — mỗi lần mở Settings phải trả 5 s cho một thứ đã có sẵn câu
  // trả lời. Nên: có vé thì đi ngay, không vé mà cũng không token dự phòng thì mới chờ.
  + 'let ve=globalThis.__grokbot2_ve;'
  + 'if((!ve||!ve.token)&&!process.env.GROKBOT2_GATEWAY_TOKEN)'
  + 'for(let i=0;i<50;i++){await new Promise(z=>setTimeout(z,100));ve=globalThis.__grokbot2_ve;if(ve&&ve.token)break;}'
  + 'const u=ve&&ve.baseUrl?String(ve.baseUrl).replace(/\\/+$/,"")'
  + ':String(process.env.SAND_BACKEND_URL||process.env.CURSOR_API_BASE_URL||"http://localhost:8788").replace(/\\/+$/,"")+"/gw";'
  + 'const k=(ve&&ve.token)||process.env.GROKBOT2_GATEWAY_TOKEN||"";'
  + `let cur=null;try{cur=await ${idFn}()}catch{}`
  + 'const r=await fetch(u+"/api/getSandMachines",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+k},body:JSON.stringify(cur?{currentMachineId:cur}:{}),signal:AbortSignal.timeout(8000)});'
  + 'if(!r.ok)return null;const a=await r.json();'
  + 'return Array.isArray(a)&&a.length>0?a:null;'
  + '}catch{return null}},"getSandMachines")';
const THAN_MOI = thanMoi("s", "cn");

/**
 * Đổi TÊN máy — nút Save trong bảng.
 *
 * Thân gốc dựng một chuỗi kiểm tra rồi gọi API hãng, và hai dòng đầu đã chặn mình rồi:
 *
 *     Ce(E.kind==="logged-in","Machine label update requires sign-in.");
 *     Ce(await n.isMachineStorageAllowed(w),"Machine label update requires storage access.");
 *
 * Nên bấm Save trên client chưa vá là ném ngay, không phải "không có gì xảy ra".
 *
 * Bản thay giữ nguyên phần KIỂM TRA ĐẦU VÀO của hãng — id ≤127 ký tự, nhãn không rỗng và ≤ hằng số
 * `s7t` của họ (SAND_MACHINE_LABEL_MAX_LENGTH). Không phải vì lịch sự: renderer đọc `.label.length`
 * không guard ở vài chỗ, và một nhãn rỗng lọt xuống là một bảng ném giữa lúc vẽ. Bỏ luôn phần đăng
 * nhập, và trả về đúng bản ghi máy mà renderer chờ (`Zn(u.machineId===a)` rồi `ingest`).
 */
const doiTen = {
  id: "computer-tab-label",
  summary: "nút Save đổi tên máy qua backend mình",
  variants: [
    {
      version: "0.29.0",
      file: MAIN,
      find: 'updateMachineLabel:s(async({machineId:p,label:A})=>{let y=A.trim();',
      expected: 1,
      replace: 'updateMachineLabel:s(async({machineId:p,label:A})=>{/*grokbot2:computer-tab-label*/'
        + 'const y2=String(A??"").trim();'
        + 'if(!(p&&p.length>0&&p.length<=127&&y2.length>0&&[...y2].length<=s7t))throw new Error("Machine label update requires a bounded machine id and label.");'
        + 'const ve2=globalThis.__grokbot2_ve;'
        + 'const u2=ve2&&ve2.baseUrl?String(ve2.baseUrl).replace(/\\/+$/,"")'
        + ':String(process.env.SAND_BACKEND_URL||process.env.CURSOR_API_BASE_URL||"http://localhost:8788").replace(/\\/+$/,"")+"/gw";'
        + 'const k2=(ve2&&ve2.token)||process.env.GROKBOT2_GATEWAY_TOKEN||"";'
        + 'const r2=await fetch(u2+"/api/updateSandMachineLabel",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+k2},body:JSON.stringify({machineId:p,label:y2}),signal:AbortSignal.timeout(8000)});'
        + 'if(!r2.ok)throw new Error("Machine label update failed: "+r2.status);'
        + 'return await r2.json();}/*grokbot2:label-cu*/,"updateMachineLabel"),unusedUpdateMachineLabel:s(async({machineId:p,label:A})=>{let y=A.trim();',
      marker: "/*grokbot2:computer-tab-label*/",
    },
    /*
     * 0.43: `updateMachineLabel:o(async({machineId:p,label:g})=>{let A=g.trim();(0,Fn.invariant)(p.length>0
     * &&p.length<=127&&A.length>0&&[...A].length<=Qee,…)` — cùng luật kiểm, hằng trần đổi tên `s7t` → `Qee`
     * (=100), bọc `s` → `o`, tham số `A` → `g`. Renderer đi `updateSandMachineLabel → e.updateMachineLabel(t)`
     * nên thay thân này là đủ.
     */
    {
      version: "0.43.0",
      file: MAIN043,
      find: 'updateMachineLabel:o(async({machineId:p,label:g})=>{let A=g.trim();',
      expected: 1,
      replace: 'updateMachineLabel:o(async({machineId:p,label:g})=>{/*grokbot2:computer-tab-label*/'
        + 'const y2=String(g??"").trim();'
        + 'if(!(p&&p.length>0&&p.length<=127&&y2.length>0&&[...y2].length<=Qee))throw new Error("Machine label update requires a bounded machine id and label.");'
        + 'const ve2=globalThis.__grokbot2_ve;'
        + 'const u2=ve2&&ve2.baseUrl?String(ve2.baseUrl).replace(/\\/+$/,"")'
        + ':String(process.env.SAND_BACKEND_URL||process.env.CURSOR_API_BASE_URL||"http://localhost:8788").replace(/\\/+$/,"")+"/gw";'
        + 'const k2=(ve2&&ve2.token)||process.env.GROKBOT2_GATEWAY_TOKEN||"";'
        + 'const r2=await fetch(u2+"/api/updateSandMachineLabel",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+k2},body:JSON.stringify({machineId:p,label:y2}),signal:AbortSignal.timeout(8000)});'
        + 'if(!r2.ok)throw new Error("Machine label update failed: "+r2.status);'
        + 'return await r2.json();}/*grokbot2:label-cu*/,"updateMachineLabel"),unusedUpdateMachineLabel:o(async({machineId:p,label:g})=>{let A=g.trim();',
      marker: "/*grokbot2:computer-tab-label*/",
    },
  ],
};

/**
 * Đổi MỨC QUYỀN của một máy — ô "Execution on this computer" trong bảng.
 *
 * Cùng khuôn với đổi tên: thân gốc đòi đăng nhập rồi gọi API hãng. Phần SAU lời gọi này (đồng bộ
 * `localToolPermission` xuống box, có retry) nằm ở `setLocalToolPermission` chứ không ở đây, nên
 * thay mỗi thân này là đủ và phần đồng bộ vẫn chạy nguyên.
 *
 * Trả về bản ghi máy: `setLocalToolPermission` đọc `a.localToolPermission??"ask"` ngay sau đó.
 */
const doiQuyen = {
  id: "computer-tab-permission",
  summary: "ô Execution đổi mức quyền của một máy qua backend mình",
  variants: [
    {
      version: "0.29.0",
      file: MAIN,
      find: 'updateMachineLocalToolPermission:s(async({machineId:p,localToolPermission:A,expectedAccountScope:y})=>{let S=await e(),',
      expected: 1,
      replace: 'updateMachineLocalToolPermission:s(async({machineId:p,localToolPermission:A})=>{/*grokbot2:computer-tab-permission*/'
        + 'const ve3=globalThis.__grokbot2_ve;'
        + 'const u3=ve3&&ve3.baseUrl?String(ve3.baseUrl).replace(/\\/+$/,"")'
        + ':String(process.env.SAND_BACKEND_URL||process.env.CURSOR_API_BASE_URL||"http://localhost:8788").replace(/\\/+$/,"")+"/gw";'
        + 'const k3=(ve3&&ve3.token)||process.env.GROKBOT2_GATEWAY_TOKEN||"";'
        + 'const r3=await fetch(u3+"/api/updateSandMachineLocalToolPermission",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+k3},body:JSON.stringify({machineId:p,localToolPermission:A}),signal:AbortSignal.timeout(8000)});'
        + 'if(!r3.ok)throw new Error("Machine permission update failed: "+r3.status);'
        + 'return await r3.json();}/*grokbot2:quyen-cu*/,"updateMachineLocalToolPermission"),unusedUpdateMachinePermission:s(async({machineId:p,localToolPermission:A,expectedAccountScope:y})=>{let S=await e(),',
      marker: "/*grokbot2:computer-tab-permission*/",
    },
    // 0.43: cùng chữ ký, đổi tên tham số (`A`→`g`, `y`→`A`) và câu mở đầu (`let S=await e()` → `let h=await t()`).
    {
      version: "0.43.0",
      file: MAIN043,
      find: 'updateMachineLocalToolPermission:o(async({machineId:p,localToolPermission:g,expectedAccountScope:A})=>{let h=await t(),',
      expected: 1,
      replace: 'updateMachineLocalToolPermission:o(async({machineId:p,localToolPermission:g})=>{/*grokbot2:computer-tab-permission*/'
        + 'const ve3=globalThis.__grokbot2_ve;'
        + 'const u3=ve3&&ve3.baseUrl?String(ve3.baseUrl).replace(/\\/+$/,"")'
        + ':String(process.env.SAND_BACKEND_URL||process.env.CURSOR_API_BASE_URL||"http://localhost:8788").replace(/\\/+$/,"")+"/gw";'
        + 'const k3=(ve3&&ve3.token)||process.env.GROKBOT2_GATEWAY_TOKEN||"";'
        + 'const r3=await fetch(u3+"/api/updateSandMachineLocalToolPermission",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+k3},body:JSON.stringify({machineId:p,localToolPermission:g}),signal:AbortSignal.timeout(8000)});'
        + 'if(!r3.ok)throw new Error("Machine permission update failed: "+r3.status);'
        + 'return await r3.json();}/*grokbot2:quyen-cu*/,"updateMachineLocalToolPermission"),unusedUpdateMachinePermission:o(async({machineId:p,localToolPermission:g,expectedAccountScope:A})=>{let h=await t(),',
      marker: "/*grokbot2:computer-tab-permission*/",
    },
  ],
};

const cau = {
  id: "computer-tab-ipc",
  summary: "getSandMachines hỏi backend mình thay vì API của hãng",
  variants: [
    {
      version: "0.29.0",
      file: MAIN,
      find: 'getSandMachines:s(()=>n.cursorAccount.getMachines(),"getSandMachines")',
      expected: 1,
      replace: `/*grokbot2:computer-tab-ipc*/${THAN_MOI}`,
      marker: "/*grokbot2:computer-tab-ipc*/",
    },
    /*
     * 0.43 có BA `getSandMachines:` trong main-app: một là bảng DSL (`v().noArgs`), hai là
     * `Ns.readMachines()` (phía box). Cái renderer gọi vẫn là `cursorAccount.getMachines()` — đòi tài
     * khoản Cursor thật, y như 0.29 — nên neo đúng dòng đó và chỉ nó (expected 1).
     */
    {
      version: "0.43.0",
      file: MAIN043,
      find: 'getSandMachines:o(()=>e.cursorAccount.getMachines(),"getSandMachines")',
      expected: 1,
      replace: `/*grokbot2:computer-tab-ipc*/${thanMoi("o", "ot")}`,
      marker: "/*grokbot2:computer-tab-ipc*/",
    },
  ],
};

/**
 * Vé CỦA NGƯỜI DÙNG cho ba lời gọi trên — cất lại ngay chỗ client đúc ra nó.
 *
 * ── Vì sao cần ────────────────────────────────────────────────────────────────────────────────
 *
 * Ba bản vá trên đi bằng `GROKBOT2_GATEWAY_TOKEN`, và biến đó có đúng MỘT chỗ đặt trong cả kho:
 * `infra/scripts/run.ps1` — bộ khởi chạy của máy dev. Launcher phát ra ngoài (`setup-templates.mjs`)
 * đặt bốn biến và **không có** biến này. Đo 07/09: lời gọi từ một máy tải về gửi `Bearer ` rỗng và
 * nhận **401**, nên bảng Computer trên mọi máy người dùng thật là trống — im lặng, vì bản vá trả
 * `null` khi `!r.ok` và bảng trống trông y như "chưa có máy nào".
 *
 * Và kể cả khi có: vé dùng chung **không mang danh tính**. `ownerOfTicket` trả `null` cho nó nên
 * backend suy ra danh tính mặc định, tức bảng không lọc theo ai được — đúng chỗ hở còn lại sau khi
 * định tuyến đã cô lập xong (bảng theo dõi §6 mục 39).
 *
 * ── Vé thật nằm ở đâu ─────────────────────────────────────────────────────────────────────────
 *
 * `EnsureSandBox` đóng vé riêng của từng người vào **trường 11** của bản mô tả box
 * (`packages/grokbot-proto/src/bootstrap.ts`), và app dội đúng chuỗi ấy lại trên mọi lời gọi `/gw`.
 * Trong main nó đi qua đúng một hàm — `buildConnection`, thứ duy nhất đúc ra
 * `{baseUrl, token, headers, vncProxy}`:
 *
 *     function MAe(e,t,r,n){ … return{baseUrl:e,token:t.length>0?t:void 0,headers:…} }
 *     o(MAe,"buildConnection")
 *
 * Nên neo ở đây thay vì đi tìm một singleton: mọi đường tới vé đều chảy qua chỗ này, kể cả khi box
 * nối lại và vé đổi.
 *
 * `baseUrl` cũng lấy luôn từ đó — nó là `gateway_url` (trường 10), tức `<backend>/gw`. Bằng chứng
 * rằng đường ghép `${gatewayUrl}/api/<lệnh>` là đúng nằm trong chính bundle: `flushBoxStore` gọi
 * `fetch(`${t.gatewayUrl}/api/snapshotBoxStoreNow`)`. Nhờ vậy bảng thôi phụ thuộc `SAND_BACKEND_URL`.
 *
 * ── Giòn ở đâu, và vì sao vẫn chấp nhận ───────────────────────────────────────────────────────
 *
 * Neo bám vào tên THAM SỐ rút gọn (`e,t` ở 0.43 · `n,e` ở 0.29) — cùng kiểu giòn với `doiTen` và
 * `doiQuyen` ở trên, và cách chữa cũng cùng một chỗ: thêm một `variants[]`. Gãy thì gãy ĐỎ kèm id,
 * không gãy im. Không neo được vào chữ `"buildConnection"` vì bộ vá chỉ biết find/replace chuỗi
 * thẳng, không có bước tính toán để moi tên hàm ra rồi vá tiếp.
 *
 * Ghi vào `globalThis` chứ không vào một module: bản vá chèn một câu lệnh vào giữa thân hàm đã rút
 * gọn, nên nó không có chỗ nào để `export`. Cùng một tiến trình main, nên `getSandMachines` đọc được.
 * Chỉ ghi khi vé không rỗng — một vé rỗng đè lên vé thật là đúng cái lỗi nó sinh ra để chữa.
 */
const veNguoiDung = {
  id: "computer-tab-ve",
  summary: "cất vé cổng của người dùng lúc buildConnection đúc ra nó, để bảng Computer đi bằng vé thật",
  variants: [
    {
      version: "0.29.0",
      file: MAIN,
      find: 'return{baseUrl:n,token:e.length>0?e:void 0,headers:',
      expected: 1,
      replace: '/*grokbot2:ve-nguoi-dung*/try{if(typeof e=="string"&&e.length>0)globalThis.__grokbot2_ve={baseUrl:n,token:e};}catch{}'
        + 'return{baseUrl:n,token:e&&e.length>0?e:void 0,headers:',
      marker: "/*grokbot2:ve-nguoi-dung*/",
    },
    {
      version: "0.43.0",
      file: MAIN043,
      find: 'return{baseUrl:e,token:t.length>0?t:void 0,headers:',
      expected: 1,
      replace: '/*grokbot2:ve-nguoi-dung*/try{if(typeof t=="string"&&t.length>0)globalThis.__grokbot2_ve={baseUrl:e,token:t};}catch{}'
        + 'return{baseUrl:e,token:t&&t.length>0?t:void 0,headers:',
      marker: "/*grokbot2:ve-nguoi-dung*/",
    },
  ],
};

export default [co, cau, doiTen, doiQuyen, veNguoiDung];
