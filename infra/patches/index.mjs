/**
 * The patch set applied to the locally installed Grok Bot client.
 *
 * Order is apply order. Each entry is data, not a script: `{id, file, find, replace, expected,
 * marker}` — see `win-drive-path.mjs` for the shape and why `expected` matters.
 *
 * Adding one: write the module, import it here, then `node infra/scripts/patch-client.mjs --apply`.
 * Never hand-edit `resources/app/` — a hand edit is invisible to `--verify`, is lost the first time
 * the app updates, and cannot be rebuilt on another machine. That is the failure this directory
 * exists to prevent: the drive-path fix lived only as a hand edit for two days.
 */
import winDrivePath from "./win-drive-path.mjs";
import attachUploadObservable from "./attach-upload-observable.mjs";
import getUltraRedirect from "./get-ultra-redirect.mjs";

export const PATCHES = [winDrivePath, attachUploadObservable, getUltraRedirect];
