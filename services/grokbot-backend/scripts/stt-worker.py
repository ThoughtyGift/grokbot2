"""
Speech-to-text worker: one JSON request per line on stdin, one JSON reply per line on stdout.

Spawned once and kept alive on purpose. Loading the model costs a couple of seconds, and paying
that per phrase would make the microphone feel broken even when it works — which is worse than the
dead button it replaces.

Nothing leaves the machine: faster-whisper runs the model locally, and the only network access is
the one-off model download on first use, into the usual Hugging Face cache.

Protocol (line-delimited JSON, so a partial write can never be mistaken for a complete request):
    in   {"audio": "<base64>", "mime": "audio/webm", "language": "vi"}
    out  {"text": "...", "ms": 1234}
    out  {"error": "..."}                on failure — the caller decides what to tell the user

stderr carries progress and is what the backend logs; stdout is data only.
"""

import base64
import json
import os
import subprocess
import sys
import tempfile
import time

MODEL = os.environ.get("GROKBOT2_STT_MODEL", "small")
DEVICE = os.environ.get("GROKBOT2_STT_DEVICE", "cpu")
# int8 on CPU is roughly 3x faster than float32 with no difference anybody dictating a sentence
# would notice. Override if a GPU shows up.
COMPUTE = os.environ.get("GROKBOT2_STT_COMPUTE", "int8")


def log(msg: str) -> None:
    print(f"[stt] {msg}", file=sys.stderr, flush=True)


def to_wav(raw: bytes) -> str:
    """
    Normalise whatever the browser recorded into 16 kHz mono PCM.

    The renderer records webm/opus; the model wants mono 16 kHz. ffmpeg is already on this machine
    and is the one part of this pipeline that never surprises anybody, so the conversion happens here
    rather than trusting the decoder bundled with the Python package.
    """
    src = tempfile.NamedTemporaryFile(suffix=".bin", delete=False)
    src.write(raw)
    src.close()
    dst = src.name + ".wav"
    proc = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", src.name,
         "-ac", "1", "-ar", "16000", "-f", "wav", dst],
        capture_output=True,
    )
    os.unlink(src.name)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {proc.stderr.decode('utf-8', 'replace')[:300]}")
    return dst


def pick_language(raw: str | None) -> str | None:
    """
    Which language to decode as, or None to let the model work it out.

    The client is not a useful source here. `electron-main` sends `en-US` whenever nobody picked a
    language, and faster-whisper rejects locales outright — `'en-US' is not a valid language code` —
    so the very first real recording failed while a hand-written test passing `en` had passed. Worse,
    honouring it would force English onto a Vietnamese sentence, which fails quietly instead of
    loudly.

    So the hint is treated as advisory: a real language code is used, a locale is reduced to one, and
    the client's `en-US` default means "nobody said" and becomes auto-detect. `GROKBOT2_STT_LANGUAGE`
    pins it for anyone who wants no guessing (`auto` to force detection).
    """
    forced = os.environ.get("GROKBOT2_STT_LANGUAGE")
    if forced:
        return None if forced.lower() == "auto" else forced.lower()
    if not raw:
        return None
    if raw.strip().lower() == "en-us":
        return None
    base = raw.strip().lower().split("-")[0]
    return base or None


def main() -> None:
    from faster_whisper import WhisperModel

    log(f"loading model {MODEL} ({DEVICE}/{COMPUTE}) — first run downloads it")
    model = WhisperModel(MODEL, device=DEVICE, compute_type=COMPUTE)
    log("ready")
    print(json.dumps({"ready": True}), flush=True)

    # The language the last confident detection settled on, for as long as this worker lives.
    remembered: str | None = None

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        started = time.time()
        wav = None
        try:
            req = json.loads(line)
            audio = base64.b64decode(req.get("audio") or "")
            if not audio:
                raise ValueError("request carried no audio")
            wav = to_wav(audio)
            language = pick_language(req.get("language")) or remembered
            try:
                segments, info = model.transcribe(wav, language=language, vad_filter=True)
            except ValueError as bad_lang:
                # Belt and braces: a code that looked plausible and is not on the model's list must
                # cost a detection pass, not the recording.
                log(f"{bad_lang} — falling back to auto-detect")
                segments, info = model.transcribe(wav, language=None, vad_filter=True)
            text = "".join(s.text for s in segments).strip()

            # Detection is the single most expensive part of a short clip — measured at 3.4s of an
            # 8s transcription on `small`, four times the cost of the decode on `base`. The same
            # person dictating twice in a row is not speaking a new language, so a CONFIDENT
            # detection is remembered and the next clip skips the pass entirely.
            if language is None and info.language_probability >= 0.8:
                remembered = info.language
                log(f"remembering language {remembered} ({info.language_probability:.2f}) — next clip skips detection")
            elif not text and remembered is not None:
                # Nothing came back with the remembered language. It may be the wrong one now, so
                # forget it rather than keep returning silence.
                log(f"empty transcript with language {remembered} — forgetting it")
                remembered = None

            log(f"{len(text)} chars in {int((time.time() - started) * 1000)}ms (lang {info.language})")
            print(json.dumps({"text": text, "ms": int((time.time() - started) * 1000)}), flush=True)
        except Exception as exc:  # noqa: BLE001 — the caller gets the message, the worker stays up
            print(json.dumps({"error": f"{type(exc).__name__}: {exc}"}), flush=True)
        finally:
            if wav and os.path.exists(wav):
                os.unlink(wav)


if __name__ == "__main__":
    main()
