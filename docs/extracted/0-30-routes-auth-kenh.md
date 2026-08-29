# Trích lại `routes` / `auth` / `channels` cho 0.29–0.30

> Trích 2026-08-29 bằng `services/grokbot-backend/scripts/extract-host-0-30.mjs`.
> Kết quả máy đọc: [`host-contract-0-30.json`](host-contract-0-30.json). Phiên bản đo: **0.30.0**,
> đối chiếu chéo với **0.29.0**.

## Vì sao ba nhóm này treo lâu thế

`box-host-contract.json` bóc từ `dist/host/host-main.cjs` của 0.20 — 13 MB chứa **bộ định tuyến của
chính host**. Từ 0.29 hãng bỏ hẳn thư mục đó: host chạy trên máy của họ, không đóng gói nữa.

Nên câu "trích lại router" không có lời giải: không còn router nào trong gói để đọc. Cái còn đọc
được — và cũng là cái thật sự ràng buộc ta — là **đường client GỌI** và **tên kênh client NHẬN**.
Ta chính là host, nên phần còn lại là lựa chọn của ta chứ không phải hợp đồng.

Neo mới: `node-agent-coordinator/main.cjs` (0.5 MB) và `local-exec-daemon/main.cjs` (3.5 MB).

## `channels` — 16 → 18, và ta đứng ở 16 suốt hai phiên bản

Bảng kênh nằm ở dạng `{...kw, transcript:"transcript", …}`, `kw` là bảng bí danh.

| | 0.20 | 0.29 / 0.30 |
|---|---|---|
| kênh | 16 | **18** |
| bí danh | 3 | **4** |

Thêm, không bỏ cái nào:

- **`agent-activity`** — có tên trong bảng, chưa đo được nó vẽ gì.
- **`mcp-auth`** (bí danh `mcp-auth-completed`) — ta báo OAuth MCP xong bằng `mcp-servers`, rộng hơn
  nhưng vẫn đúng.

`WIRE_CHANNELS` tồn tại để một push mới **phải chọn trong tập** thay vì tự đặt tên — nó đứng ở 16
tên của 0.20 qua hai phiên bản, nên hai tên này không ai thấy. Và không bài chấm nào kêu, vì mọi
bài đều chấm theo chiều *"ta phát ra có hợp lệ không"*.

Đã thêm chiều ngược lại: **`WIRE_CHANNELS` phải phủ hết bảng kênh của bản mới nhất**. Thử bằng cách
nhét một tên giả vào hợp đồng → cổng đỏ đúng tên đó; bỏ ra → xanh lại.

## `routes` — một cái mất, một cái mới

Đo trên **cả hai** bundle (số lần xuất hiện chuỗi):

| | 0.29.0 | 0.30.0 |
|---|---|---|
| `/prepare-upgrade` | **0** | **0** |
| `/avatars/` | **0** | **0** |
| `/cookie-origin-approval` | 3 | 26 |

- **`/prepare-upgrade` biến mất.** Ta vẫn phục vụ; vô hại, nhưng không còn là hợp đồng.
- **`/avatars/<id>` biến mất.** 0.29+ không tải ảnh đại diện qua HTTP nữa — nó đi thẳng trong bản
  ghi (`avatarDataUrl`, `avatarShape`, `avatarColor`) và qua lệnh `getAgentAvatar`, thứ ta đã có.
  Route `/gw/avatars/` của ta là di sản 0.20.
- **`/cookie-origin-approval/{requests,responses}` xuất hiện** — cùng hình dạng đường hầm ngược như
  `webauthn` và `local-exec`, kèm chuỗi *"Chrome cookie approval could not be completed on this
  computer."*. Đây là nửa HTTP của `injectChromeCookies`, lệnh gateway ta cũng chưa có.

Chín đường là route của box, tám đường **không phải của ta** và mỗi dòng kèm bằng chứng — `/cancel`
và `/oauth/return` là máy chủ loopback OAuth của chính client (`bE="/cancel"` cạnh *"OAuth login
superseded by a newer attempt"*, content-type `text/html`), `/vnc.html` là của máy chủ VNC trên box,
`/sand-box/*` là máy chủ của hãng. Ghi lại để lần sau không ai phải bóc lại mới biết vì sao.

Hai route chưa cài được chấm bằng **"phải trả 404"**, không phải bằng một dấu tích cho không: cài
một nửa rồi trả 200 rỗng thì cổng đỏ — mà đó đúng là lúc cần đỏ.

## `auth` — không tái trích được, và không cần

Đo trong `node-agent-coordinator`:

```js
case 401: return D.Unauthenticated
t === 401 || t === 403  ->  "access_denied"
```

Client ánh xạ **bằng mã trạng thái** rồi dừng. Không chỗ nào đọc thân phản hồi 401. Ba chuỗi trong
`auth401` của 0.20 (*"local-exec requires gateway authentication"*, …) là lời của **host**, không
phải thứ client kiểm.

Nên nhóm `auth` giữ hợp đồng 0.20 là **kết luận**, không phải bỏ sót. Cái đáng chấm là *đường nào
trả 401*, và đường thì bảng route ở trên có.

## Trạng thái cổng sau khi làm

```
PASS  routes    18/18      (+2: hai route 0.30 chưa cài, chấm bằng 404)
PASS  auth       6/6
FAIL  commands   9/10      11 lệnh chưa cài — getAutomationWebhookCredential đã rời danh sách
PASS  channels  18/18      (+2: bí danh mcp-auth-completed, và chiều phủ ngược)
```

## Chạy lại

```
node services/grokbot-backend/scripts/extract-host-0-30.mjs --dist <thư mục dist đã giải nén>
node services/grokbot-backend/scripts/extract-host-0-30.mjs --asar "C:/Program Files/Grok Bot/resources/app.asar"
```

Nhánh `--asar` giải nén ra thư mục **tạm**. Cố ý: `asar extract-file` ghi ra thư mục hiện tại, và
đúng cái đó đã đè mất `package.json` gốc của repo một lần.

Bộ trích in ra danh sách **đường chưa phân loại**. Danh sách ấy rỗng hôm nay; nó khác rỗng nghĩa là
hãng thêm đường mới và có người phải đọc rồi xếp nó vào `BOX_ROUTES` kèm bằng chứng.
