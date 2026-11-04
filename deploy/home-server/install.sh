#!/usr/bin/env bash
# Run the Motion Studio API on this machine as systemd user services, published by a Cloudflare Tunnel.
#   deploy/home-server/install.sh server          API service only (http://127.0.0.1:4320)
#   deploy/home-server/install.sh tunnel <host>   create the tunnel + DNS route for <host>, install its service
# The tunnel step needs the domain on Cloudflare and a one-time `cloudflared tunnel login`. See docs/DEPLOY.md.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
UNITS="$HOME/.config/systemd/user"
mkdir -p "$UNITS" "$HOME/.config/motion-studio" "$HOME/.local/share/motion-studio/data" "$HOME/.local/share/motion-studio/projects"

case "${1:-}" in
  server)
    ENV="$HOME/.config/motion-studio/server.env"
    if [ ! -f "$ENV" ]; then
      HOME_ESC="$(printf '%s' "$HOME" | sed 's/[&|]/\\&/g')"
      sed "s|\${HOME}|$HOME_ESC|g" "$REPO/deploy/home-server/server.env.example" > "$ENV"
      chmod 600 "$ENV"
      echo "wrote $ENV"
    fi
    # OAuth consent / sign-in pages for Claude connectors are served by the API itself.
    (cd "$REPO" && npm run build:web)
    sed "s|@REPO@|$REPO|g" "$REPO/deploy/home-server/motion-studio.service" > "$UNITS/motion-studio.service"
    systemctl --user daemon-reload
    systemctl --user enable --now motion-studio
    loginctl enable-linger "$USER" 2>/dev/null || echo "note: run 'sudo loginctl enable-linger $USER' so it starts at boot without a login"
    PORT="$(grep -E '^MOTION_STUDIO_PORT=' "$ENV" | cut -d= -f2)"
    for _ in $(seq 30); do curl -fs "http://127.0.0.1:${PORT:-4320}/api/health" && echo && exit 0; sleep 1; done
    echo "server did not answer; see: journalctl --user -u motion-studio -n 50" >&2; exit 1
    ;;
  tunnel)
    HOST="${2:?usage: install.sh tunnel <api hostname>}"
    CF="$(command -v cloudflared)"
    [ -f "$HOME/.cloudflared/cert.pem" ] || { echo "run 'cloudflared tunnel login' first (pick the domain's zone)" >&2; exit 1; }
    cloudflared tunnel info motion-studio >/dev/null 2>&1 || cloudflared tunnel create motion-studio
    ID="$(cloudflared tunnel list --name motion-studio --output json | python3 -c 'import json,sys; print(json.load(sys.stdin)[0]["id"])')"
    PORT="$(grep -E '^MOTION_STUDIO_PORT=' "$HOME/.config/motion-studio/server.env" | cut -d= -f2)"
    cat > "$HOME/.cloudflared/motion-studio.yml" <<YML
tunnel: $ID
credentials-file: $HOME/.cloudflared/$ID.json
ingress:
  - hostname: $HOST
    service: http://127.0.0.1:${PORT:-4320}
  - service: http_status:404
YML
    cloudflared tunnel route dns motion-studio "$HOST"
    sed "s|@CLOUDFLARED@|$CF|g" "$REPO/deploy/home-server/motion-studio-tunnel.service" > "$UNITS/motion-studio-tunnel.service"
    systemctl --user daemon-reload
    systemctl --user enable --now motion-studio-tunnel
    echo "tunnel up: https://$HOST (DNS can take a minute)"
    ;;
  *) sed -n '2,5p' "$0"; exit 1 ;;
esac
