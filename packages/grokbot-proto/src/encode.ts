/**
 * Minimal protobuf wire encoder — enough to build the bootstrap ConnectRPC
 * responses the Grok Bot frontend needs (scalars, enums, bools, nested messages).
 *
 * ConnectRPC unary with `application/proto` sends the bare serialized message.
 * Field type codes (T) follow protobuf-es ScalarType: 5=int32, 8=bool, 9=string, enum=varint.
 */

export function varint(num: number | bigint): Buffer {
  const out: number[] = [];
  let n = BigInt(num);
  do {
    let b = Number(n & 0x7fn);
    n >>= 7n;
    if (n > 0n) b |= 0x80;
    out.push(b);
  } while (n > 0n);
  return Buffer.from(out);
}

const tag = (fieldNo: number, wire: number): Buffer => varint((fieldNo << 3) | wire);

/** string (wire type 2) */
export const pbStr = (no: number, s: string): Buffer => {
  const b = Buffer.from(s, "utf8");
  return Buffer.concat([tag(no, 2), varint(b.length), b]);
};
/** int32 / int64 / enum (wire type 0, varint) */
export const pbVar = (no: number, v: number | bigint): Buffer => Buffer.concat([tag(no, 0), varint(v)]);
/** bool */
export const pbBool = (no: number, v: boolean): Buffer => pbVar(no, v ? 1 : 0);
/** double (wire type 1) */
export const pbF64 = (no: number, x: number): Buffer => {
  const b = Buffer.alloc(8);
  b.writeDoubleLE(x);
  return Buffer.concat([tag(no, 1), b]);
};
/** nested message (wire type 2) */
export const pbMsg = (no: number, inner: Buffer): Buffer => Buffer.concat([tag(no, 2), varint(inner.length), inner]);

/** Concatenate encoded fields into one message body. */
export const message = (...parts: (Buffer | null | undefined)[]): Buffer =>
  Buffer.concat(parts.filter((p): p is Buffer => Boolean(p)));

/** Wrap a payload as a single Connect end-of-stream frame (for server-streaming replies). */
export function connectStreamEnd(dataFrame?: Buffer): Buffer {
  const frames: Buffer[] = [];
  if (dataFrame) {
    const h = Buffer.alloc(5);
    h[0] = 0;
    h.writeUInt32BE(dataFrame.length, 1);
    frames.push(h, dataFrame);
  }
  const end = Buffer.from("{}");
  const eh = Buffer.alloc(5);
  eh[0] = 2; // end-of-stream flag
  eh.writeUInt32BE(end.length, 1);
  frames.push(eh, end);
  return Buffer.concat(frames);
}
