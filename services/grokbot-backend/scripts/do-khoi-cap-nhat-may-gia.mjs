/**
 * Máy chủ giả cho `do-khoi-cap-nhat.mts` — chạy TIẾN TRÌNH RIÊNG.
 *
 * Cùng tiến trình với `execFileSync` là bẫy §7 đã trả giá: vòng lặp sự kiện bị khoá trong lúc
 * PowerShell chờ ⇒ mọi lượt hỏi hết giờ ⇒ bộ đo tố cáo sản phẩm cho một lỗi của chính nó.
 *
 * `kich-ban.json` điều khiển nó:
 *   status · body · than            — câu trả lời của cửa feed và thân gói
 *   hongLan: N · kieuHong: cat|dut  — N lượt tải ĐẦU bị làm hỏng, theo một trong hai kiểu:
 *       "cat" = trả 200 nhưng chỉ gửi NỬA số byte (đúng ca máy 19041.5607: 22/106 MB ⇒ sha lệch)
 *       "dut" = phá socket giữa chừng (đúng ca lượt tải ném ⇒ `tai-hong`)
 *
 * Mỗi lượt hỏi feed ghi một dòng vào `nhat-ky.jsonl`, KÈM `User-Agent`: bài đo cần nó để kiểm
 * rằng đổi ngăn xếp HTTP không làm đổi khoá của sổ kiểm kê đội máy.
 */
import { createServer } from "node:http";
import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const D = process.argv[2];
const doc = () => JSON.parse(readFileSync(join(D, "kich-ban.json"), "utf8"));
const demTep = join(D, "dem-goi.txt");
const dem = () => (existsSync(demTep) ? Number(readFileSync(demTep, "utf8")) || 0 : 0);

const may = createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const kb = doc();

  if (u.pathname === "/updates/ban-moi") {
    appendFileSync(join(D, "nhat-ky.jsonl"), JSON.stringify({
      ver: u.searchParams.get("ver"),
      kq: u.searchParams.get("kq"),
      coK: !!u.searchParams.get("k"),
      ua: req.headers["user-agent"] ?? "",
    }) + "\n");
    if (kb.status === 204) { res.writeHead(204); return res.end(); }
    res.writeHead(kb.status, { "content-type": "application/json" });
    return res.end(JSON.stringify(kb.body));
  }

  if (u.pathname === "/goi") {
    const n = dem() + 1;
    writeFileSync(demTep, String(n));
    const than = String(kb.than ?? "");
    if (n <= (kb.hongLan ?? 0)) {
      if (kb.kieuHong === "dut") {
        // Hứa đủ độ dài rồi phá socket: đúng hình một lượt tải đứt giữa đường.
        res.writeHead(200, { "content-length": String(than.length) });
        res.write(than.slice(0, Math.max(1, Math.floor(than.length / 2))));
        return res.socket.destroy();
      }
      // "cat": 200 tử tế nhưng thiếu byte ⇒ sha lệch. KHÔNG khai `content-length` sai, vì lúc ấy
      // tầng HTTP sẽ ném thay cho phép kiểm băm — hai chẩn đoán khác nhau.
      return res.end(than.slice(0, Math.max(1, Math.floor(than.length / 2))));
    }
    return res.end(than);
  }

  res.writeHead(404);
  res.end();
});

may.listen(0, "127.0.0.1", () => writeFileSync(join(D, "cong.txt"), String(may.address().port)));
