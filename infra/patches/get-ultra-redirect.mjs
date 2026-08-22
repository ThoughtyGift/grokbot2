/**
 * Patch: point the paywall's "Get Ultra" button at YOUR checkout instead of cursor.com.
 *
 * When grokbot2's backend returns GetSandAccessStatus = PAYMENT_REQUIRED / PAYWALL_INDIVIDUAL
 * (billing enforce, user over quota — see services/grokbot-backend/src/billing.ts accessVerdict),
 * the stock app renders its own paywall: title "Grok Bot needs an Ultra plan", body "Upgrade to
 * Ultra to send messages", and an accent pill button "Get Ultra". That button is component `J9n`
 * in the renderer; its handler is `onClick:()=>{s(n1t)}` where `s = openExternal({url})` and
 * `n1t` is a single module constant:
 *
 *     const n1t="https://cursor.com/bot/onboarding"
 *
 * So the whole buy surface is one URL. Redirecting it to your checkout closes the payment loop
 * WITHOUT any ErrorButton (which grokbot2 cannot emit — that lives in the vendor's proto chat-stream
 * error envelope this backend does not speak). Verified live 2026-08-22 via CDP: PAYMENT_REQUIRED →
 * this exact paywall + "Get Ultra" button appears.
 *
 * The destination is read from GROKBOT2_CHECKOUT_URL at --apply time (the same variable billing.ts
 * seeds onto the `pro` plan's checkout_url), so the patched bundle carries whatever you set. With it
 * unset the placeholder below is baked in — obviously not a real endpoint, so a missing config fails
 * visibly rather than silently shipping cursor.com.
 *
 * FRAGILITY — read before trusting across updates: unlike win-drive-path (which patches the
 * stably-named `dist/electron-main/main.cjs`), this targets the RENDERER bundle whose filename is
 * content-hashed (`index-DNC736IO.js`). A vendor rebuild changes that hash, so `file` below will no
 * longer exist and the pipeline will fail red with this patch's id — by design, but it means this
 * `file` must be re-pointed at the new hashed name after every client update. The `find` string
 * itself (the onboarding URL) is likely stable; the filename is not.
 */
const CHECKOUT = process.env.GROKBOT2_CHECKOUT_URL ?? "https://checkout.example.com/upgrade";

export default {
  id: "get-ultra-redirect",
  file: "dist/renderer/assets/index-DNC736IO.js",
  summary: 'Get Ultra button opens GROKBOT2_CHECKOUT_URL instead of cursor.com/bot/onboarding',

  /** Verbatim from vendor renderer v0.20.0; expected:1 is the safety — 1 occurrence in the bundle. */
  find: 'const n1t="https://cursor.com/bot/onboarding"',
  expected: 1,

  /** Inline marker comment before the string — parses fine mid-expression, cheap to grep for --verify. */
  replace: `const n1t=/*grokbot2:get-ultra-redirect*/${JSON.stringify(CHECKOUT)}`,
  marker: "/*grokbot2:get-ultra-redirect*/",
};
