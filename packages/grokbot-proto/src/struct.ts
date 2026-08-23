/**
 * `google.protobuf.Struct` — arbitrary JSON on the protobuf wire.
 *
 * Two Plugin fields need it, and both were the reason a feature looked missing rather than unbuilt:
 *
 *   Plugin.variables (38)                  — a JSON Schema describing the credentials a plugin wants.
 *                                            The client turns it into the "setup" form shown on Add.
 *   InstallUserPluginRequest.variables (5) — the values the person typed into that form.
 *
 * So this is the first place the backend must both WRITE and READ a message: the encoder in
 * encode.ts was write-only, and readVarintField reads a single scalar. Struct is a map of oneofs,
 * which neither covers.
 *
 * Wire shape, verbatim from the well-known type:
 *   Struct    { map<string, Value> fields = 1 }   — a map entry is a message { key=1, value=2 }
 *   Value     { null=1 (enum) · number=2 (double) · string=3 · bool=4 · struct=5 · list=6 }
 *   ListValue { repeated Value values = 1 }
 */
import { varint, pbStr, pbVar, pbBool, pbF64, pbMsg, message } from "./encode.js";

/** What survives a round trip through Struct — JSON, minus `undefined`. */
export type StructValue = string | number | boolean | null | StructValue[] | { [k: string]: StructValue };

function value(v: StructValue): Buffer {
  if (v === null) return pbVar(1, 0);                                    // NullValue.NULL_VALUE
  if (typeof v === "number") return pbF64(2, v);
  if (typeof v === "string") return pbStr(3, v);
  if (typeof v === "boolean") return pbBool(4, v);
  if (Array.isArray(v)) return pbMsg(6, message(...v.map((x) => pbMsg(1, value(x)))));
  return pbMsg(5, struct(v));
}

/** Encode a plain object as a Struct body (no field tag — see `pbStruct`). */
export function struct(obj: Record<string, StructValue>): Buffer {
  return message(
    ...Object.entries(obj).map(([k, v]) => pbMsg(1, message(pbStr(1, k), pbMsg(2, value(v))))),
  );
}

/** A Struct as field `no` of an enclosing message. */
export const pbStruct = (no: number, obj: Record<string, StructValue>): Buffer => pbMsg(no, struct(obj));

// ── reading ───────────────────────────────────────────────────────────────────

/** A cursor over one buffer. Kept local: the encoder's reader walks only the top level. */
interface Cur { buf: Buffer; i: number }

function readVarint(c: Cur): number {
  let v = 0, shift = 0;
  while (c.i < c.buf.length) {
    const b = c.buf[c.i++];
    v += (b & 0x7f) * 2 ** shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
  }
  return v;
}

/** Walk one message, handing each field's number and payload to `on`. Unknown wire types stop it. */
function fields(buf: Buffer, on: (no: number, wire: number, c: Cur, len: number) => void): void {
  const c: Cur = { buf, i: 0 };
  while (c.i < buf.length) {
    const key = readVarint(c);
    const no = key >>> 3, wire = key & 7;
    if (wire === 2) {
      const len = readVarint(c);
      const at = c.i;
      on(no, wire, c, len);
      c.i = at + len;                 // `on` may read ahead; the length is authoritative
    } else if (wire === 0) {
      const at = c.i;
      on(no, wire, c, 0);
      c.i = at;
      readVarint(c);
    } else if (wire === 5) { on(no, wire, c, 4); c.i += 4; }
    else if (wire === 1) { on(no, wire, c, 8); c.i += 8; }
    else return;
  }
}

function parseValue(buf: Buffer): StructValue {
  let out: StructValue = null;
  fields(buf, (no, wire, c, len) => {
    if (no === 1 && wire === 0) out = null;
    else if (no === 2 && wire === 1) out = c.buf.readDoubleLE(c.i);
    else if (no === 3 && wire === 2) out = c.buf.subarray(c.i, c.i + len).toString("utf8");
    else if (no === 4 && wire === 0) out = readVarint({ buf: c.buf, i: c.i }) !== 0;
    else if (no === 5 && wire === 2) out = parseStruct(c.buf.subarray(c.i, c.i + len));
    else if (no === 6 && wire === 2) {
      const items: StructValue[] = [];
      fields(c.buf.subarray(c.i, c.i + len), (n2, w2, c2, l2) => {
        if (n2 === 1 && w2 === 2) items.push(parseValue(c2.buf.subarray(c2.i, c2.i + l2)));
      });
      out = items;
    }
  });
  return out;
}

/** Decode a Struct body into a plain object. Malformed input yields `{}`, never a throw. */
export function parseStruct(buf: Buffer): Record<string, StructValue> {
  const out: Record<string, StructValue> = {};
  try {
    fields(buf, (no, wire, c, len) => {
      if (no !== 1 || wire !== 2) return;
      let key: string | null = null;
      let val: StructValue = null;
      fields(c.buf.subarray(c.i, c.i + len), (n2, w2, c2, l2) => {
        if (n2 === 1 && w2 === 2) key = c2.buf.subarray(c2.i, c2.i + l2).toString("utf8");
        else if (n2 === 2 && w2 === 2) val = parseValue(c2.buf.subarray(c2.i, c2.i + l2));
      });
      if (key !== null) out[key] = val;
    });
  } catch {
    return {};
  }
  return out;
}

/**
 * Read a Struct field out of a message and return it as `Record<string, string>`.
 *
 * The one caller — the credential form's submitted values — only ever sends strings, and coercing
 * here keeps the decision in one place rather than at every use.
 */
export function readStringMapField(buf: Buffer, fieldNo: number): Record<string, string> {
  let found: Buffer | null = null;
  fields(buf, (no, wire, c, len) => {
    if (no === fieldNo && wire === 2) found = c.buf.subarray(c.i, c.i + len);
  });
  if (!found) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parseStruct(found))) {
    if (typeof v === "string") out[k] = v;
    else if (typeof v === "number" || typeof v === "boolean") out[k] = String(v);
  }
  return out;
}
