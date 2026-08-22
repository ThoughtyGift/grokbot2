/**
 * Patch: `uploadAttachmentsIntoBox` swallows every failure, so a dropped attachment is invisible.
 *
 * The stock send path in `dist/host/host-main.cjs` reads:
 *
 *     let Q = new Map;
 *     if (O.length>0 && t.uploadAttachmentsIntoBox!=null && t.getRemoteBoxAvailable())
 *       try { Q = await t.uploadAttachmentsIntoBox(O) } catch {}
 *     let q = zKn(O, Q, b.attachedFileSizes);
 *
 * `O` is `b.attachedFilePaths` — the general-file route, distinct from `b.selectedImages`, which
 * travels inline in the proto as `Yd`/`qo` and never comes through here. On failure `Q` stays an
 * empty Map and `zKn` still builds the prompt text block, so the turn is sent as if the upload had
 * worked: no throw, no log, no UI signal. The attachment is simply not in the box.
 *
 * That is the failure mode this repo has been burned by repeatedly — the symptom (file "attached"
 * but the agent cannot see it) points at the backend, while the evidence that would settle it was
 * discarded one frame earlier, inside the client.
 *
 * This patch does NOT change behaviour: `Q` still stays an empty Map, the turn is still sent, and
 * the success path is byte-for-byte the same work as before. It only writes what was thrown.
 *
 * Sink is a file, not `console.error`. The host is an Electron `utilityProcess.fork`, and
 * `infra/scripts/run.ps1` launches the exe with `Start-Process -PassThru` — no `-NoNewWindow`, no
 * `-RedirectStandardError` — so nothing reads the child's stderr. The app's own structured logger is
 * no use either: it ships to vendor telemetry we deliberately do not serve, and this install's spill
 * buffer shows `ship_failed: 3267`, `overflow_evicted: 38233`, `records: []`. A `console.error` here
 * would be a second silent failure wearing the costume of a fix.
 *
 *     tail -f ~/.grokbot2-client.log
 *
 * The inner `try{…}catch{}` is deliberate and is the one empty catch worth keeping: logging must
 * never be able to break sending a message.
 */
export default {
  id: "attach-upload-observable",
  file: "dist/host/host-main.cjs",
  summary: "uploadAttachmentsIntoBox: log the swallowed error instead of discarding it",

  /**
   * Verbatim from vendor `app.asar` v0.20.0, and unique: 1 occurrence in a file that contains 342
   * empty `catch{}` blocks. That count is why the anchor is the whole statement — the `catch{}`
   * alone would match 342 places, and `expected` would be the only thing standing between this
   * patch and 341 wrong edits.
   */
  find: 'if(O.length>0&&t.uploadAttachmentsIntoBox!=null&&t.getRemoteBoxAvailable())try{Q=await t.uploadAttachmentsIntoBox(O)}catch{}',
  expected: 1,

  /**
   * Nothing in the catch touches app state — `O.length` is a local array, and
   * `t.getRemoteBoxAvailable()` is deliberately NOT called a second time. `gb2Err` is scoped to the
   * catch block, so it cannot shadow a minified binding used elsewhere.
   */
  replace:
    'if(O.length>0&&t.uploadAttachmentsIntoBox!=null&&t.getRemoteBoxAvailable())'
    + 'try{Q=await t.uploadAttachmentsIntoBox(O)}catch(gb2Err){'
    + 'try{require("node:fs").appendFileSync('
    + 'require("node:path").join(require("node:os").homedir(),".grokbot2-client.log"),'
    + 'new Date().toISOString()+" [attach-upload] uploadAttachmentsIntoBox threw for "'
    + '+O.length+" file(s): "+((gb2Err&&gb2Err.stack)||gb2Err)+"\\n")}catch{}}'
    + '/*grokbot2:attach-upload-observable*/',

  marker: "/*grokbot2:attach-upload-observable*/",
};
