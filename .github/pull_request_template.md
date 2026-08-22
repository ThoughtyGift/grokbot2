# Gì và vì sao

<!-- Một đoạn: thay đổi gì, và vì sao cần. Nếu là sửa lỗi, nói cả cách phát hiện. -->

## Số đo

<!-- Không có số thì không tính là xong (docs/onboarding.md §4). Điền cái nào liên quan. -->

| | trước | sau |
|---|---|---|
| `pnpm self-xray` | | |
| `pnpm ui:diff` (nếu chạm giao diện) | | |
| bài e2e liên quan | | |

## Kiểm

- [ ] `pnpm typecheck`
- [ ] `pnpm self-xray` — **9 mục xanh**, hoặc nói rõ mục nào đỏ và vì sao chấp nhận
- [ ] Đổi hành vi thì có bài e2e **ghi nhật ký** (`recordRun`), không chỉ chạy tay một lần

## Nếu thay đổi thuộc loại này

- [ ] **Route `/v1` mới** → khai schema trong `packages/api-contract` + thêm dòng vào `ROUTES` + `pnpm api:gen`
- [ ] **Vùng giao diện mới** → thêm anchor vào `scripts/ui-anchors.mjs`, nếu không nó nằm ngoài mẫu số và con số `ui:diff` thành nói dối
- [ ] **Quyết định kiến trúc** → một ADR trong `docs/adr/`, kèm *Đã cân nhắc gì khác*
- [ ] **File/tài liệu mới** → có tên trong `docs/README.md` hoặc README của thư mục
- [ ] **Vượt ngưỡng refactor** (`docs/plan/system-pipeline.md` §T5) → nói rõ vì sao chấp nhận, rồi cập nhật mốc trong `docs/state/self-xray-baseline.json`

## Ranh giới

- [ ] Không chép CSS/bundle/asset của client hãng ([docs/legal.md](../docs/legal.md)). Muốn giống thì **đo rồi tự viết**.
- [ ] Không commit khoá: `pool-key.txt`, `.env`, `*-key.txt`

<!--
Ô tick không phải hình thức. Bốn lần trong quá khứ dự án tưởng "đã sửa" mà chưa —
vì thước đo báo sai và không ai chạy lại. Xem docs/parity.md.
-->
