/**
 * Reading protobuf, not just writing it.
 *
 * This package was write-only for a long time: every builder produced bytes and the one reader,
 * `readVarintField`, answered a single scalar because `InstallUserPlugin` needed a plugin id and
 * nothing more. The MCP OAuth family cannot be served that way — its requests carry strings,
 * repeated strings and nested messages, and answering them without reading them would mean storing
 * a credential under the wrong key, or reporting a sign-in that saved nothing.
 *
 * Deliberately small: enough to walk a message and pull out the fields a handler names. No schema,
 * no code generation — the field numbers live at each call site, next to the comment saying which
 * descriptor they were read from.
 */

interface Field { no: number; wire: number; at: number; len: number }

/** Walk the top level of a message. Malformed input stops the walk rather than throwing. */
function* walk(buf: Buffer): Generator<Field> {
  let i = 0;
  const varint = (): number => {
    let v = 0, shift = 0;
    while (i < buf.length) {
      const b = buf[i++];
      v += (b & 0x7f) * 2 ** shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
      if (shift > 63) return v;
    }
    return v;
  };
  while (i < buf.length) {
    const key = varint();
    const no = key >>> 3, wire = key & 7;
    if (wire === 0) { const at = i; varint(); yield { no, wire, at, len: i - at }; }
    else if (wire === 2) {
      const len = varint();
      if (i + len > buf.length) return;
      yield { no, wire, at: i, len };
      i += len;
    } else if (wire === 5) { yield { no, wire, at: i, len: 4 }; i += 4; }
    else if (wire === 1) { yield { no, wire, at: i, len: 8 }; i += 8; }
    else return;   // unknown wire type: stop rather than misread the rest
  }
}

/** The last value of a string field, or "" when absent — proto3 semantics for a scalar. */
export function readString(buf: Buffer, fieldNo: number): string {
  let out = "";
  for (const f of walk(buf)) if (f.no === fieldNo && f.wire === 2) out = buf.subarray(f.at, f.at + f.len).toString("utf8");
  return out;
}

/** Every value of a repeated string field, in order. */
export function readStrings(buf: Buffer, fieldNo: number): string[] {
  const out: string[] = [];
  for (const f of walk(buf)) if (f.no === fieldNo && f.wire === 2) out.push(buf.subarray(f.at, f.at + f.len).toString("utf8"));
  return out;
}

/** Every value of a repeated (or singular) message field, as raw bodies to read again. */
export function readMessages(buf: Buffer, fieldNo: number): Buffer[] {
  const out: Buffer[] = [];
  for (const f of walk(buf)) if (f.no === fieldNo && f.wire === 2) out.push(buf.subarray(f.at, f.at + f.len));
  return out;
}

/** The last value of a varint field (int32/int64/enum/bool), or `undefined` when absent. */
export function readVarint(buf: Buffer, fieldNo: number): number | undefined {
  let out: number | undefined;
  for (const f of walk(buf)) {
    if (f.no !== fieldNo || f.wire !== 0) continue;
    let v = 0, shift = 0, i = f.at;
    for (;;) {
      const b = buf[i++];
      v += (b & 0x7f) * 2 ** shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
      if (i >= buf.length) break;
    }
    out = v;
  }
  return out;
}

/** A `map<string, string>` field — encoded as repeated messages of `{key @1, value @2}`. */
export function readStringMap(buf: Buffer, fieldNo: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readMessages(buf, fieldNo)) {
    const k = readString(entry, 1);
    if (k) out[k] = readString(entry, 2);
  }
  return out;
}

/**
 * Every value of a repeated varint field.
 *
 * Handles both encodings, because a sender may choose either: the field repeated once per value, and
 * the packed form where one length-delimited run holds them all. Reading only the unpacked spelling
 * would return nothing for a packed `server_ids` and silently look like "no servers asked for".
 */
export function readVarints(buf: Buffer, fieldNo: number): number[] {
  const out: number[] = [];
  for (const f of walk(buf)) {
    if (f.no !== fieldNo) continue;
    if (f.wire === 0) {
      let v = 0, shift = 0, i = f.at;
      for (;;) {
        const b = buf[i++];
        v += (b & 0x7f) * 2 ** shift;
        if ((b & 0x80) === 0 || i >= buf.length) break;
        shift += 7;
      }
      out.push(v);
    } else if (f.wire === 2) {
      let i = f.at;
      const end = f.at + f.len;
      while (i < end) {
        let v = 0, shift = 0;
        for (;;) {
          const b = buf[i++];
          v += (b & 0x7f) * 2 ** shift;
          if ((b & 0x80) === 0 || i >= end) break;
          shift += 7;
        }
        out.push(v);
      }
    }
  }
  return out;
}

/**
 * A length-delimited field as raw bytes.
 *
 * `readString` would work on the wire — `bytes` and `string` share wire type 2 — but decoding audio
 * as UTF-8 and re-encoding it corrupts it. Returns an empty buffer when the field is absent, so a
 * caller can tell "no audio" from "silence" only by length, which is the honest distinction here.
 */
export function readBytes(buf: Buffer, fieldNo: number): Buffer {
  let out = Buffer.alloc(0);
  // Copied rather than a subarray view: the caller keeps this past the request that owned the frame,
  // and a view into a recycled buffer is a bug that only shows up under load.
  for (const f of walk(buf)) if (f.no === fieldNo && f.wire === 2) out = Buffer.from(buf.subarray(f.at, f.at + f.len));
  return out;
}
