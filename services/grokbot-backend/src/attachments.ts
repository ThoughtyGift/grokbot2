/**
 * Attachments the agent produces (screenshots, mostly).
 *
 * Getting a picture into the transcript is a three-gate problem, and every gate was found the
 * hard way — see docs/parity.md:
 *
 *  1. **The media gate is the URL string's file extension.** The renderer only routes an
 *     attachment to the image component when `AZ(url)` finds a known extension: it splits on
 *     `/` and `\`, takes the last segment, and reads the text after the last `.`. A base64
 *     `data:` URL has no dot, so it renders as a file chip no matter what `file_name` says.
 *  2. **The desktop rejects Windows drive paths.** `normalizeAttachmentSource` runs
 *     `new URL(source)`; `C:\…` parses with protocol `c:` and is dropped. A `file://` URL is
 *     worse — it throws inside the message renderer and takes the section down.
 *  3. **A path that is not a URL is passed through**, tried against the desktop's own
 *     filesystem first, and then handed to the box gateway as
 *     `readAttachmentImage({path}) → {dataUrl, width, height}`.
 *
 * So: hand out POSIX-looking virtual paths under /workspace ending in a real extension, and
 * serve the bytes from gate 3. Nothing touches the user's disk.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

/** The virtual directory the transcript refers to. Nothing is written here; see DISK. */
const DIR = "/workspace/attachments";
/** Where the bytes actually live, beside the rest of the backend's state. */
const DISK = join(dirname(fileURLToPath(import.meta.url)), "..", ".data", "attachments");
/** Bounded so a long browsing session cannot grow without limit. */
const MAX_ENTRIES = 64;

interface Stored { bytes: Buffer; mime: string; width: number; height: number }

const store = new Map<string, Stored>();
let seq = 1;

/**
 * Screenshots must survive a backend restart. Held only in memory they came back as
 * "Image unavailable" the moment tsx reloaded, which looks exactly like a broken contract.
 */
function diskPath(virtual: string): string {
  return join(DISK, basename(virtual));
}

{
  try {
    mkdirSync(DISK, { recursive: true });
    for (const name of readdirSync(DISK)) {
      const virtual = `${DIR}/${name}`;
      try {
        const bytes = readFileSync(join(DISK, name));
        const size = pngSize(bytes);
        if (size == null) continue;
        store.set(virtual, { bytes, mime: "image/png", ...size });
        const n = Number(/^(\d+)-/.exec(name)?.[1] ?? 0);
        if (n >= seq) seq = n + 1;
      } catch { /* skip unreadable */ }
    }
    if (store.size) console.log(`[grokbot2] restored ${store.size} attachment(s)`);
  } catch { /* no state dir yet */ }
}

/** PNG carries its size in the IHDR chunk: 8-byte signature, 4 length, 4 "IHDR", w, h. */
function pngSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 24 || bytes.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/**
 * Keep an image and return the virtual path to put in `message.url`.
 * Returns null when the bytes are not a PNG we can measure — the renderer needs real
 * width/height, and guessing them produces a blank frame.
 */
export function stageImage(dataUrl: string, fileName: string): string | null {
  const comma = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || comma < 0) return null;
  const mime = dataUrl.slice(5, dataUrl.indexOf(";") >= 0 ? dataUrl.indexOf(";") : comma);
  const bytes = Buffer.from(dataUrl.slice(comma + 1), "base64");
  const size = pngSize(bytes);
  if (size == null) return null;

  const safe = fileName.replace(/[^A-Za-z0-9._-]/g, "_") || "image.png";
  const path = `${DIR}/${seq++}-${safe}`;
  store.set(path, { bytes, mime, ...size });
  try {
    mkdirSync(DISK, { recursive: true });
    writeFileSync(diskPath(path), bytes);
  } catch { /* memory-only for this run */ }

  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
    try { unlinkSync(diskPath(oldest)); } catch { /* already gone */ }
  }
  return path;
}

/**
 * Gateway `readAttachmentImage({path})`. The desktop calls this after its own filesystem
 * lookup misses, and feeds the result straight into the image component, which needs
 * `width`/`height` present or it renders "Image unavailable".
 */
export function readAttachmentImage(args: { path?: unknown }): { dataUrl: string; width: number; height: number } | null {
  const path = typeof args?.path === "string" ? args.path : "";
  const hit = store.get(path);
  if (hit == null) return null;
  return {
    dataUrl: `data:${hit.mime};base64,${hit.bytes.toString("base64")}`,
    width: hit.width,
    height: hit.height,
  };
}

/** For logging: how many images are held. */
export const stagedCount = (): number => store.size;
