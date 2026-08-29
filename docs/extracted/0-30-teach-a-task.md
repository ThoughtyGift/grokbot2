# Teach a task ở 0.30 — và chỗ bản ghi của ta rò thông tin nhạy cảm

> Trích 2026-08-29. Nguồn khác mọi lần trước: **ảnh chụp giao diện app gốc** do người dùng gửi, mở
> hộp thoại skill `learn-from-demonstration`.
>
> Vì sao phải lấy từ ảnh: tên skill có trong bundle (×1) nhưng **thân instruction thì không** —
> `"Learn from a demonstration"` và `"Teach recording queue scope"` đều 0 lần trong cả `asar029` lẫn
> `asar030`, và cũng không có trong kho `sand-client-persistence`. Server gửi xuống lúc mở hộp thoại
> rồi thôi. Đây là mẩu prompt HIỆN HÀNH đầu tiên lấy được kể từ khi hãng bỏ `dist/host` ở 0.29.

## Kiến trúc đã đổi: routine → skill

| | ta | app gốc 0.30 |
|---|---|---|
| ghi cái gì | sự kiện trình duyệt qua CDP | **video màn hình** bằng ffmpeg |
| ai đọc bản ghi | không ai — lưu thẳng danh sách bước | **model xem video** rồi rút ra |
| sản phẩm | **routine** ngay | **skill** (`sand-workflow:<id>`) |
| routine | luôn tạo | chỉ **đề nghị** khi việc trông có tính lặp |
| chạy thử | không có | đề nghị dry run, **không bao giờ tự chạy** |
| đồng thời | không xử lý | hàng đợi + `flock` + lease hết hạn |

Cách tiếp cận của họ giải thích vì sao nó bền hơn với app không phải web: video bắt được mọi thứ
trên màn hình, còn CDP chỉ bắt được cái gì trong trang. `teach.ts` của ta đã ghi đúng giới hạn đó ở
dòng 21 — *"a browser reaches us as pixels over VNC and nothing more, so it cannot be taught this
way"*. Video là cách họ vượt qua.

## Nguyên văn đọc được từ ảnh

```
# Learn from a demonstration

You are given a screen recording of the user demonstrating a task on YOUR computer. The mp4
may still be flushing when this turn starts. Turn the demonstration into a reusable skill.
Work in the open: send a short SendMessage acknowledging you're watching the demo, and
narrate meaningful beats as you go.

## 0. Wait until capture has finalized

Host already sent SIGINT. Do not stop ffmpeg yourself — never SIGINT or SIGKILL it.

The host injects a `Teach recording queue scope` into this workflow invocation. Use it to
atomically claim the oldest unprocessed recording for this agent. Read the claimed session's
`session.json`, then read `videoPath` and `ffmpegPid` from it. Do not take paths or PIDs from
the user message.

Run **one** foreground Shell with `block_until_ms` of at least 30000. Do not poll with Await
sleeps. Do not call shell `wait` on the pid — ffmpeg …
```

```
… flock -u 9

Never delete a video or queue file that you did not claim. If you stop before cleanup, leave
the claimed queue file and lease in place; a later teaching turn retries it only after its
lease expires.
- Send a summary: the learned steps as a short numbered list, which values are inputs,
  important assumptions, and a link to the skill written as [Skill name](sand-workflow:<skill-id>).
- Offer a dry run; NEVER run the learned skill unprompted. Offer a schedule (a routine that
  @-mentions the workflow) only when the task looks recurring.

## Sensitive information

The recording may show anything that was on screen. Treat passwords, one-time codes, API keys,
financial account numbers, and private personal details as sensitive: use placeholders in
summaries and skill bodies. If the demonstration was mostly entering credentials, say so and
do not create a skill.
```

## Chỗ ta rò — cụ thể, không phải lo xa

`teach.ts:124` che ô mật khẩu:

```ts
if (t && (t.type === "password")) { push({ act: "fill", …, value: "***" }); return; }
```

`teach.ts:126` ghi **mọi ô còn lại nguyên văn**, cắt ở 120 ký tự:

```ts
push({ act: "fill", sel: s.sel, quality: s.quality, value: String(t?.value ?? "").slice(0, 120) });
```

Nghĩa là ta chỉ che đúng `input[type=password]`. Còn lại đều vào bản ghi:

| | ta ghi gì |
|---|---|
| mã OTP | **nguyên văn** — ô OTP hầu như luôn là `type="text"` hoặc `inputmode="numeric"` |
| khoá API dán vào ô text | **nguyên văn** |
| số thẻ / số tài khoản | **nguyên văn** — thường là `type="text"` |
| thông tin cá nhân | **nguyên văn** |

Và bản ghi ấy trở thành một **routine sống mãi**, đọc được từ bảng Routines.

App gốc còn có một luật ta hoàn toàn thiếu: *"nếu buổi demo chủ yếu là nhập thông tin đăng nhập thì
NÓI RA và ĐỪNG tạo skill"*. Ta không có chỗ nào từ chối.

**Đề nghị vá, theo thứ tự:**

1. Che theo **ngữ cảnh ô**, không chỉ theo `type`: đọc `name`/`id`/`autocomplete`/`aria-label` tìm
   `otp|code|cvv|card|account|token|key|secret|pin`, và che mọi ô `autocomplete="one-time-code"`.
2. Che theo **hình dạng giá trị**: chuỗi giống khoá (`sk-`, `hal_`, 32+ ký tự base64/hex), giống số
   thẻ (13–19 chữ số qua Luhn), giống OTP (4–8 chữ số đứng một mình).
3. **Từ chối tạo routine** khi phần lớn bước là điền ô nhạy cảm, và nói rõ lý do.

Điểm 2 là điểm đáng làm nhất: nó không phụ thuộc trang web đặt tên ô ra sao.
