/**
 * Nút "Always allow" của thẻ chạm máy đi bằng `setHostSettings`, không bằng `resolveLocalToolPermission`.
 *
 * Đo 07/09 trên client 0.43 thật, một lượt của người dùng: 15 lời gọi `setHostSettings`
 * `{localToolPermission:"always", localToolPermissionMachineId:"<uuid>"}` và **0** lời gọi
 * `resolveLocalToolPermission`. Trước bản sửa, thẻ nằm `pending` vĩnh viễn và mỗi lệnh sau lại
 * chồng thêm một thẻ — người dùng thấy "bấm rồi mà treo mãi".
 *
 * Bài này ghim ĐƯỜNG ĐI (commands.ts → runtime port), không ghim nội tạng của `turn.ts`: cái hỏng
 * là chỗ nối giữa hai bên, và cả hai bên đều đúng theo chuẩn của riêng chúng.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCommands } from "@grokbot2/cursor-acl";
import type { AclPorts, Call } from "@grokbot2/cursor-acl";

/** Cổng giả tối thiểu: chỉ hai thứ lệnh này chạm tới, phần còn lại ném nếu bị gọi nhầm. */
function dungCong(): { ports: AclPorts; daNhan: unknown[]; daVaCaiDat: unknown[] } {
  const daNhan: unknown[] = [];
  const daVaCaiDat: unknown[] = [];
  const nem: Call = () => { throw new Error("cổng này không được gọi trong bài đo"); };
  const ports = {
    identity: {
      patchHostSettings: (patch: unknown) => { daVaCaiDat.push(patch); return { ok: true } as Record<string, unknown>; },
      getHostSettings: () => ({}),
    },
    runtime: {
      applyLocalToolPermissionSetting: ((a: unknown) => { daNhan.push(a); return { resolved: 1 }; }) as Call,
      resolveLocalToolPermission: nem,
    },
  } as unknown as AclPorts;
  return { ports, daNhan, daVaCaiDat };
}

test("cài đặt mang MÃ MÁY thì gỡ thẻ đang chờ — đây là cú bấm Always allow của client 0.43", () => {
  const { ports, daNhan, daVaCaiDat } = dungCong();
  const cmd = buildCommands(ports);
  cmd.setHostSettings!({ localToolPermission: "always", localToolPermissionMachineId: "a5934d1c-1763-4308-8bdd-0872dc9a21b4" });
  assert.equal(daNhan.length, 1, "phải chuyển sang runtime đúng một lần");
  assert.deepEqual(daNhan[0], { permission: "always", machineId: "a5934d1c-1763-4308-8bdd-0872dc9a21b4" });
  assert.equal(daVaCaiDat.length, 1, "vẫn phải vá cài đặt như cũ — không thay đường cũ bằng đường mới");
});

test("`never` kèm mã máy cũng là câu trả lời — từ chối, không bỏ lửng", () => {
  const { ports, daNhan } = dungCong();
  buildCommands(ports).setHostSettings!({ localToolPermission: "never", localToolPermissionMachineId: "m-2" });
  assert.deepEqual(daNhan[0], { permission: "never", machineId: "m-2" });
});

test("đổi mức trong Settings (KHÔNG có mã máy) thì thẻ vẫn phải chờ người dùng bấm", () => {
  const { ports, daNhan, daVaCaiDat } = dungCong();
  buildCommands(ports).setHostSettings!({ localToolPermission: "always" });
  assert.equal(daNhan.length, 0, "thiếu mã máy = không phải câu trả lời cho máy đang hỏi");
  assert.equal(daVaCaiDat.length, 1, "cài đặt vẫn được vá");
});

test("patch không dính tới quyền thì không đụng tới thẻ", () => {
  const { ports, daNhan } = dungCong();
  buildCommands(ports).setHostSettings!({ userTimeZone: "Asia/Ho_Chi_Minh" });
  assert.equal(daNhan.length, 0);
});

test("cổng cũ chưa có hàm mới thì setHostSettings vẫn chạy — không ném", () => {
  const { ports, daVaCaiDat } = dungCong();
  delete (ports.runtime as { applyLocalToolPermissionSetting?: unknown }).applyLocalToolPermissionSetting;
  buildCommands(ports).setHostSettings!({ localToolPermission: "always", localToolPermissionMachineId: "m-3" });
  assert.equal(daVaCaiDat.length, 1);
});
