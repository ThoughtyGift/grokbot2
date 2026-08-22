# `127.0.0.1:5173` bị từ chối, `localhost:5173` thì chạy

**Triệu chứng.** Trình duyệt báo `ERR_CONNECTION_REFUSED` với `http://127.0.0.1:5173`, nhưng
`http://localhost:5173` mở bình thường. Cùng một trang, hai địa chỉ, một cái hỏng — đủ để tưởng app
chết.

## Xác nhận

```bash
curl -s -m 3 -o /dev/null -w "localhost=%{http_code} " http://localhost:5173/
curl -s -m 3 -o /dev/null -w "127.0.0.1=%{http_code}\n" http://127.0.0.1:5173/
```

`localhost=200` mà `127.0.0.1=000` là đúng ca này.

## Sửa

Đã sửa vĩnh viễn trong `apps/grokbot-web/vite.config.ts` — `server.host = "127.0.0.1"`. Nếu thấy
lại thì kiểm dòng đó còn không.

## Vì sao

Vite mặc định bind `localhost`, mà trên Windows `localhost` phân giải ra `::1` trước — nên server
**chỉ nghe IPv6**. Bind thẳng `127.0.0.1` thì cả hai địa chỉ đều vào được: trình duyệt thử `::1`
hụt rồi tự lùi về IPv4.

Không dùng `host: true` — cái đó mở dev server ra cả mạng LAN, mà đây là công cụ chạy máy mình.
