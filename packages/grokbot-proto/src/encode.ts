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

/**
 * Một khung end-of-stream MANG LỖI — cách Connect báo lỗi trên đường `connect+proto`/`connect+json`
 * (unary thì dùng HTTP status + JSON `{code,message}`, xem ACL). `code` là chuỗi Connect: `not_found`…
 */
export function connectStreamError(code: string, msg: string): Buffer {
  const end = Buffer.from(JSON.stringify({ error: { code, message: msg } }));
  const eh = Buffer.alloc(5);
  eh[0] = 2;
  eh.writeUInt32BE(end.length, 1);
  return Buffer.concat([eh, end]);
}

/**
 * Read one top-level varint field out of a protobuf message. Returns null when absent.
 *
 * The bootstrap gates have been write-only until now — every builder produced bytes and nothing
 * parsed the request. `InstallUserPlugin` is the first RPC whose ARGUMENT matters (which plugin), so
 * this is the smallest reader that answers it: walk the top level, skip other fields by wire type,
 * return the varint for `fieldNo`. Deliberately not a general decoder — a full parser would be more
 * code than the one field it exists to read.
 *
 * A ConnectRPC body may be length-prefixed framing (5-byte header) rather than a bare message; the
 * caller strips that first (`unframe`).
 */
export function readVarintField(buf: Buffer, fieldNo: number): number | null {
  let i = 0;
  const varint = (): number => {
    let v = 0, shift = 0;
    while (i < buf.length) {
      const b = buf[i++];
      v += (b & 0x7f) * 2 ** shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
    }
    return v;
  };
  while (i < buf.length) {
    const key = varint();
    const no = key >>> 3;
    const wire = key & 7;
    if (wire === 0) {
      const v = varint();
      if (no === fieldNo) return v;
    } else if (wire === 2) {
      const len = varint();
      i += len;
    } else if (wire === 5) { i += 4; }
    else if (wire === 1) { i += 8; }
    else return null;   // unknown wire type — stop rather than misread
  }
  return null;
}

/**
 * Strip Connect's length-prefixed framing if present, returning the bare message.
 *
 * `application/connect+proto` puts a 5-byte header (1 flag + 4-byte big-endian length) in front of
 * the message; `application/proto` does not. Detected by checking whether the declared length
 * matches what follows, so a bare message that happens to start with 0x00 is not mangled.
 */
export function unframe(body: Buffer): Buffer {
  if (body.length >= 5 && (body[0] === 0 || body[0] === 1)) {
    const len = body.readUInt32BE(1);
    if (len === body.length - 5) return body.subarray(5);
  }
  return body;
}
