/**
 * Box probe — a logging pass-through in front of the real Cursor backend.
 *
 * Launch the ORIGINAL app with CURSOR_API_BASE_URL pointed here; every call is forwarded to
 * api2.cursor.sh unchanged and the box descriptor (EnsureSandBox) is decoded, so the real
 * vnc_url / gateway_url / exec_daemon_url format is visible. That is what a self-hosted box
 * has to imitate.
 *
 * Credentials are never logged: Authorization and token-bearing fields are redacted.
 *
 *   node scripts/box-probe.mjs [--port 8899] [--upstream https://api2.cursor.sh]
 */
import { createServer } from "node:http";
import { request as httpsRequest } from "node:https";
import { writeFileSync, mkdirSync } from "node:fs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const PORT = Number(arg("--port", "8899"));
const UPSTREAM = new URL(arg("--upstream", "https://api2.cursor.sh"));

/** Minimal protobuf reader: field number -> string, for the flat EnsureSandBox response. */
function decodeStrings(buf) {
  const out = {};
  let i = 0;
  while (i < buf.length) {
    let key = 0, shift = 0;
    while (i < buf.length) { const b = buf[i++]; key |= (b & 0x7f) << shift; shift += 7; if (!(b & 0x80)) break; }
    const field = key >> 3, wire = key & 7;
    if (wire === 2) {
      let len = 0; shift = 0;
      while (i < buf.length) { const b = buf[i++]; len |= (b & 0x7f) << shift; shift += 7; if (!(b & 0x80)) break; }
      const val = buf.subarray(i, i + len); i += len;
      const s = val.toString("utf8");
      out[field] = /^[\x20-\x7e]*$/.test(s) ? s : `<${len} bytes>`;
    } else if (wire === 0) {
      let v = 0; shift = 0;
      while (i < buf.length) { const b = buf[i++]; v |= (b & 0x7f) << shift; shift += 7; if (!(b & 0x80)) break; }
      out[field] = v;
    } else if (wire === 5) { out[field] = buf.readUInt32LE(i); i += 4; }
    else if (wire === 1) { out[field] = "<8 bytes>"; i += 8; }
    else break;
  }
  return out;
}

// EnsureSandBoxResponse field numbers (from the client's descriptors).
const BOX_FIELDS = {
  1: "cluster", 2: "tenant_id", 3: "pod_id", 4: "network_token", 5: "exec_daemon_auth_token",
  6: "exec_daemon_url", 7: "vnc_url", 8: "terminals_folder", 10: "gateway_url", 11: "gateway_token", 12: "fork_vnc_base_url",
};
const SECRET = /token|secret|key/i;
const findings = [];

const server = createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    const headers = { ...req.headers, host: UPSTREAM.host };
    const up = httpsRequest(
      { hostname: UPSTREAM.hostname, port: 443, path: req.url, method: req.method, headers },
      (ur) => {
        const rc = [];
        ur.on("data", (c) => rc.push(c));
        ur.on("end", () => {
          const rbody = Buffer.concat(rc);
          const path = req.url ?? "";
          if (/EnsureSandBox/.test(path) && rbody.length) {
            const raw = decodeStrings(rbody);
            const box = {};
            for (const [num, name] of Object.entries(BOX_FIELDS)) {
              const v = raw[num];
              if (v === undefined) continue;
              box[name] = SECRET.test(name) && typeof v === "string" ? `«redacted ${v.length} chars»` : v;
            }
            console.log(`\n=== BOX DESCRIPTOR (${path}) ===`);
            for (const [k, v] of Object.entries(box)) console.log(`  ${k.padEnd(24)} ${v}`);
            findings.push({ at: new Date().toISOString(), path, box });
            mkdirSync(".data", { recursive: true });
            writeFileSync(".data/box-descriptor.json", JSON.stringify(findings, null, 1));
          } else if (/GrokBotService|SandAccess|Usage/.test(path)) {
            console.log(`  ${req.method} ${path} → ${ur.statusCode} (${rbody.length}B)`);
          }
          res.writeHead(ur.statusCode ?? 200, ur.headers);
          res.end(rbody);
        });
      },
    );
    up.on("error", (e) => { console.log(`  upstream error ${req.url}: ${e.message}`); res.writeHead(502).end(); });
    if (body.length) up.write(body);
    up.end();
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`box probe → ${UPSTREAM.origin}`);
  console.log(`launch the ORIGINAL app with CURSOR_API_BASE_URL=http://localhost:${PORT}`);
  console.log("then click \"Open computer\" and watch for the BOX DESCRIPTOR below.\n");
});
