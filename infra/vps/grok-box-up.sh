#!/bin/bash
# Bring up a Grok Bot box on this host: a virtual desktop plus the noVNC viewer the app expects.
#
# Mirrors the existing per-account recipe (/opt/flow-vnc.sh): Xvfb for the display, a window
# manager so windows are drawn, then x11vnc + websockify + an nginx location. Uses its own
# display and ports so nothing already running is touched.
#
# The component list is not invented — it is what the real box reports to telemetry
# (`SAND_PROCESS_CRASH_BINARIES` / `DESKTOP_COMPONENT_NAME_PATTERN` in the box host bundle):
#
#   xvfb · xfwm4 · picom · x11vnc · websockify · dock(plank)
#   apps: google-chrome · thunar · xfce4-terminal
#
#   grok-box-up.sh [display]     default 77
#
# Env:
#   SKIP_INSTALL=1   don't apt-get anything, just start what is present
#   CHROME_CDP_PORT  Chrome remote-debugging port, bound to 127.0.0.1 (default 9223)
#   VNC_PASSWORD     url-encoded, only used to print a ready-to-paste URL
set -u
DISP="${1:-77}"
ACC="grokbox"
GEOM="1920x1080x24"
CDP_PORT="${CHROME_CDP_PORT:-9223}"
PROFILE="/var/lib/grok-box/chrome-$DISP"

echo "== Grok Bot box on :$DISP =="

# ── 0. Packages ───────────────────────────────────────────────────────────────
# Everything below is a stock Debian/Ubuntu package except Chrome, which needs Google's repo.
have() { command -v "$1" >/dev/null 2>&1; }

if [ "${SKIP_INSTALL:-0}" != "1" ]; then
  NEED=""
  have Xvfb          || NEED="$NEED xvfb"
  have xfwm4         || NEED="$NEED xfwm4"
  have plank         || NEED="$NEED plank"
  have thunar        || NEED="$NEED thunar"
  have xfce4-terminal|| NEED="$NEED xfce4-terminal"
  # picom is only packaged from Ubuntu 21.04; focal ships its predecessor as compton, and
  # neither is required — xfwm4 can composite on its own (see the compositor step below).
  if ! have picom && ! have compton; then NEED="$NEED picom compton"; fi

  if [ -n "$NEED" ]; then
    echo "  installing:$NEED"
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq || echo "  apt update warned (continuing)"
    # One package at a time: a name missing on this release must not abort the rest, which is
    # what a single `apt-get install a b c` does — picom on focal took the whole desktop with it.
    for p in $NEED; do
      if apt-get install -y -qq "$p" >/dev/null 2>&1; then echo "    + $p"; else echo "    - $p (not available here)"; fi
    done
  else
    echo "  desktop packages present"
  fi

  if ! have google-chrome && ! have google-chrome-stable; then
    echo "  installing google-chrome"
    install -d -m 0755 /etc/apt/keyrings
    curl -fsSL https://dl.google.com/linux/linux_signing_key.pub \
      | gpg --dearmor -o /etc/apt/keyrings/google-chrome.gpg 2>/dev/null
    echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" \
      > /etc/apt/sources.list.d/google-chrome.list
    apt-get update -qq && apt-get install -y -qq google-chrome-stable || echo "  chrome install FAILED (desktop still usable)"
  else
    echo "  google-chrome present"
  fi
fi

CHROME="$(command -v google-chrome || command -v google-chrome-stable || true)"

# ── 1. Virtual display (systemd-run so it survives this ssh session) ──────────
if [ -e "/tmp/.X11-unix/X$DISP" ]; then
  echo "  Xvfb :$DISP already up"
else
  systemctl reset-failed "grok-xvfb-$DISP" 2>/dev/null
  systemd-run --unit="grok-xvfb-$DISP" --collect /usr/bin/Xvfb ":$DISP" -screen 0 "$GEOM" -ac >/dev/null 2>&1
  for _ in $(seq 1 20); do [ -e "/tmp/.X11-unix/X$DISP" ] && break; sleep 0.5; done
  [ -e "/tmp/.X11-unix/X$DISP" ] && echo "  Xvfb :$DISP started" || { echo "  Xvfb FAILED"; exit 1; }
fi

# Start a unit only if it isn't already active — every step below is re-runnable.
unit_up() {
  local name="$1"; shift
  if systemctl is-active --quiet "$name" 2>/dev/null; then
    echo "  $name already running"; return 0
  fi
  systemctl reset-failed "$name" 2>/dev/null
  systemd-run --unit="$name" --collect --setenv=DISPLAY=":$DISP" "$@" >/dev/null 2>&1 \
    && echo "  $name started" || echo "  $name FAILED"
}

# ── 2. Window manager + compositor ───────────────────────────────────────────
# xfwm4 draws the frames. Compositing makes the desktop look layered rather than flat; use a
# standalone compositor when the release has one, otherwise let xfwm4 do it itself.
COMPOSITOR="$(command -v picom || command -v compton || true)"
if [ -n "$COMPOSITOR" ]; then
  unit_up "grok-wm-$DISP" /usr/bin/xfwm4 --compositor=off
  sleep 1
  unit_up "grok-picom-$DISP" "$COMPOSITOR" --backend xrender
else
  echo "  no picom/compton — using xfwm4's own compositor"
  unit_up "grok-wm-$DISP" /usr/bin/xfwm4 --compositor=on
  sleep 1
fi

# ── 3. Dock ──────────────────────────────────────────────────────────────────
# plank is the dock in the original box (the strip of icons along the bottom).
unit_up "grok-dock-$DISP" /usr/bin/plank

# ── 4. Apps ──────────────────────────────────────────────────────────────────
unit_up "grok-term-$DISP" /usr/bin/xfce4-terminal --geometry=100x30+40+40 --title="Grok Bot box"
unit_up "grok-files-$DISP" /usr/bin/thunar

# Chrome. --no-sandbox is required running as root on a bare VPS.
#
# SECURITY: the DevTools port is bound to 127.0.0.1 on purpose. An open CDP port is remote code
# execution with no authentication — never publish it through nginx. Reach it with an SSH
# tunnel:  ssh -N -L 9223:127.0.0.1:$CDP_PORT <host>
if [ -n "$CHROME" ]; then
  install -d -m 0700 "$PROFILE"
  unit_up "grok-chrome-$DISP" "$CHROME" \
    --no-sandbox --no-first-run --no-default-browser-check \
    --disable-features=Translate \
    --user-data-dir="$PROFILE" \
    --remote-debugging-address=127.0.0.1 --remote-debugging-port="$CDP_PORT" \
    --window-position=120,60 --window-size=1400,900 \
    "https://www.google.com"
else
  echo "  chrome not installed — skipping"
fi

# ── 5. Viewer: x11vnc + websockify + nginx route (proven, additive, reversible) ──
/opt/flow-vnc.sh "$ACC" "$DISP" on

# The viewer password belongs to the host's flow-vnc setup, not in this file — pass it in as
# VNC_PASSWORD (url-encoded) to get a ready-to-paste URL, otherwise a placeholder is printed.
PW="${VNC_PASSWORD:-<your-url-encoded-vnc-password>}"
HOST="${BOX_HOST:-admin.halcion.vn}"

echo ""
echo "GROKBOT2_VNC_URL for the backend's .env:"
echo "  https://${HOST}/flowvnc-${ACC}/vnc.html?path=flowvnc-${ACC}/websockify&autoconnect=true&password=${PW}"
echo ""
echo "Chrome DevTools (localhost-only on the box). To let the backend drive it:"
echo "  ssh -N -L 9223:127.0.0.1:${CDP_PORT} root@${HOST}    # then GROKBOT2_BROWSER_CDP=http://127.0.0.1:9223"
