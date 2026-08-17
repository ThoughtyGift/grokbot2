/**
 * Strip secrets out of anything on its way to a log line.
 *
 * This exists because of a measured leak, not a hypothetical one: `reportBoxConfig` logged
 * `GROKBOT2_VNC_URL` verbatim at every startup, and that URL carries `password=…` in its query
 * string. The box's VNC password sat in the dev log five times over.
 *
 * A log file is the least-guarded artifact a project has — it gets pasted into chat, attached to
 * a bug report, mailed to whoever is helping. So redaction belongs at the log boundary, applied
 * to every string that might carry a URL, rather than being remembered case by case at each
 * call site.
 *
 * Deliberately conservative: it over-matches rather than under-matches. A log line reading
 * `password=***` is never a problem; one reading the real password is.
 */

/**
 * Each pattern keeps the identifying prefix and replaces only the value, so a redacted line
 * still says WHICH secret was present — that is what makes the log useful for debugging while
 * being safe to share.
 */
const PATTERNS: readonly [RegExp, string][] = [
  // Query/form parameters. `password`, `passwd`, `pwd`, `token`, `access_token`, `auth`, `key`,
  // `secret`, `credential` — stop at & or whitespace so the rest of the URL survives.
  [/([?&](?:password|passwd|pwd|pass|token|access_token|refresh_token|id_token|auth|authToken|apikey|api_key|key|secret|credential)=)[^&\s"']+/gi, "$1***"],
  // The pool's own key shape: `hal_` + 48 hex (admin-dashboard mints `hal_` + randomBytes(24)).
  // Matched on its own because it travels in headers and files, not only in query strings.
  [/\bhal_[A-Za-z0-9]{8,}/g, "hal_***"],
  // Bearer/Basic credentials in a header dump.
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 ***"],
  // JSON/YAML fields carrying the same names as above.
  [/(["']?(?:password|passwd|token|access_token|apiKey|api_key|secret|credential|authToken)["']?\s*[:=]\s*["'])[^"']+(["'])/gi, "$1***$2"],
  // `user:pass@host` in a URL.
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:)[^@\s/]+(@)/gi, "$1***$2"],
];

/**
 * Redact secrets in `text`. Safe on any string; returns non-strings untouched via String().
 *
 * Idempotent: running it twice changes nothing, so it is safe to apply at several layers
 * without producing `***​***`.
 */
export function redact(text: unknown): string {
  const s = typeof text === "string" ? text : String(text);
  return PATTERNS.reduce((acc, [re, to]) => acc.replace(re, to), s);
}

/**
 * A `console.log`-shaped wrapper that redacts every argument.
 *
 * Use this instead of `console.log` anywhere a URL, header, config value or error message can
 * reach the line — which in a server that talks to a pool, a box and a browser is nearly
 * everywhere.
 */
export const logSafe = (...parts: unknown[]): void => {
  console.log(parts.map(redact).join(" "));
};

export const warnSafe = (...parts: unknown[]): void => {
  console.warn(parts.map(redact).join(" "));
};
