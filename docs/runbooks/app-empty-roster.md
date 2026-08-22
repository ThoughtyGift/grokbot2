# App gốc mở ra sidebar trống trơn

**Triệu chứng.** `Grok Bot.exe` chạy, cửa sổ hiện, nhưng danh sách bot rỗng — chỉ còn panel phải và
tên bot ở header. Backend vẫn khoẻ.

## Xác nhận

Đọc lượng chữ trong renderer qua CDP:

```bash
cd services/grokbot-backend && node -e "
const {chromium}=require('playwright-core');
(async()=>{const b=await chromium.connectOverCDP('http://127.0.0.1:9222');
const p=b.contexts()[0].pages()[0];
console.log('ký tự:', await p.evaluate(()=>document.body?.innerText?.length??0));
await b.close();})()"
```

Bình thường vài nghìn. Ca này đo được **120**.

Đồng thời kiểm backend vẫn trả roster:

```bash
T=$(curl -s http://localhost:8788/v1/session | python -c "import sys,json;print(json.load(sys.stdin)['token'])")
curl -s -H "authorization: Bearer $T" http://localhost:8788/v1/agents | python -c "import sys,json;print(len(json.load(sys.stdin)),'bot')"
```

Backend có bot mà app không hiện ⇒ đúng ca này.

## Sửa

**Ctrl+R trong app.** Đo lại: 120 → 2840 ký tự, roster đầy đủ.

## Vì sao

Client hãng giữ một **bản sao roster** và cập nhật bằng event. Nó thi thoảng rỗng — đây là mục
`deleted bot leaves the sidebar` trong `KNOWN_OPEN` của `e2e-app-full.mjs`: không có event delete
theo từng bot, và danh sách `{agents}` trọn gói thì client xử lý không ổn định
(`docs/parity.md` §2ag). Nạp lại renderer là ép nó lấy lại snapshot từ đầu.

## Phòng

Không phòng được từ phía backend — nó thuộc client hãng. Điều làm được: khi thấy trống thì **đừng**
nghi mất dữ liệu, bấm Ctrl+R trước.
