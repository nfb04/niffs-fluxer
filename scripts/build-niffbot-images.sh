#!/usr/bin/env bash
set -euo pipefail

# Build custom images from this fork for the self-host stack.
#
# Usage (from repo root):
#   ./scripts/build-niffbot-images.sh app-proxy-self-hosted api
#   NIFFBOT_TAG=2026.06.17-niffbot.1 ./scripts/build-niffbot-images.sh app-proxy-self-hosted api gateway
#
# Images: ghcr.io/nfb04/fluxer-<service>:<NIFFBOT_TAG>  (override with NIFFBOT_REGISTRY)

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

NIFFBOT_TAG="${NIFFBOT_TAG:-dev}"
REGISTRY_PREFIX="${NIFFBOT_REGISTRY:-ghcr.io/nfb04}"

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <service> [service...]" >&2
  echo "Common: app-proxy-self-hosted api gateway media-proxy admin messages users snowflakes unfurl gifs" >&2
  exit 1
fi

declare -A DOCKERFILE_BY_SERVICE=(
  [api]="fluxer_api/Dockerfile"
  [app-proxy-self-hosted]="fluxer_app_proxy/Dockerfile"
  [gateway]="fluxer_gateway/Dockerfile"
  [media-proxy]="fluxer_media_proxy/Dockerfile"
  [admin]="fluxer_admin/Dockerfile"
  [messages]="fluxer_messages/Dockerfile"
  [users]="fluxer_users/Dockerfile"
  [snowflakes]="fluxer_snowflakes/Dockerfile"
  [unfurl]="fluxer_unfurl/Dockerfile"
  [static]="fluxer_static/Dockerfile"
  [gifs]="fluxer_gifs/Dockerfile"
)

for service in "$@"; do
  dockerfile="${DOCKERFILE_BY_SERVICE[$service]:-}"
  if [[ -z "$dockerfile" || ! -f "$dockerfile" ]]; then
    echo "Unknown or missing Dockerfile for service: $service" >&2
    exit 1
  fi

  image="$REGISTRY_PREFIX/fluxer-$service:$NIFFBOT_TAG"
  extra_args=()
  if [[ "$service" == "app-proxy-self-hosted" ]]; then
    extra_args+=(--build-arg "FLUXER_APP_PROXY_TIME_FREEZE_ENABLED=false")
  fi

  echo "==> Building $image"
  docker build "${extra_args[@]}" -f "$dockerfile" -t "$image" .
  echo "==> Done $image"
done

cat <<EOF

Deploy from /opt/fluxer/stack:

  # set NIFFBOT_TAG in .env or docker-compose.niffbot.yml
  docker compose -f docker-compose.yml -f docker-compose.niffbot.yml up -d

EOF
