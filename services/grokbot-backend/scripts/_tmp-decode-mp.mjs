import { listMarketplacePlugins, getEffectiveUserPlugins } from "../../../packages/grokbot-proto/dist/bootstrap.js";

function decode(buf, indent = "") {
  let i = 0;
  const lines = [];
  while (i < buf.length) {
    const start = i;
    let tag = 0, shift = 0;
    while (i < buf.length) {
      const b = buf[i++];
      tag |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
      if (shift > 35) return lines.concat(indent + "bad tag");
    }
    const field = tag >>> 3;
    const wire = tag & 7;
    if (wire === 0) {
      let v = 0n, s = 0n;
      while (i < buf.length) {
        const b = BigInt(buf[i++]);
        v |= (b & 0x7fn) << s;
        if ((b & 0x80n) === 0n) break;
        s += 7n;
      }
      lines.push(`${indent}#${field} varint ${v}`);
    } else if (wire === 2) {
      let len = 0, s = 0;
      while (i < buf.length) {
        const b = buf[i++];
        len |= (b & 0x7f) << s;
        if ((b & 0x80) === 0) break;
        s += 7;
      }
      const inner = buf.subarray(i, i + len);
      i += len;
      const str = inner.toString("utf8");
      const printable = inner.length > 0 && /^[\x20-\x7e]+$/.test(str);
      if (printable) lines.push(`${indent}#${field} str ${JSON.stringify(str)}`);
      else {
        lines.push(`${indent}#${field} msg[${len}]`);
        lines.push(...decode(inner, indent + "  "));
      }
    } else {
      lines.push(`${indent}#${field} wire${wire} @${start} STOP`);
      break;
    }
  }
  return lines;
}

const a = listMarketplacePlugins();
console.log("=== ListMarketplacePlugins", a.length);
console.log(decode(a).join("\n"));
console.log("=== GetEffectiveUserPlugins", getEffectiveUserPlugins().length);
console.log(decode(getEffectiveUserPlugins()).join("\n"));
