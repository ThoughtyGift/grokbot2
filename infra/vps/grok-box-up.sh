#!/bin/bash
# Bring up a Grok Bot box on this host: a virtual desktop plus the noVNC viewer the app expects.
#
# Mirrors the existing per-account recipe (/opt/flow-vnc.sh): Xvfb for the display, a window
# manager so windows are drawn, then x11vnc + websockify + an nginx location. Uses its own
# display and ports so nothing already running is touched.
#
#   grok-box-up.sh [display]     default 77
set -u
DISP="${1:-77}"
ACC="grokbox"
GEOM="1920x1080x24"

echo "== Grok Bot box on :$DISP =="

# 1. Virtual display (systemd-run so it survives this ssh session)
if [ -e "/tmp/.X11-unix/X$DISP" ]; then
  echo "  Xvfb :$DISP already up"
else
  systemctl reset-failed "grok-xvfb-$DISP" 2>/dev/null
  systemd-run --unit="grok-xvfb-$DISP" --collect /usr/bin/Xvfb ":$DISP" -screen 0 "$GEOM" -ac >/dev/null 2>&1
  for _ in $(seq 1 20); do [ -e "/tmp/.X11-unix/X$DISP" ] && break; sleep 0.5; done
  [ -e "/tmp/.X11-unix/X$DISP" ] && echo "  Xvfb :$DISP started" || { echo "  Xvfb FAILED"; exit 1; }
fi

# 2. Window manager — without one, apps draw with no frames and nothing is manageable
if pgrep -f "fluxbox.*:$DISP" >/dev/null 2>&1 || DISPLAY=":$DISP" pgrep -f fluxbox >/dev/null 2>&1; then
  echo "  fluxbox already running"
else
  systemctl reset-failed "grok-wm-$DISP" 2>/dev/null
  systemd-run --unit="grok-wm-$DISP" --collect --setenv=DISPLAY=":$DISP" /usr/bin/fluxbox >/dev/null 2>&1
  sleep 1; echo "  fluxbox started"
fi

# 3. Something to look at, so the desktop isn't an empty grey screen
if ! systemctl is-active --quiet "grok-term-$DISP" 2>/dev/null; then
  systemctl reset-failed "grok-term-$DISP" 2>/dev/null
  systemd-run --unit="grok-term-$DISP" --collect --setenv=DISPLAY=":$DISP" \
    /usr/bin/xterm -geometry 100x30+40+40 -fa Monospace -fs 11 -title "Grok Bot box" >/dev/null 2>&1
  sleep 1; echo "  xterm started"
fi

# 4. Viewer: x11vnc + websockify + nginx route (proven script, additive and reversible)
/opt/flow-vnc.sh "$ACC" "$DISP" on

echo ""
echo "vnc_url for EnsureSandBox:"
echo "  https://admin.halcion.vn/flowvnc-${ACC}/vnc.html?path=flowvnc-${ACC}/websockify&autoconnect=true&password=FlowVps%232026"
