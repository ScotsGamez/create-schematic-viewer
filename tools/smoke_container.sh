#!/usr/bin/env bash
set -euo pipefail

image=${1:?usage: smoke_container.sh IMAGE [CONTAINER_NAME] [HOST_PORT]}
container=${2:-schematic-viewer-smoke}
host_port=${3:-4173}

cleanup() {
  status=$?
  trap - EXIT
  if docker inspect "$container" >/dev/null 2>&1; then
    docker logs "$container" || true
    docker rm --force "$container" >/dev/null || true
  fi
  exit "$status"
}
trap cleanup EXIT

if [[ "$image" == *@sha256:* ]]; then
  docker pull "$image"
elif ! docker image inspect "$image" >/dev/null 2>&1; then
  docker pull "$image"
fi
docker run --detach --name "$container" \
  --publish "127.0.0.1:${host_port}:4173" \
  --read-only \
  --tmpfs /app/.tmp:rw,noexec,nosuid,size=512m \
  --tmpfs /data:rw,noexec,nosuid,size=128m,uid=1000,gid=1000 \
  "$image"

ready=false
for attempt in {1..30}; do
  if curl --fail --silent "http://127.0.0.1:${host_port}/readyz" >/dev/null; then
    ready=true
    break
  fi
  if [ "$attempt" -eq 30 ]; then
    echo "Container did not become ready" >&2
    exit 1
  fi
  sleep 1
done

test "$ready" = true
curl --fail --silent "http://127.0.0.1:${host_port}/" >/dev/null
curl --fail --silent \
  "http://127.0.0.1:${host_port}/vendor/three/three.min.js" >/dev/null
