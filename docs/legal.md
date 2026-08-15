# Legal / scope

Grok Bot is a **rebranded Cursor desktop agent** (Anysphere, Inc.) — the shipped binaries are
signed by Anysphere. This project reverse-engineers the **contract** its client speaks to a
backend, so the owner can self-host the brain for **personal / research use** on their own machine.

Boundaries:

- **Do not redistribute** a modified client or this backend as a way to resell/impersonate Cursor.
- **Do not represent** this as an official Cursor/Anysphere or xAI product.
- Self-answering the access/billing RPCs (`GetSandAccessStatus`, `GetSand*TrialStatus`) bypasses
  the vendor's commercial gating. Keep this to your own use; distributing it is not appropriate.
- The Claude pool it talks to (`admin.halcion.vn`) is the owner's own infrastructure using their
  own subscription accounts.

If you only want an independent agent (not the Grok Bot UI), building a fresh agent against the
Claude/Grok pool is cleaner and carries none of these concerns.
