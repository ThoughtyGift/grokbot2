/**
 * Kiểm reply của backend đang chạy theo **schema reply nhúng trong coordinator 0.43**.
 *
 *   node services/grokbot-backend/scripts/kiem-reply-0-43.mjs                 # quét mọi lệnh ĐỌC (noArgs / chỉ id)
 *   node services/grokbot-backend/scripts/kiem-reply-0-43.mjs getHostSettings 'openAgentTail:{"id":"agent-984","limit":500}'
 *   GW=http://host:8788/gw/api AGENT=agent-1 node …
 *
 * Vì sao có bài này (05/09): client 0.43 chạy với backend mình hiện "Can't reach your computer" + "Showing saved
 * messages" dù transport `connected`. Nguyên nhân KHÔNG ở kết nối: coordinator 0.43 (`dist/node-agent-coordinator/
 * main.cjs`) kiểm MỌI reply gateway bằng `ft(schema, reply, "structural")` và ném `SandGatewayMalformedReplyError`
 * ("gateway <lệnh> reply is malformed") — `getHostSettings` thiếu `notifications.allowedApps`, tin người dùng
 * thiếu `isStreaming`. Renderer thấy lỗi thì rơi về bản lưu và vẽ banner mất kết nối.
 *
 * Schema là `docs/extracted/gateway-schema-0.43.json` — rút từ hằng `RA` (base64 + deflate-raw) trong coordinator:
 *   JSON.parse(zlib.inflateRawSync(Buffer.from(RA, "base64")))  → { methods: {…: {args, reply}}, events, $defs, … }
 * Hàm `ft` dưới đây là bản chép đúng của hãng ở mode "structural": KHÔNG kiểm `enum`/`const`, KHÔNG bắt khoá thừa
 * (`additionalProperties:false` chỉ bắt ở mode "exact"), nhưng bắt `required`, kiểu, và `null` ở nơi không nullable.
 *
 * `anyOf` của hãng (`Tb`) còn chọn biến thể theo khoá phân biệt (`kind` const) để báo lỗi gọn; bản này báo lỗi
 * của mọi biến thể nối nhau — dài hơn nhưng cùng kết luận đúng/sai.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const GOC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const S = JSON.parse(readFileSync(join(GOC, "docs", "extracted", "gateway-schema-0.43.json"), "utf8"));
const GW = process.env.GW ?? "http://127.0.0.1:8788/gw/api";
const AGENT = process.env.AGENT ?? "agent-984";

const ef = (t) => (t?.$ref?.startsWith("#/$defs/") ? S.$defs[t.$ref.slice(8)] : t);

export function ft(t, e, o = "structural") {
  if (t.$ref != null) { const s = ef(t); return s == null ? `unresolved $ref ${t.$ref}` : ft(s, e, o); }
  if (t.anyOf != null) { const errs = t.anyOf.map((d) => ft(d, e, o)); return errs.some((x) => x == null) ? null : "anyOf(" + errs.join(" | ") + ")"; }
  if (t.oneOf != null) return t.oneOf.filter((d) => ft(d, e, o) == null).length === 1 ? null : "oneOf";
  if (t.enum != null && o === "exact") return t.enum.some((s) => Object.is(s, e)) ? null : "enum";
  if (t.const !== undefined && o === "exact") return Object.is(t.const, e) ? null : "const";
  if (t.not != null) return ft(t.not, e, o) == null ? "not" : null;
  if (t.type == null) return null;
  const types = typeof t.type === "string" ? [t.type] : t.type;
  for (const s of types) {
    if ((s === "null" && e === null) || (s === "string" && typeof e === "string") || (s === "number" && typeof e === "number" && Number.isFinite(e)) || (s === "integer" && Number.isInteger(e)) || (s === "boolean" && typeof e === "boolean")) return null;
    if (s === "array" && Array.isArray(e)) {
      if (t.minItems != null && e.length < t.minItems) return "minItems";
      if (t.items != null && t.items !== false) for (const [l, c] of e.entries()) { const u = ft(t.items, c, o); if (u != null) return `[${l}]: ${u}`; }
      return null;
    }
    if (s === "object" && typeof e === "object" && e !== null && !Array.isArray(e)) {
      for (const d of t.required ?? []) if (!Object.hasOwn(e, d)) return `required ${d}`;
      for (const [d, l] of Object.entries(e)) {
        const c = t.properties?.[d];
        if (c != null) { const u = ft(c, l, o); if (u != null) return `${d}: ${u}`; continue; }
        if (t.additionalProperties === false) { if (o === "exact") return `additional ${d}`; continue; }
        if (t.additionalProperties != null && t.additionalProperties !== true) { const u = ft(t.additionalProperties, l, o); if (u != null) return `${d}: ${u}`; }
      }
      return null;
    }
  }
  return `type ${types.join("|")}`;
}

/** Lệnh ĐỌC: tên bắt đầu bằng get/list/is/…, không đụng tới thứ có tác dụng phụ, đối số chỉ là id bot. */
const CHI_DOC = /^(get|list|is|has|read|peek|skillsCatalog|search|find|fetch|count|describe|resolve)/;
const TRANH = /(Approval|Secret|Vault|Voice|Attachment|Chunk|Image|Text|Thread\b|Machines|export|Export)/i;
function lenhDoc() {
  const ra = [];
  for (const [m, spec] of Object.entries(S.methods)) {
    if (!CHI_DOC.test(m) || TRANH.test(m) || (S.hostOnlyMethods ?? []).includes(m)) continue;
    const a = ef(spec.args); const props = Object.keys(a?.properties ?? {}); const req = a?.required ?? [];
    if (!a || props.length === 0) ra.push([m, {}]);
    else if (req.every((k) => ["id", "agentId"].includes(k))) ra.push([m, Object.fromEntries(props.filter((k) => ["id", "agentId"].includes(k)).map((k) => [k, AGENT]))]);
  }
  return ra;
}

/**
 * Lệch CỐ Ý — schema 0.43 nói MẢNG entry, ta trả trang `{entries, …}` vì 12 bài đo trong `scripts/` đọc `.entries`,
 * và client (0.29 lẫn 0.43) không gọi hai lệnh này (coverage: chỉ có lượt của script). Đổi khi có client gọi thật.
 */
const LECH_CO_Y = { getAgentTranscript: "trang {entries} cho bài đo", getTranscript: "trang {entries} cho bài đo" };

const theoDoiSo = process.argv.slice(2).map((s) => { const i = s.indexOf(":"); return i < 0 ? [s, {}] : [s.slice(0, i), JSON.parse(s.slice(i + 1))]; });
const calls = theoDoiSo.length ? theoDoiSo : lenhDoc();
let sai = 0;
for (const [m, a] of calls) {
  // `GW_TOKEN` (vé cổng) để chạy trên máy chủ có `GROKBOT2_AUTH=enforce` — máy dev không cần. Thiếu nó ở VPS là 401, không phải reply sai.
  const headers = { "content-type": "application/json", ...(process.env.GW_TOKEN ? { authorization: `Bearer ${process.env.GW_TOKEN}` } : {}) };
  let r; try { r = await fetch(`${GW}/${m}`, { method: "POST", headers, body: JSON.stringify(a) }); }
  catch (e) { console.log(`  ĐỨT  ${m} — ${e.message}`); sai++; continue; }
  const txt = await r.text(); let val; try { val = JSON.parse(txt); } catch { val = txt; }
  const sch = S.methods[m]?.reply;
  const err = sch === undefined ? "không có reply schema trong hợp đồng 0.43" : ft(sch, val);
  const coY = err != null && LECH_CO_Y[m] != null;
  if (err != null && !coY) sai++;
  console.log(`${err == null ? "  ok  " : coY ? "  lệch cố ý" : "  SAI "} ${m}${Object.keys(a).length ? " " + JSON.stringify(a) : ""} → ${r.status}${err == null ? "" : "  ⇒ " + err}`);
}
console.log(`\n${calls.length} lệnh · ${sai} sai${sai ? "" : " — mọi reply qua được schema reply của coordinator 0.43"}`);
process.exit(sai ? 1 : 0);
