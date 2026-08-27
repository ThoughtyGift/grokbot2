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
  summary: 'nút Get Ultra mở GROKBOT2_CHECKOUT_URL thay vì cursor.com/bot/onboarding',

  /**
   * URL bền, TÊN BIẾN thì không — và ở 0.29 nó còn đổi cả file.
   *
   * 0.20: chuỗi nằm trong renderer, `const n1t="…"`, và tên file renderer mang băm nội dung nên
   * đổi sau mỗi lần hãng dựng lại. 0.29: chuỗi có ở **cả** `main.cjs` (`jpr="…"`) lẫn renderer
   * (`const lU="…"`), và cái quyết định điều hướng nằm ở main.
   *
   * Nên biến thể 0.29 vá `main.cjs` — tên file ổn định, không mang băm. Bớt được đúng cái mảnh
   * giòn nhất của bản vá này.
   */
  variants: [
    {
      version: "0.20.0",
      file: "dist/renderer/assets/index-DNC736IO.js",
      find: 'const n1t="https://cursor.com/bot/onboarding"',
      expected: 1,
      replace: `const n1t=/*grokbot2:get-ultra-redirect*/${JSON.stringify(CHECKOUT)}`,
      marker: "/*grokbot2:get-ultra-redirect*/",
    },
    {
      version: "0.29.0",
      file: "dist/electron-main/main.cjs",
      find: 'jpr="https://cursor.com/bot/onboarding"',
      expected: 1,
      replace: `jpr=/*grokbot2:get-ultra-redirect*/${JSON.stringify(CHECKOUT)}`,
      marker: "/*grokbot2:get-ultra-redirect*/",
    },
  ],
};
