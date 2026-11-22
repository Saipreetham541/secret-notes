#!/usr/bin/env bash
# Host Notes from this laptop and share it through Tailscale Funnel.
#   npm run host        (Ctrl+C stops the server and takes the link offline)
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${PORT:-8787}"

if ! command -v tailscale >/dev/null 2>&1; then
  echo "Tailscale isn't installed. See 'Hosting from your laptop' in README.md."
  exit 1
fi
if ! tailscale status >/dev/null 2>&1; then
  echo "Tailscale isn't connected. Run:  sudo tailscale up"
  exit 1
fi

echo "Building the app..."
npm run build --silent >/dev/null

DNS_NAME="$(tailscale status --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).Self.DNSName.replace(/\.$/,"")))')"

# Keep the laptop from going to sleep while hosting (closing the lid may still suspend it).
INHIBIT=()
if command -v systemd-inhibit >/dev/null 2>&1; then
  INHIBIT=(systemd-inhibit --what=sleep:idle --who=Notes --why="Hosting Notes" --mode=block)
fi

HOST=127.0.0.1 TRUST_PROXY=1 PORT="$PORT" NODE_ENV=production "${INHIBIT[@]}" node server/index.js &
SERVER_PID=$!
cleanup() {
  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Wait for the server to come up.
for _ in $(seq 1 50); do
  curl -fs -o /dev/null "http://127.0.0.1:$PORT/" && break
  kill -0 "$SERVER_PID" 2>/dev/null || { echo "The server failed to start."; exit 1; }
  sleep 0.2
done

echo
echo "  Notes is online at:  https://$DNS_NAME"
echo "  Share that link. Press Ctrl+C to stop and take it offline."
echo

# Runs in the foreground; stopping it (Ctrl+C) also turns the public link off.
if ! tailscale funnel "$PORT"; then
  echo
  echo "Funnel couldn't start. Common fixes:"
  echo "  - allow your user to manage Tailscale:  sudo tailscale set --operator=\$USER"
  echo "  - turn on Funnel and HTTPS for your tailnet when the command prints a link to do so"
  exit 1
fi
