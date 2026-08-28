# Bot nhóm & bot tự nói chuyện — logic app gốc 0.29

> Trích 2026-08-28 bằng một workflow nhiều agent. **Cảnh báo về độ tin cậy:** năm agent tìm kiếm
> đều chết vì hạn mức phiên, nên **vòng phản biện đối kháng đã KHÔNG chạy**. Nội dung dưới đây do
> một agent tổng hợp tự tra — NGUỒN ĐƠN, chưa ai kiểm chéo. Ba điểm tôi đã tự kiểm lại bằng tay:
>
> * `RoomMemberTurn` xuất hiện **0 lần** trong toàn bộ renderer ✓
> * `requestGrokBotRoomMemberTurn` và `sendGrokBotAgentMessage` mỗi cái **đúng 1 lần** trong
>   `main.cjs` — chỉ là dòng descriptor, không có chỗ gọi ✓
> * client thật sự gọi `createGroup` (14), `kickstartAgent` (7), `runAgentAutomationNow` (3),
>   `setGroupMembers` (5) ✓
>
> Mọi khẳng định KHÁC trong file này **chưa được kiểm chéo** — đọc như giả thuyết có trích dẫn,
> không phải sự thật đã chốt. Muốn chốt thì chạy lại workflow sau khi hạn mức hồi.

# Bot nhóm & bot tự nói chuyện với nhau — trích xuất logic từ app gốc (0.29)

Nguồn: `dist/electron-main/main.cjs` (proto + service descriptor) và `dist/renderer/assets/index-DO1aF_xy.js` (renderer, ~4.3 MB) trong bản giải nén `asar029`. Mọi số offset dưới đây là **vị trí byte trong file đã ghi tên**.

---

## 1. Câu trả lời ngắn

**Client KHÔNG tự quyết định mở một lượt.** Trong toàn bộ bundle, client chỉ có đúng ba đường để một lượt bắt đầu: người dùng gõ (`sendPrompt`), người dùng tạo bot mới không kèm câu hỏi (`kickstartAgent` — một lần, ngay lúc tạo), và người dùng bấm chạy routine (`runAgentAutomationNow`). Cả hai cơ chế sinh ra hiện tượng "bot tự trao đổi với nhau liên tục" — `SendGrokBotAgentMessage` (bot nhắn bot) và `RequestGrokBotRoomMemberTurn` (điều phối lượt nói trong phòng) — **có mặt trong file proto nhưng KHÔNG có chỗ nào gọi**: chúng chỉ nằm trong bảng mô tả service `GrokBotService`, do generator sinh ra. Client **chỉ hiển thị** kết quả: nó nhận về các bản ghi transcript có `fromAgent`/`toAgent` rồi vẽ thành dòng "Messaged X" / "Message from Y". Quyết định nằm ở phía server/box.

Bằng chứng đếm: mỗi tên phương thức xuất hiện đúng **1 lần** trong mỗi bundle — chính là dòng trong descriptor.

```
== requestGrokBotRoomMemberTurn      3 (main.cjs, node-agent-coordinator/main.cjs, local-exec-daemon/main.cjs — mỗi file 1)
== cancelGrokBotRoomMemberTurn       3
== sendGrokBotAgentMessage           3
== sendGrokBotUserMessage            4  ← file main.cjs có 2: descriptor + 1 chỗ gọi thật
```

Dòng descriptor duy nhất đó, `main.cjs` @3445341:

> `requestGrokBotRoomMemberTurn:{name:"RequestGrokBotRoomMemberTurn",I:_W,O:IW,kind:g.Unary}`

và @3444297:

> `sendGrokBotAgentMessage:{name:"SendGrokBotAgentMessage",I:eW,O:tW,kind:g.Unary}`

Renderer thì **không có một chữ `RoomMemberTurn` nào**: `grep -roh 'RoomMemberTurn' dist/renderer/assets` → 0 kết quả.

---

## 2. Group bot: mô hình dữ liệu

Nhóm **không phải một thực thể riêng**. Nó là một hàng roster y hệt bot thường, chỉ khác hai cờ. Đây là hàm chiếu bản ghi roster (`index-DO1aF_xy.js` @4132946):

> `…origin:t.origin,purpose:t.purpose,isGroup:t.isGroup,memberIds:t.memberIds,isSharedRoom:t.isSharedRoom,sharedRoomId:t.sharedRoomId,conversationPartnerIds:t.conversationPartnerIds}`

Bộ kiểm tra `qyn` (`index-DO1aF_xy.js` @4133300) cho biết trường nào là **bắt buộc** và trường nào là **live, không lưu**:

> `if(!an(t)||typeof t.id!="string"||…||typeof t.isGroup!="boolean"||typeof t.origin!="string"||…||!Sue(t.memberIds)||!Sue(t.conversationPartnerIds))return null;const{snapshotEpoch:e,snapshotSeq:n,isRunningTurn:s,isRetrying:r,currentActivity:i,activeRemoteMemberId:a,status:o,...l}=t;`

với `Sue` là "mảng chuỗi": `function Sue(t){return Array.isArray(t)&&t.every(e=>typeof e=="string")}`.

| Trường | Ý nghĩa (trích) |
|---|---|
| `isGroup: boolean` | bắt buộc, phân biệt nhóm với bot |
| `memberIds: string[]` | danh sách thành viên của nhóm |
| `conversationPartnerIds: string[]` | **khác `memberIds`** — "ai đã từng nhắn với ai" (xem §3) |
| `isSharedRoom` / `sharedRoomId` | nhóm chia sẻ nhiều người (multiplayer), khác nhóm thường: `function yA(t){return t.isGroup&&t.isSharedRoom!==!0}` (@1619227) |
| `isRunningTurn`, `currentActivity`, `activeRemoteMemberId` | **bị strip khi lưu** → do server đẩy xuống, client không tự sinh |

Nhóm **không có `title`**: `function mq(t){return!t.isGroup&&t.title!==void 0}` (@1619227).

### Nhóm được tạo ở đâu — và ai bấm nút

`createGroup` là **một method của gateway box**, không phải RPC cloud (`index-DO1aF_xy.js` @1621296):

> `createAgent:{args:"object",reply:"record"},createGroup:{args:"object",reply:"record"},setGroupMembers:{args:"object",reply:"record-or-null"},…kickstartAgent:{args:"object",reply:"record-or-null"},…broadcastToAgents:{args:"object",reply:"record"}`

Trong toàn renderer chỉ có **hai** chỗ gọi `.createGroup(`, cả hai đều do người dùng bấm:

1. Hộp thoại "New channel" (`$="sand-new-channel-dialog"` @2444837), lời gọi @2444600:
   > `o.roster.createGroup({name:c.trim(),memberAgentIds:h.ordered}).then(Ge=>{S.current||(s(),l(Ge.agent.id))}).catch(()=>x(r({id:"DImcpZ"})))`
   
   `DImcpZ` → `["Couldn't create the channel. Try again."]`

2. Luồng "chat mới với nhiều người nhận" `Qdn` (@3853775) — người dùng thêm ≥2 người nhận thì nhóm được tạo tự động **trong lượt bấm đó**, tên nhóm ghép từ tên thành viên (`oFt`):
   > `for(const f of t)if(f.kind==="agent")u.push(f.id);else{const h=await r.createAgent({name:ek(f.name),description:""});u.push(h.agent.id),c.push(h.agent.id)}const d=await r.createGroup({name:o,description:"",memberAgentIds:u});`

Sửa thành viên về sau: `setGroupMembers({id, memberAgentIds})` (@2525419), trần **6** người (`nw=6`, @1619227) và không cho xoá người cuối cùng:
> `const ue=…?.memberIds??[];ue.length<=1||!ue.includes(ye.id)||await l({id:n.id,memberAgentIds:ue.filter(q=>q!==ye.id)})`

**Không có nơi nào trong client tự tạo nhóm.** Xoá nhóm không xoá bot (`SH6elt`): *"This permanently deletes the group and its chat history. The Bots in it are not deleted and remain available individually."*

### Phía proto cloud thì sao?

`aiserver.v1.GrokBotAgent` (`main.cjs` @3372277) **không có** `is_group` lẫn `member_ids`:

> `Um.fields=r.util.newFieldList(()=>[{no:1,name:"id"…},{no:3,name:"name"…},{no:12,name:"agent_id"…},{no:13,name:"harness"…},{no:14,name:"role"…},{no:15,name:"visibility"…},{no:16,name:"team_id"…},{no:17,name:"viewer_is_owner"…}]);`

Và trong danh sách `GrokBotService` không tồn tại RPC nào tên `CreateGrokBotGroup`. → **cờ nhóm sống ở box/gateway, không ở proto cloud.** Đây là lý do một backend tự dựng như của ta có thể phục vụ nhóm mà không cần đụng proto.

Cách nhóm hiện trong menu @-mention (@2975759) — chú ý subtitle và icon:
> `subtitle:s.isGroup?xe._({id:"hsMz1s",values:{0:s.memberIds.length}}):void 0,icon:s.isGroup?{type:"group"}:{type:"agent",member:s},isGroup:s.isGroup`

`hsMz1s` → `[["0"]," Bots"]`.

---

## 3. Bot nói chuyện với bot: phong bì tin nhắn

### 3a. Phong bì trên dây (proto) — `main.cjs` @3402094

> `eW.typeName="aiserver.v1.SendGrokBotAgentMessageRequest";eW.fields=r.util.newFieldList(()=>[{no:1,name:"from_agent_id",kind:"scalar",T:9},{no:2,name:"to_agent_id",kind:"scalar",T:9},{no:3,name:"message_id",kind:"scalar",T:9},{no:4,name:"text",kind:"scalar",T:9},{no:5,name:"sent_at_ms",kind:"scalar",T:3}]);`

Đáp (@3402838): `this.delivery=k6e.UNSPECIFIED,this.targetAgentId="",this.targetName=""`. Enum `delivery` (@3338631):

| Giá trị | Nghĩa |
|---|---|
| `DELIVERED_TEMPORAL` / `DELIVERED_BOX` | đã giao, qua workflow hoặc qua box |
| `DUPLICATE` | trùng `message_id` |
| `TARGET_NOT_FOUND`, `FORBIDDEN`, `INVALID_TARGET` | từ chối |
| `BOX_UNREACHABLE`, `TEMPORAL_UNAVAILABLE` | hạ tầng |

**Chỉ có 5 trường. KHÔNG có `channel`, KHÔNG có `batchId`, KHÔNG có `parentAgentId`.**

### 3b. Phong bì trong transcript (thứ client thật sự đọc)

Chữ ký hàng transcript `kind:"message"` liệt kê đủ trường (`index-DO1aF_xy.js` @3481437):

> `case"message":return["m",t.id,…,t.timestampMs??"",t.replyTo??"",t.batchId??"",t.channel??"",t.channelSender??"",t.fromAgent==null?"":\`f:${t.fromAgent.id}:${t.fromAgent.name}\`,t.toAgent==null?"":\`t:${t.toAgent.id}:${t.toAgent.name}\`,…].join("|");`

Nhận diện một tin bot↔bot (@1509914):

> `function Cd(t){return t!=null&&t.kind==="message"&&(t.fromAgent!=null||t.toAgent!=null)}`
> `function Xye(t){return t!=null&&t.kind==="message"&&t.toAgent!=null}`
> `function BB(t){return Xye(t)&&t.toAgent.kind==="agent"}`

Chiều (@3471177):
> `function wen(t){return t.fromAgent!=null?{direction:"inbound",peer:{id:t.fromAgent.id,name:t.fromAgent.name}}:t.toAgent!=null?{direction:"outbound",peer:{id:t.toAgent.id,name:t.toAgent.name}}:null}`

**Đính chính hai giả định thường gặp:**

- `batchId` **không** thuộc kênh bot↔bot. Nó gom **tệp đính kèm của người dùng** trong một lượt gửi: `const r=e.attachments.length>0?\`${zj}${t}:batch\`:void 0` (@4163609), và `t.kind==="user-attachment"&&t.batchId!=null?…\`ua:${t.batchId}\`` (@3472914).
- `channel`/`channelSender` là **kênh ngoài** (Slack…), không phải bot↔bot: `if(e&&t.channelSender!=null)return\`channel:${t.channelSender}\`` (@2776296) và nhãn `HBKv6f`.
- `parentAgentId`: chỉ xuất hiện 1 lần trong `index-DO1aF_xy.js`, **không** trong phong bì tin nhắn.

### 3c. Client vẽ chuỗi bot↔bot thành một dòng gộp

Predicate gom nhóm (@3476488): `function Den(t){return t.kind==="message"&&Cd(t)}`; các entry liền nhau thoả `Den` được gộp thành hàng `agent-comm-group`. Nhãn (@3471766):

| Trường hợp | hash | tiếng Anh |
|---|---|---|
| 1 tin, inbound | `tWQgTD` | `"Message from {0}"` |
| 1 tin, outbound | `SGs2Aj` | `"Messaged {0}"` |
| fanout ≥2 peer, toàn outbound | `CFIQ32` | `"Messaged # Bot(s)"` |
| chuỗi qua lại | `HF2zbm` | `"# message(s) with # Bot(s)"` |

Tác giả bong bóng (@2777293): `if(t.fromAgent!=null)return xe._({id:"hGDVDa",values:{0:t.fromAgent.name}})` → `hGDVDa` = `["From ", {0}]`, `Ho3Yfu` = `["To ", {recipient}]`.

### 3d. `conversationPartnerIds` dùng vào đâu

Đồ thị mạng bot. Chuỗi mô tả `Bbs87x`:

> `"Solid links are real agent-to-agent message history; dashed links are group membership. A link lights up while both agents are mid-turn. Scroll to zoom, drag to pan, double-click to reset."`

và `w3HQhq`: `"Bots and groups, linked by who has messaged whom (solid) and group membership (dashed). Click a node to open it."`

Tính năng này bị chặn sau feature-gate `sand_agent_network` (@3805048):
> `PCe={agentNetwork:"sand_agent_network"};function wun(t){return t.isAgentNetworkEnabled&&t.hasAgents}`

(Gate riêng cho phòng chia sẻ nhiều người: `grok_bot_multiplayer`, @1637610.)

### 3e. Điều phối lượt nói trong phòng — proto có, client không gọi

`main.cjs` @3428775:

> `_W.typeName="aiserver.v1.RequestGrokBotRoomMemberTurnRequest";_W.fields=r.util.newFieldList(()=>[{no:1,name:"nonce",kind:"scalar",T:9},{no:2,name:"room",kind:"message",T:cJe},{no:3,name:"member_agent_id",kind:"scalar",T:9},{no:4,name:"peers",kind:"message",T:dJe,repeated:!0},{no:5,name:"new_messages",kind:"message",T:mJe,repeated:!0},{no:6,name:"is_winding_down",kind:"scalar",T:8},{no:7,name:"deadline_ms",kind:"scalar",T:3}]);`

Các thành phần:

- `GrokBotRoomMemberTurnRoom` (@3425238): `id, name, description, is_shared_room, shared_room_id`
- `GrokBotRoomMemberTurnPeer` (@3425955): `id, name, description`
- `GrokBotRoomMemberTurnMessage` (@3426550): `speaker_kind, speaker_name, is_self, text, reply_to`, với enum `SpeakerKind` = `UNSPECIFIED | HUMAN | AGENT`
- Đáp: `dispatch` ∈ `ACCEPTED | DUPLICATE | NOT_TEMPORAL | TARGET_NOT_FOUND | TEMPORAL_UNAVAILABLE` (@3340980), kèm `workflow_id`

Đây chính là hình dạng của "một vòng nói trong phòng": server gọi từng thành viên một, đưa vào danh sách peer + các tin mới + `is_winding_down` (cờ hạ nhiệt để vòng dừng) + `deadline_ms`. **`is_winding_down` là bằng chứng rõ nhất rằng vòng nói được điều phối ở phía server, không phải client.** Client không có mã nào chạm vào nó.

Client gửi prompt cho nhóm bằng **một** lời gọi duy nhất mang `agentId` của nhóm (@4164080):
> `{agentId:e.agentId,prompt:e.prompt,clientNonce:t.nonce,directAddressedAcceptance:!0,…}`

Việc "ai trong nhóm nói" client chỉ **đọc** từ roster (@3368769):
> `function GZt(t,e){if(t==null||!t.isGroup)return[];const n=new Map(e.map(i=>[i.id,i]));const s=[];for(const i of t.memberIds){const a=n.get(i);a!=null&&Zmt(a)&&s.push(a)}…}` với `function Zmt(t){return t.isRunningTurn??t.isRunning}`

Còn `isRunningTurn` do server đẩy: `aiserver.v1.GrokBotAgentLiveState` (`main.cjs` @3360461) mang `is_running, is_composing_message, is_retrying, activity, awaiting, updated_at_ms, stale_after_ms`.

---

## 4. Cái gì làm một lượt BẮT ĐẦU mà không có prompt

| # | Cơ chế | Bằng chứng | Ai quyết định |
|---|---|---|---|
| 1 | **Kickstart lúc tạo bot** — tạo bot mà không gõ gì thì client tự xin bot "tự giới thiệu" | xem dưới | **Client quyết định** (một lần duy nhất) |
| 2 | **Routine / Automation theo lịch** | `runAgentAutomationNow`, cron/`@every` | Client tạo lịch; **box chạy** |
| 3 | **Automation theo sự kiện ngoài** (Slack/GitHub/Linear/Sentry/PagerDuty/Teams/webhook) | `Dxn`/`qNt` @2488857 | **Ngoài client hoàn toàn** |
| 4 | **Bot nhắn bot** (`SendGrokBotAgentMessage`) | §3a | **Server/box** — client chỉ hiển thị |
| 5 | **Vòng nói trong phòng** (`RequestGrokBotRoomMemberTurn`) | §3e | **Server/box** — client chỉ hiển thị |
| 6 | **Broadcast** | `broadcastToAgents` @1621296 | Client, do người dùng bấm |
| 7 | **Nudge trong cuộc gọi thoại** | `nudgeVoiceCall` @3752756 | Client, nhưng chỉ khi đang có cuộc gọi *và* do một `toolCall` kích |

### #1 chi tiết — đây là thứ hay bị nhầm là "bot tự chạy"

Luồng tạo bot một-người `Zdn` (`index-DO1aF_xy.js` @3853350). `d` = "có nội dung để gửi":

> `const f=await s.createAgent({name:ek(t.name),description:a,…},{isKickstartRequested:!d});return l.setAgentId(f.agent.id),l.isAbandoned()||s.selectAgent(f.agent.id),d?(l.noteSendingFirstMessage(),s.sendFirstMessage(f.agent.id,u,r)):await s.kickstartAwaitingFirstMessage(f.agent.id),f.agent.id`

Cờ này đi thẳng vào proto (`main.cjs` @3374642, trong `CreateGrokBotAgentRequest`):

> `{no:10,name:"kickstart_requested",kind:"scalar",T:8,opt:!0},{no:11,name:"introduction_suppressed",kind:"scalar",T:8,opt:!0},{no:12,name:"purpose",kind:"scalar",T:9,opt:!0}`

Thực thi (@4103288):
> `kickstartAwaitingFirstMessage:async N=>{d(N);let R;try{R=await t.kickstartAgent(N)}catch(I){throw f(N),I}R?.isIntroductionInFlight===!1&&(…)}`

Chiều ngược lại tồn tại: `Jdn` (@3853xxx cuối `Zdn`) tạo bot với `{isIntroductionSuppressed:!0}` khi người dùng chỉ muốn có bot mà chưa muốn nó nói.

**Không có timer nào trong client mở lượt.** Thứ duy nhất trông giống timer là watchdog UI 20 giây, và nó chỉ đánh dấu "timed-out" cho spinner tạo bot (@4101859):
> `const G2n=2e4,W2n={name:"launcher-create-safety",idleMs:G2n};` … `o=t.safetyWatchdog.arm(()=>{o=null,x("timed-out")})`

### #2/#3 chi tiết — routine

Lịch được biên dịch thành cron thật (@2484083):
> `case"hourly":return\`${t.minute} * * * *\`;… case"interval":return\`@every ${t.amount}${MNt[t.unit]}\`;`

Trigger sự kiện (@2488857):
> `case"webhook":return{platform:dSe}}}function qNt(t){switch(t.type){case"cron":return{platform:"schedule",schedule:t.schedule};case"slack":…`

với các nền tảng `slack | github | microsoftTeams | linear | sentry | pagerduty | webhook`, và `dSe="webhook"` (@2473318).

Routine chỉ để lại **một loại sự kiện** trong transcript — `automation-changed` — chứ không có sự kiện "routine vừa chạy" (@3455907):
> `function RH(t){switch(t.type){case"name-changed":…case"channel-connected":…case"channel-disconnected":…case"automation-changed":{const e=$T(t.action)??xe._({id:"cNsIJf"});…}}`

Nghĩa là: **khi routine chạy, người dùng chỉ thấy bot đột nhiên nói — không có dòng "vì routine X"** trong dòng chảy chat. Đây gần như chắc chắn là thứ tạo cảm giác "bot tự làm việc mà không ai bảo".

---

## 5. Ta đang có gì / thiếu gì

| Hành vi app gốc | grokbot2 hôm nay | Ghi chú |
|---|---|---|
| Nhóm = `AgentRecord` có `isGroup` + `memberIds` | **Có** — `services/grokbot-backend/src/directory/index.ts:131` `rec.isGroup = true; rec.memberIds = [...new Set(wanted)]` | Cùng hình dạng, không thêm bảng |
| `createGroup` / `setGroupMembers` qua gateway | **Có** — `directory/index.ts:126` và `:142`; đăng ký ở `gateway.ts:109` | |
| Trần 6 thành viên (`nw=6`) | **Không cưỡng chế ở backend** | Client tự chặn; backend nhận bao nhiêu cũng lấy |
| `conversationPartnerIds` (đồ thị "ai từng nhắn ai") | **Trả rỗng cứng** — `directory/index.ts:59` `conversationPartnerIds: []` | Nét liền của đồ thị mạng bot sẽ luôn trống |
| `isAgentNetworkEnabled` capability | **Không có** trong `gateway.ts` | Màn hình đồ thị mạng bot không mở được |
| Bot nhắn bot, hai đầu đều có entry | **Có** — `runtime/turn.ts:672` (`toAgent`) và `:680` (`fromAgent` qua `sendPrompt`) | Đúng phong bì client đọc |
| Tên tool | ta dùng `message_agent` (`runtime/tools.ts:205`); comment ở `:202` ghi bản gốc là `send_message` | Tên tool nội bộ, client không thấy |
| Chống vòng lặp bot↔bot | **Có, kiểu khác** — `runtime/turn.ts:651` `const MAX_HOPS = 3` + reset ở `:829` khi tin đến từ người | Bản gốc dùng `is_winding_down` + `deadline_ms` do server điều phối (§3e) |
| Vòng nói trong nhóm | **Có, tự làm** — `turn.ts:899` lần lượt từng thành viên, dựng lại history mỗi lượt; `namedMembers()` (`:739`) để gọi tên ai thì chỉ người đó nói | Bản gốc: `RequestGrokBotRoomMemberTurn` với `peers` + `new_messages` + `is_winding_down` |
| "Trả lời của bot không mở vòng mới" | **Có** — `turn.ts:899` `if (members.length && !args.fromAgent)` | Cùng nguyên tắc |
| Kickstart lúc tạo bot | **Là no-op** — `directory/index.ts:339` chỉ `rec.unread=false; persist(); return rec` | Bot mới **không tự giới thiệu**; đây là khác biệt hành vi thấy được ngay |
| `introduction_suppressed` / `isIntroductionInFlight` | **Không có** | Client đọc `R?.isIntroductionInFlight===!1` để rời trạng thái chờ |
| Routine theo lịch + sự kiện | **Có** — `automations.ts` đủ `create/update/delete/setEnabled/runNow`, `fire()` `:484`, `matchesEvent()` `:661` | |
| `GrokBotAgentLiveState` (`activity`, `awaiting`, `stale_after_ms`) | **Một phần** — ta đẩy `isRunning`/`isComposingMessage` | `currentActivity`/`activeRemoteMemberId` chưa đẩy → chỉ báo "ai đang nói trong nhóm" nghèo hơn |
| Phòng chia sẻ nhiều người (`isSharedRoom`) | **Không có** | Gate `grok_bot_multiplayer`, ngoài phạm vi hiện tại |

---

## 6. KHÔNG TRÍCH XUẤT ĐƯỢC

Những thứ dưới đây **không nằm trong client**; đừng tìm lại trong bundle:

1. **Luật quyết định khi nào một vòng phòng bắt đầu.** Client chỉ có định nghĩa proto `RequestGrokBotRoomMemberTurn`, không có chỗ gọi, không có điều kiện. Ai gọi, gọi mấy lần, dừng khi nào — nằm ở server.
2. **Ý nghĩa và cách tính `is_winding_down` và `deadline_ms`.** Chỉ có tên trường, không có mã dùng.
3. **Bộ đếm hop / trần vòng lặp của bản gốc.** Không có hằng số nào tương đương `MAX_HOPS` trong client.
4. **Tool mà bot dùng để nhắn bot khác** (tên, schema tham số). Client chỉ thấy *kết quả* — entry có `fromAgent`/`toAgent`. Tên `send_message` trong repo ta chỉ là ghi chú ở `runtime/tools.ts:202`, tôi **không** xác minh được nó từ bundle.
5. **Có cơ chế nào ở server tự tạo nhóm không.** Client không tự tạo (đúng 2 chỗ gọi, cả hai do người dùng bấm) và `GrokBotAgent` proto không mang cờ nhóm — nên nếu nhóm "tự xuất hiện", nó phải do box tạo, và mã đó không có trong bundle này.
6. **Ý nghĩa các giá trị `origin` của bản ghi bot.** Renderer chỉ đọc `typeof t.origin=="string"`; không có bảng liệt kê giá trị nào ứng với "bot do hệ thống tạo".
7. **Nội dung prompt của lượt kickstart / introduction.** Client chỉ gửi cờ `kickstart_requested`; văn bản do phía kia sinh.
8. **Catalog tiếng Anh cho vài hash** không cần thiết đã bỏ qua; catalog tiếng Anh nằm inline trong `index-DO1aF_xy.js` quanh @44389 (các file `chat-*.js` là bản dịch, không phải nguồn).

---

## 7 · Ba điều tôi tự đo THÊM sau khi workflow xong

### 7.1 — `conversationPartnerIds` đã vá (mục 5 của báo cáo trên đã cũ)

Báo cáo ghi `directory/index.ts:59 conversationPartnerIds: []` là "trả rỗng cứng". Đúng lúc nó
quét, và **đã vá** ngay sau đó: giờ tính từ `fromAgent`/`toAgent` thật trong bản ghi, nhớ tạm theo
độ dài bản ghi, lọc bot đã xoá ở lúc ĐỌC. Xem `directory-partners.test.ts` (4 bài).

Đáng ghi lại vì đây là **lần thứ ba cùng một loài lỗi trong cùng hàm `summarise`**: `isGroup` từng
hardcode `false`, `memberIds` từng hardcode `[]`, và giờ là trường này. Cả ba đứng SAU `...a` nên
im lặng đè lên sự thật của record. Cái bẫy không nằm ở từng dòng mà ở hình dạng hàm.

### 7.2 — `kickstartAgent` no-op làm client kẹt ở trạng thái chờ

Xác nhận claim của báo cáo, và **hậu quả còn nặng hơn báo cáo nói**. Client:

```js
kickstartAwaitingFirstMessage: async N => {
  d(N);                                             // vào tập "đang chờ tin đầu"
  R = await t.kickstartAgent(N);
  R?.isIntroductionInFlight === false && ( … f(N) )  // CHỈ khi === false mới rời trạng thái chờ
}
```

Ta trả `{unread:false, …}` không mang `isIntroductionInFlight`, nên `undefined === false` là sai →
`f(N)` không chạy → bot mới **nằm mãi trong "awaiting first message"**. Không phải chỉ "bot không
tự giới thiệu"; là client kẹt ở một trạng thái không có gì gỡ.

Hai lối đi, và phải chọn có chủ ý:

* **Thành thật rẻ tiền:** trả `isIntroductionInFlight: false`. Client rời trạng thái chờ ngay, bot
  im lặng. Đúng với sự thật là ta không làm lời giới thiệu.
* **Đúng parity:** trả `true` rồi thật sự mở một lượt để bot tự giới thiệu. Đây chính là cơ chế
  **#1** trong bảng mục 4 — cơ chế duy nhất mà CLIENT quyết định mở lượt không cần prompt.

### 7.3 — Kiểm chứng độc lập luận điểm chính

Ba phép đếm tôi tự chạy, xác nhận mục 1:

```
RoomMemberTurn trong toàn bộ renderer            → 0
requestGrokBotRoomMemberTurn trong main.cjs      → 1   (chỉ dòng descriptor)
sendGrokBotAgentMessage      trong main.cjs      → 1   (chỉ dòng descriptor)
client THẬT SỰ gọi: createGroup 14 · kickstartAgent 7 · runAgentAutomationNow 3 · setGroupMembers 5
```

Nghĩa là: **quyền tự chủ của bot bên hãng nằm ở server, không ở client.** Với ta điều đó không phải
tin xấu — ta LÀ server. Nhưng nó có nghĩa là không có logic nào để chép: phải tự viết.
