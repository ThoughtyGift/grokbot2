/**
 * Patch: the composer thumbnail shows "Image unavailable" for every local attachment on Windows.
 *
 * Not our backend. `cOt` is the stock main-process path normaliser, and in the app's own engine
 * (Electron 42.1.0 / Node 24.15.0) `new URL("C:\\Users\\…")` yields protocol `c:`, not `file:` —
 * so the guard returns null and `resolveMedia` bails in ~0 ms, before any disk read and before the
 * box leg. POSIX paths (`/workspace/…`) make `new URL` THROW, land in `catch{return t}`, and work
 * fine — which is exactly why transcript images always rendered and only local attachments broke.
 *
 * The fix keeps the original's intent (hand non-file URLs back as-is, normalise real paths through
 * `swr`) and adds the one case its author did not have: a Windows drive letter is a path, not a URL.
 *
 * A/B measured in the live app 2026-08-18, same input, only `cOt` differing:
 *   stock   → `cOt -> null`, NULL
 *   patched → `kind:"image" 1920x1040`, dataUrl 89,814 chars, 26 ms local read, box leg untouched
 */
export default {
  id: "win-drive-path",
  file: "dist/electron-main/main.cjs",
  summary: "cOt: treat a Windows drive letter as a path, not a URL (composer thumbnails)",

  /**
   * Verbatim from vendor `app.asar` v0.20.0. `expected: 1` is the whole safety story: if a future
   * bundle renames or reshapes `cOt`, this string stops matching and the pipeline goes red with
   * this patch's id — rather than patching whatever happens to look similar.
   */
  find: 'function cOt(t){if(typeof t!="string"||t.length===0)return null;try{return new URL(t).protocol!=="file:"?null:swr(t)}catch{return t}}',
  expected: 1,

  /** The trailing comment is the verify marker — cheap to grep, harmless at runtime. */
  replace: 'function cOt(t){if(typeof t!="string"||!t)return null;try{new URL(t)}catch{return t}return t[1]==":"?t:swr(t)}/*grokbot2:win-drive-path-fix*/',
  marker: "/*grokbot2:win-drive-path-fix*/",
};
