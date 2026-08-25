/**
 * Speech to text for the composer's microphone button.
 *
 * The button was dead: `TranscribeAudio` had no builder, so pressing the mic recorded audio, sent it,
 * got `200 {}` back and put nothing in the box. Twice, by the look of the call counter — which is
 * about how many times anybody tries a button that does nothing.
 *
 * The pool cannot do this: Claude takes no audio input. So the work happens locally in a Python
 * worker running faster-whisper, spawned once and kept alive — loading the model costs seconds, and
 * paying that per phrase would make dictation feel broken even when it works.
 *
 * Nothing is sent anywhere. The only network access is the one-off model download on first use.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKER = join(HERE, "..", "scripts", "stt-worker.py");
const PYTHON = process.env.GROKBOT2_STT_PYTHON
  ?? join(HERE, "..", ".venv-stt", "Scripts", "python.exe");

/** A phrase is seconds of audio; a minute means something is wrong, not slow. */
const REQUEST_TIMEOUT_MS = 60_000;
/** The model has to load before the first answer, and a cold download is not quick. */
const READY_TIMEOUT_MS = 10 * 60_000;

interface Pending {
  resolve(value: { text: string; ms: number }): void;
  reject(err: Error): void;
  timer: NodeJS.Timeout;
}

let proc: ChildProcessWithoutNullStreams | null = null;
let ready: Promise<void> | null = null;
/** One at a time: the worker answers in order, so a queue is the whole concurrency story. */
const queue: Pending[] = [];
let buffer = "";

export function isSttAvailable(): boolean {
  return existsSync(PYTHON) && existsSync(WORKER);
}

function failAll(reason: string): void {
  while (queue.length) {
    const p = queue.shift();
    if (!p) break;
    clearTimeout(p.timer);
    p.reject(new Error(reason));
  }
}

interface SttMessage { ready?: boolean; text?: string; ms?: number; error?: string }

/**
 * Cắt buffer thành từng dòng JSON trọn vẹn, trả lại phần dư.
 *
 * Tách ra vì đây là chỗ duy nhất trong file có một bất biến riêng: **một lần ghi dở không bao giờ
 * được đọc như một câu trả lời trọn**. Nằm lẫn trong `start` thì bất biến đó chìm giữa việc dựng
 * tiến trình và việc bắt lỗi.
 */
function drainLines(buf: string, onMessage: (msg: SttMessage) => void): string {
  for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg: SttMessage;
    try { msg = JSON.parse(line) as SttMessage; } catch { continue; }
    onMessage(msg);
  }
  return buf;
}

function start(): Promise<void> {
  if (ready) return ready;
  ready = new Promise<void>((resolve, reject) => {
    const child = spawn(PYTHON, [WORKER], { stdio: ["pipe", "pipe", "pipe"] });
    proc = child;

    const readyTimer = setTimeout(() => reject(new Error("the transcriber did not become ready")), READY_TIMEOUT_MS);
    let started = false;

    child.stdout.on("data", (chunk: Buffer) => {
      buffer = drainLines(buffer + chunk.toString("utf8"), (msg) => {
        if (msg.ready) {
          started = true;
          clearTimeout(readyTimer);
          resolve();
          return;
        }
        const p = queue.shift();
        if (!p) return;
        clearTimeout(p.timer);
        if (msg.error) p.reject(new Error(msg.error));
        else p.resolve({ text: msg.text ?? "", ms: msg.ms ?? 0 });
      });
    });

    // The model download prints progress here; it is the only place to see a cold first run.
    child.stderr.on("data", (c: Buffer) => {
      const line = c.toString("utf8").trim();
      if (line) console.log(`[grokbot2] ${line.split("\n").slice(-1)[0]}`);
    });

    // Chết và không sinh ra được là hai đường vào cùng một trạng thái: quên tiến trình, dừng đồng
    // hồ, và trả lời mọi thứ đang chờ. Gộp lại để không có đường nào quên một bước.
    const died = (why: string, err?: Error) => {
      proc = null; ready = null; buffer = "";
      clearTimeout(readyTimer);
      if (!started) reject(err ?? new Error(why));
      failAll(why);
    };
    child.on("exit", (code) => died(`the transcriber exited (code ${code ?? "?"})`));
    child.on("error", (e) => died(e.message, e));
  }).catch((e: Error) => {
    // A failed start must not be remembered as a permanent one: the next press tries again.
    ready = null;
    throw e;
  });
  return ready;
}

/**
 * Turn recorded audio into text. Rejects rather than returning an empty string, so the caller can
 * tell "said nothing" from "could not transcribe" — the second one deserves a log line.
 */
export async function transcribe(
  audio: Buffer, _mimeType: string, language?: string,
): Promise<{ text: string; ms: number }> {
  if (!isSttAvailable()) throw new Error(`no transcriber installed (expected ${PYTHON})`);
  await start();
  const child = proc;
  if (!child) throw new Error("the transcriber is not running");

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      // Drop it from the queue: an answer arriving later belongs to nobody and would be handed to
      // whichever request came next.
      const i = queue.findIndex((p) => p.timer === timer);
      if (i >= 0) queue.splice(i, 1);
      reject(new Error("transcription timed out"));
    }, REQUEST_TIMEOUT_MS);
    queue.push({ resolve, reject, timer });
    child.stdin.write(`${JSON.stringify({
      audio: audio.toString("base64"),
      ...(language ? { language } : {}),
    })}\n`);
  });
}

/** Shutdown, and so a script can exit. */
export function closeStt(): void {
  failAll("shutting down");
  try { proc?.kill(); } catch { /* already gone */ }
  proc = null; ready = null;
}
