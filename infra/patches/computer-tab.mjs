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
const THAN_MOI = 'getSandMachines:s(async()=>{try{'
  + 'const u=String(process.env.SAND_BACKEND_URL||process.env.CURSOR_API_BASE_URL||"http://localhost:8788").replace(/\\/+$/,"");'
  + 'const k=process.env.GROKBOT2_GATEWAY_TOKEN||"";'
  + 'let cur=null;try{cur=await cn()}catch{}'
  + 'const r=await fetch(u+"/gw/api/getSandMachines",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+k},body:JSON.stringify(cur?{currentMachineId:cur}:{}),signal:AbortSignal.timeout(8000)});'
  + 'if(!r.ok)return null;const a=await r.json();'
  + 'return Array.isArray(a)&&a.length>0?a:null;'
  + '}catch{return null}},"getSandMachines")';

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
        + 'const u2=String(process.env.SAND_BACKEND_URL||process.env.CURSOR_API_BASE_URL||"http://localhost:8788").replace(/\\/+$/,"");'
        + 'const k2=process.env.GROKBOT2_GATEWAY_TOKEN||"";'
        + 'const r2=await fetch(u2+"/gw/api/updateSandMachineLabel",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+k2},body:JSON.stringify({machineId:p,label:y2}),signal:AbortSignal.timeout(8000)});'
        + 'if(!r2.ok)throw new Error("Machine label update failed: "+r2.status);'
        + 'return await r2.json();}/*grokbot2:label-cu*/,"updateMachineLabel"),unusedUpdateMachineLabel:s(async({machineId:p,label:A})=>{let y=A.trim();',
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
        + 'const u3=String(process.env.SAND_BACKEND_URL||process.env.CURSOR_API_BASE_URL||"http://localhost:8788").replace(/\\/+$/,"");'
        + 'const k3=process.env.GROKBOT2_GATEWAY_TOKEN||"";'
        + 'const r3=await fetch(u3+"/gw/api/updateSandMachineLocalToolPermission",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+k3},body:JSON.stringify({machineId:p,localToolPermission:A}),signal:AbortSignal.timeout(8000)});'
        + 'if(!r3.ok)throw new Error("Machine permission update failed: "+r3.status);'
        + 'return await r3.json();}/*grokbot2:quyen-cu*/,"updateMachineLocalToolPermission"),unusedUpdateMachinePermission:s(async({machineId:p,localToolPermission:A,expectedAccountScope:y})=>{let S=await e(),',
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
  ],
};

export default [co, cau, doiTen, doiQuyen];
