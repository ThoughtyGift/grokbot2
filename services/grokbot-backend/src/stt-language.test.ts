/**
 * Which language the transcriber decodes as.
 *
 * This is the bug that shipped: the mic was wired end to end, my own test passed `en`, and the very
 * first real recording failed — because `electron-main` sends the locale `en-US` whenever nobody
 * picked a language, and faster-whisper answers `'en-US' is not a valid language code`. The empty
 * text came back, the composer stayed empty, and it looked like nothing had been built at all.
 *
 * The rule lives in the worker because that is the process that knows what the model accepts, so the
 * test reaches into it rather than restating it here and letting the two drift. It skips when the
 * engine is not installed — the whole feature is optional.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const PYTHON = process.env.GROKBOT2_STT_PYTHON ?? join(ROOT, ".venv-stt", "Scripts", "python.exe");
const WORKER = join(ROOT, "scripts", "stt-worker.py");

/** Ask the worker's own `pick_language`, with the environment we want to test under. */
function pick(raw: string | null, forced?: string): string | null {
  const code = [
    "import importlib.util, json, sys",
    `spec = importlib.util.spec_from_file_location("w", ${JSON.stringify(WORKER)})`,
    "mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)",
    `print(json.dumps(mod.pick_language(${raw === null ? "None" : JSON.stringify(raw)})))`,
  ].join("\n");
  const env = { ...process.env };
  if (forced === undefined) delete env.GROKBOT2_STT_LANGUAGE;
  else env.GROKBOT2_STT_LANGUAGE = forced;
  return JSON.parse(execFileSync(PYTHON, ["-c", code], { encoding: "utf8", env }).trim()) as string | null;
}

const ready = existsSync(PYTHON) && existsSync(WORKER);

test("the client's en-US default means nobody chose, so the model decides", (t) => {
  if (!ready) return t.skip("no transcriber installed");
  assert.equal(pick("en-US"), null, "forcing English here would garble a Vietnamese sentence");
  assert.equal(pick("EN-us"), null, "case is not a different answer");
});

test("a locale is reduced to the code the model accepts", (t) => {
  if (!ready) return t.skip("no transcriber installed");
  assert.equal(pick("vi-VN"), "vi");
  assert.equal(pick("pt-BR"), "pt");
});

test("a plain language code is used as given", (t) => {
  if (!ready) return t.skip("no transcriber installed");
  assert.equal(pick("vi"), "vi");
  assert.equal(pick("ja"), "ja");
});

test("nothing at all means auto-detect, not a guess", (t) => {
  if (!ready) return t.skip("no transcriber installed");
  assert.equal(pick(null), null);
  assert.equal(pick(""), null);
  assert.equal(pick("   "), null);
});

test("the env override wins over whatever the client sent", (t) => {
  if (!ready) return t.skip("no transcriber installed");
  assert.equal(pick("en-US", "vi"), "vi", "pinning a language is how you skip detection entirely");
  assert.equal(pick("vi", "auto"), null, "and `auto` forces detection back on");
});
