# Legal / scope

Grok Bot is a **rebranded Cursor desktop agent** (Anysphere, Inc.) — the shipped binaries are
signed by Anysphere. This project reverse-engineers the **contract** its client speaks to a
backend, so the owner can self-host the brain for **personal / research use** on their own machine.

Boundaries:

- **Do not redistribute** a modified client or this backend as a way to resell/impersonate Cursor.
- **Do not represent** this as an official Cursor/Anysphere or xAI product.
- Self-answering the access/billing RPCs (`GetSandAccessStatus`, `GetSand*TrialStatus`) bypasses
  the vendor's commercial gating. Keep this to your own use; distributing it is not appropriate.
- The Claude pool it talks to (`admin.halcion.vn`) is the owner's own infrastructure using their
  own subscription accounts.

## Quyết định của chủ dự án — 03/09/2026

Trang tải `cinai.app/agent/` phát **bản chở cả ứng dụng** (client đã vá của nhà phát hành, ~105 MB)
ở nút công khai, bật bằng `GROKBOT2_PUBLIC_FULL=1` trên máy chủ đó. Điều này **đi ngược** dòng
"Do not redistribute a modified client" ở trên, và được ghi lại ở đây thay vì để hai tài liệu cãi nhau:

- Lý do: mục tiêu là dev lại giao diện của mình; trong lúc đó tận dụng FE của client, và **một đường
  tải** — người bấm nút phải nhận app chạy ngay, không phải bộ cấu hình 52 KB đòi máy đã có client.
- Phạm vi: trang của chủ dự án, cho người dùng của chủ dự án, không nhận là sản phẩm của Cursor/xAI
  (nav, footer và trang đều nói rõ "bản tự vận hành").
- Trách nhiệm: của chủ dự án, không phải của mã — mã giữ nó là **một cờ**, mặc định tắt; máy dev và
  mọi bản cài khác vẫn phát bộ cấu hình.
- Ngày FE tự viết thay được client thì gói tải chỉ còn mã của mình và mục này **tự hết hiệu lực**.

If you only want an independent agent (not the Grok Bot UI), building a fresh agent against the
Claude/Grok pool is cleaner and carries none of these concerns.
