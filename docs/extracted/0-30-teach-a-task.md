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

---

# Đo thật: chạy lại đúng bài 24h.com.vn trên app local

> 2026-08-29. Kịch bản lấy từ ảnh chụp app gốc của người dùng, dựng lại nguyên xi trên trình duyệt
> của bot (`agent-619`) qua CDP, bằng sự kiện chuột/phím thật chứ không phải `el.click()`.
> Bộ lái: `scratchpad/teach-e2e-24h.mjs`. Routine sinh ra: *Việc đã dạy — 08-29 08:11*.

Dựng: mở Google → gõ `24h` → Enter → bấm kết quả 24h.com.vn → bấm một bài trên trang chủ.

## Hai đầu ra, cạnh nhau

**App gốc** — skill tên `Read 24h.com.vn news`:

> Các bước: mở Chrome, gõ `24h` rồi Enter, bấm kết quả 24h.com.vn, mở bài nổi bật trên trang chủ,
> đọc. **Skill chạy thẳng vào `https://www.24h.com.vn/` (ổn định hơn search Google).**

**Của ta** — routine `Việc đã dạy — 08-29 08:11`, 8 bước:

```
1. mở https://www.google.com/search?q=24h&sca_esv=625aac17…&ei=aZOSavrRIpyA…  (≈700 ký tự)
2. mở https://www.google.com/
3. bấm `#ti6dpd`
4. mở https://www.google.com/search?q=24h&sca_esv=625aac17…&ei=CpSSar2cIZ2Z…  (≈700 ký tự)
5. bấm `.zReHs` ("Tin tức bóng đá, thể thao, giải trí | Đọc tin tức 24h mới nh")  (selector yếu)
6. mở https://www.24h.com.vn/
7. bấm `.d-block` ("Xôn xao hình ảnh xốp trong cống Lỉnh ở Bắc Ninh, chính quyền")  (selector yếu)
8. mở https://www.24h.com.vn/tin-tuc-trong-ngay/xon-xao-hinh-anh-xop-…-c46a1790607.html
```

## Ba lỗi đo được

### ① Bộ ghi không nghe bàn phím — mất luôn thứ quan trọng nhất

`teach.ts` gài đúng **hai** listener: `click` (dòng 119) và `change` (dòng 175). Không có
`keydown`. Nên `24h` — chữ duy nhất người dạy gõ vào, cái quyết định bài này là bài gì — **không có
trong routine**. Không một bước `điền` nào. Enter cũng không.

`Step.act` khai báo `"key"` nhưng **không chỗ nào sinh ra nó**, và `stepsToPrompt` cũng không có
nhánh đọc nó: một nhánh chết, trông như đã làm.

Vì sao `change` không cứu được: Google chặn Enter bằng JS và tự điều hướng, nên ô tìm kiếm không
bao giờ `blur` để `change` kịp bắn.

### ② Điều hướng bị ghi thành hành động

Bước 4, 6, 8 là **hệ quả** của bước bấm ngay trước, không phải việc ai làm. Ghi lại chúng khiến
routine vừa thừa vừa giòn: bước 4 mở lại một URL kết quả Google mang `ei`/`ved` đã hết hạn.

Nặng hơn là **bước 1**: đó là nơi tab đang đứng sẵn từ lần chạy trước, không ai mở nó trong buổi
dạy cả. `stepsToPrompt` đã bỏ `about:` và `data:` vì đúng lý do này (dòng 272), nhưng một URL `http`
còn sót lại từ phiên trước thì lọt qua.

### ③ Không khái quát hoá

App gốc **nhận ra** đường qua Google là đường yếu và viết skill đi thẳng vào `24h.com.vn`. Ta chép
lại đúng đường vòng, và ghim cả một bài cụ thể (bước 8) — hôm sau bài đó trôi khỏi trang chủ.

Tên cũng vậy: `Read 24h.com.vn news` nói việc gì; `Việc đã dạy — 08-29 08:11` nói lúc mấy giờ.

## Một giả thuyết của tôi đã sai

Tôi đoán `#ti6dpd` ở bước 3 là id ngẫu nhiên mỗi lần tải của Google — tức trường hợp tệ nhất: bộ
chọn xếp hạng "id" (hạng tin nhất, không kèm cảnh báo) nhưng thực chất vỡ ngay lần sau. **Đo 3 lần
tải lại: `#ti6dpd` cả ba lần.** Không phải lỗi. Bỏ khỏi danh sách.

## Gốc rễ: ta chép, họ hiểu

| | ta (`teach.ts`) | app gốc 0.30 |
|---|---|---|
| ai viết ra sản phẩm | **code** — `stepsToPrompt()` | **model**, trong một lượt riêng |
| model tham gia | **không một lần nào** (`callPool`: 0 lần trong `teach.ts`) | xem hết video + đối chiếu lịch sử Chrome |
| đầu vào | sự kiện DOM | video + lịch sử duyệt web |
| khái quát hoá | không có chỗ nào để xảy ra | có, và nói rõ lý do đổi đường |

`desktop-record.ts` có gọi model, nhưng chỉ để **tả từng mẩu ảnh một** (`describeCrops`) — không ai
đọc toàn buổi dạy. Nên khoảng cách không nằm ở prompt hay ở tool: nằm ở chỗ **không có lượt model
nào đọc bản ghi**.

## Thứ tự vá đề nghị

1. **Nghe `keydown`** — gom phím thành một bước `type`, ghi riêng phím chức năng (Enter/Tab/Escape),
   và thêm nhánh `key` vào `stepsToPrompt`. Rẻ nhất, bịt lỗ to nhất.
2. **Bỏ bước `navigate` nào xảy ra ngay sau một `click`** (trong ~2 giây) — nó là hệ quả. Và bỏ
   bước `navigate` đầu tiên nếu nó chỉ là nơi tab đang đứng lúc bật ghi.
3. **Cho một lượt model đọc danh sách bước** rồi tự đặt tên + viết lại thành việc, thay vì
   `stepsToPrompt` chép thẳng. Đây là chỗ khái quát hoá có thể xảy ra.

## Sau khi vá ① và ② — đo lại đúng bài đó

```
1. mở https://www.google.com/
2. bấm `#ti6dpd`
3. điền `#ti6dpd` = "24h"
4. nhấn Enter
5. bấm `.zReHs` ("Tin tức bóng đá, thể thao, giải trí | Đọc tin tức 24h mới nh")  (selector yếu)
6. bấm `.d-block` ("Xôn xao hình ảnh xốp trong cống Lỉnh ở Bắc Ninh, chính quyền")  (selector yếu)
```

Mười bước ghi được → sáu việc. Đặt cạnh câu app gốc kể lại — *"mở Chrome, gõ `24h` rồi Enter, bấm
kết quả 24h.com.vn, mở bài nổi bật trên trang chủ"* — thì khớp từng nhịp.

### Vá ① hoá ra phải nghe `input`, không phải `keydown`

Bản vá đầu nghe `keydown` và gom phím lại. Chạy E2E: `nhấn Enter` xuất hiện, **bước điền vẫn mất**.

Đầu tiên tưởng bộ ghi còn lỗi. Không phải: bộ lái E2E gõ bằng CDP `type:"char"`, thứ **không sinh
ra `keydown`** (Enter lọt vì nó gửi `rawKeyDown`). Tức lỗi nằm ở dụng cụ đo, không ở vật được đo.

Nhưng nó chỉ ra một lỗ thật hơn: **dán** cũng không sinh `keydown`. Tự điền của trình duyệt và IME
tiếng Việt cũng vậy. Mà dán chính là cách người ta nhập khoá API và số thẻ — đúng thứ phần che
sinh ra để bắt, và nếu bộ ghi không thấy ô đó thì phần che không có gì để che.

Nên đổi sang nghe `input`, thứ bắn cho cả bốn đường. `keydown` chỉ còn lo Enter/Tab/Escape.

## Còn lại một khoảng cách, và nó là quyết định kiến trúc

Ba thứ app gốc có mà vá xong vẫn chưa có:

| | ta | app gốc |
|---|---|---|
| tên | `Việc đã dạy — 08-29 08:31` | `Read 24h.com.vn news` |
| đường đi | chép nguyên đường vòng qua Google | **đổi sang đi thẳng `24h.com.vn`**, và nói lý do |
| bài cụ thể | ghim bài hôm nay | hiểu là "bài nổi bật", không ghim |

Cả ba đều là **khái quát hoá**, và không luật nào trong `stepsToPrompt` làm được — vì không có ai
đọc buổi dạy. Muốn có thì phải cho **một lượt model** đọc danh sách bước rồi tự đặt tên và viết
lại. Đó là chỗ duy nhất còn lại, và nó tốn một lượt gọi pool mỗi lần lưu bài dạy.

---

# ③ đã làm: một lượt model đọc buổi dạy

Khoảng cách còn lại ở trên không đóng được bằng luật, vì khái quát hoá cần người đọc. Nên thêm
đúng thứ app gốc có: **một lượt model** đọc bản ghi rồi tự đặt tên và viết lại.

## Đo, cùng bài đó

| | trước | sau |
|---|---|---|
| tên | `Việc đã dạy — 08-29 08:47` | `Mở bài đầu tiên trên trang chủ 24h.com.vn` |
| bước 1 | `mở https://www.google.com/` | `Mở trực tiếp https://www.24h.com.vn/` |
| bài | ghim `…xon-xao-c46a1790607.html` | "bài viết đầu tiên trên trang chủ" |
| lý do đổi | không có | *"vì bản ghi cho thấy đó là đích đến"* |

Đặt cạnh app gốc — *"Skill chạy thẳng vào `https://www.24h.com.vn/` (ổn định hơn search Google)"* —
thì cùng một kết luận, và cùng một lý do.

## Bốn chỗ cố ý làm khác đi

**Lưu trước, sửa sau.** Routine thô lưu xong rồi lượt model mới chạy, ở nền. Hai lý do: ở client
câu trả lời của `stopTeach` **chính là trạng thái** của pane, giữ nó vài chục giây là pane đứng ở
"đang ghi" trong khi máy đã dừng; và model hỏng, hết hạn mức hay mất mạng thì bài dạy vẫn còn
nguyên. Không có đường nào để lượt này làm mất một bài dạy.

**Model đọc bản ghi ĐẦY ĐỦ, bot đọc bản đã lọc.** `stepsToPrompt` bỏ điều hướng hệ quả vì đó không
phải việc ai làm — nhưng chính chúng nói cú bấm dẫn tới đâu. Bỏ luôn với model là bỏ khả năng rút
ngắn đường đi. Nên `stepsForModel` giữ lại tất cả và **gắn nhãn**: `[trang tự chuyển tới]`,
`[nơi tab đang đứng lúc bật ghi]`, `[người tự mở]`.

**Nghi ngờ thì từ chối.** `docKetQuaHoc` trả `null` cho JSON hỏng, tên rỗng, tên vẫn là ngày giờ,
không bước nào, quá 40 bước, một bước quá 300 ký tự. Bản thô đang dùng được, nên nhận bừa thì tệ
hơn bỏ qua.

**Che ở nguồn nên lượt này an toàn sẵn.** Giá trị nhạy cảm bị thay bằng `***` ngay trong trang, nên
model không bao giờ nhìn thấy nó — không cần luật "đừng nhắc lại bí mật", vì không có gì để nhắc.

## Và luật từ chối của app gốc

> *"If the demonstration was mostly entering credentials, say so and do not create a skill."*

Đã có: `chuYeuLaBiMat()`. Ngưỡng cố ý dè dặt — đăng nhập một lần rồi làm mười việc vẫn là bài dạy
tốt, nên chỉ từ chối khi số ô bí mật **nhiều bằng hoặc hơn toàn bộ việc làm được**. Lý do không
phải lo xa mà rất thực: mọi giá trị đều đã bị che, nên routine ấy chạy lại cũng không điền được gì.

## Còn lại gì so với 0.30

| | trạng thái |
|---|---|
| ghi bằng video màn hình (ffmpeg) | **không** — ta ghi sự kiện DOM; `desktop-record.ts` lo phần ngoài trình duyệt |
| đối chiếu lịch sử Chrome | **không** — bản ghi DOM đã có đích đến rồi, nên chưa cần |
| hàng đợi + `flock` + lease hết hạn | **không** — ta cho phép đúng một bản ghi mỗi lúc |
| sản phẩm là skill `sand-workflow:<id>` | **không** — của ta là routine |
| đề nghị chạy thử, không bao giờ tự chạy | **có** phần sau (`trigger: "manual"`, không gì tự kích) |
