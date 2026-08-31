/**
 * Điều khiển OBS trên box qua obs-websocket 5.x — Node thuần, không thư viện.
 *
 *   node obs-ws.mjs quay 6        — quay 6 giây rồi dừng, in đường dẫn file
 *   node obs-ws.mjs trangthai     — phiên bản OBS, scene hiện tại
 *
 * Node 24 có `WebSocket` toàn cục nên không cần `ws`. Bắt tay: Hello (op 0) mang salt + challenge,
 * trả lời bằng base64(sha256( base64(sha256(mật khẩu + salt)) + challenge )).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const PW = readFileSync(`${process.env.HOME}/.config/obs-studio/plugin_config/obs-websocket/password.txt`, "utf8").trim();
const sha256b64 = (s) => createHash("sha256").update(s).digest("base64");

const ws = new WebSocket("ws://127.0.0.1:4455");
const cho = new Map();
let seq = 0;

const goi = (requestType, requestData = {}) => new Promise((ok, loi) => {
  const requestId = `r${(seq += 1)}`;
  cho.set(requestId, { ok, loi });
  ws.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
  setTimeout(() => cho.has(requestId) && (cho.delete(requestId), loi(new Error(`hết giờ: ${requestType}`))), 20_000);
});

const xong = new Promise((ok) => { ws.addEventListener("open", () => ok()); });
ws.addEventListener("error", (e) => { console.log("LỖI ws:", String(e.message ?? e)); process.exit(1); });

ws.addEventListener("message", async (ev) => {
  const m = JSON.parse(String(ev.data));
  if (m.op === 0) {
    const a = m.d.authentication;
    ws.send(JSON.stringify({
      op: 1,
      d: {
        rpcVersion: 1,
        ...(a ? { authentication: sha256b64(sha256b64(PW + a.salt) + a.challenge) } : {}),
        eventSubscriptions: 0,
      },
    }));
    return;
  }
  if (m.op === 2) { chay().catch((e) => { console.log("LỖI:", e.message); process.exit(1); }); return; }
  if (m.op === 7) {
    const w = cho.get(m.d.requestId);
    if (!w) return;
    cho.delete(m.d.requestId);
    if (m.d.requestStatus?.result) w.ok(m.d.responseData ?? {});
    else w.loi(new Error(`${m.d.requestType}: ${m.d.requestStatus?.comment ?? m.d.requestStatus?.code}`));
  }
});

const nghi = (ms) => new Promise((r) => setTimeout(r, ms));

async function chay() {
  const lenh = process.argv[2] ?? "trangthai";
  const ver = await goi("GetVersion");
  console.log(`OBS ${ver.obsVersion} · websocket ${ver.obsWebSocketVersion} · nền tảng ${ver.platformDescription}`);
  const sc = await goi("GetCurrentProgramScene");
  console.log(`scene hiện tại: ${sc.sceneName ?? sc.currentProgramSceneName}`);

  if (lenh === "quay") {
    const giay = Number(process.argv[3] ?? 6);
    // Nguồn quay màn hình phải có, nếu không OBS ghi ra một file đen — đúng loại lỗi im lặng
    // đắt nhất: file có, kích thước có, nội dung rỗng.
    const ds = await goi("GetInputList");
    const coManHinh = (ds.inputs ?? []).some((i) => String(i.inputKind).includes("xshm") || String(i.inputKind).includes("xcomposite"));
    if (!coManHinh) {
      console.log("chưa có nguồn màn hình → thêm 'Man hinh' (xshm_input)");
      await goi("CreateInput", {
        sceneName: sc.sceneName ?? sc.currentProgramSceneName,
        inputName: "Man hinh",
        inputKind: "xshm_input_v2",
        inputSettings: { screen: 0, show_cursor: true },
      });
      await nghi(1500);
    }
    /*
     * Đặt đường lưu + định dạng TRƯỚC khi ghi.
     *
     * Profile mới dựng không có `FilePath`, và OBS khi ấy nhận `StartRecord` mà không khởi động
     * output nào: không lỗi, không dòng log, chỉ tới `StopRecord` mới lộ ra bằng mã 501
     * (OutputNotRunning). Đúng loại hỏng im lặng đắt nhất — lệnh nào cũng "thành công".
     */
    const dat = async (category, name, value) => goi("SetProfileParameter", { parameterCategory: category, parameterName: name, parameterValue: String(value) });
    await dat("SimpleOutput", "FilePath", `${process.env.HOME}/quay`);
    await dat("SimpleOutput", "RecFormat2", "mp4");
    await dat("SimpleOutput", "RecQuality", "Small");
    await dat("SimpleOutput", "RecEncoder", "x264");
    await dat("Output", "Mode", "Simple");
    const st0 = await goi("GetRecordStatus");
    console.log(`trước khi ghi: outputActive=${st0.outputActive}`);
    await goi("StartRecord");
    await nghi(2000);
    const st1 = await goi("GetRecordStatus");
    console.log(`sau StartRecord: outputActive=${st1.outputActive} · path=${st1.outputPath ?? "-"}`);
    console.log(`đang quay ${giay}s…`);
    await nghi(giay * 1000);
    const r = await goi("StopRecord");
    console.log(`file: ${r.outputPath}`);
  }
  ws.close();
  process.exit(0);
}

await xong;
