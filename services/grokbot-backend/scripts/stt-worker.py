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


def main() -> None:
    from faster_whisper import WhisperModel

    log(f"loading model {MODEL} ({DEVICE}/{COMPUTE}) — first run downloads it")
    model = WhisperModel(MODEL, device=DEVICE, compute_type=COMPUTE)
    log("ready")
    print(json.dumps({"ready": True}), flush=True)

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
            language = req.get("language") or None
            segments, _info = model.transcribe(wav, language=language, vad_filter=True)
            text = "".join(s.text for s in segments).strip()
            print(json.dumps({"text": text, "ms": int((time.time() - started) * 1000)}), flush=True)
        except Exception as exc:  # noqa: BLE001 — the caller gets the message, the worker stays up
            print(json.dumps({"error": f"{type(exc).__name__}: {exc}"}), flush=True)
        finally:
            if wav and os.path.exists(wav):
                os.unlink(wav)


if __name__ == "__main__":
    main()
