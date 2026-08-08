#!/usr/bin/env bash
set -Eeuo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)

# shellcheck source=../bootstrap
source "$repo_root/.config/yadm/bootstrap"

unset DOCKER_GID
derive_docker_socket_gid >/dev/null

[[ -n ${DOCKER_GID:-} ]] || {
  printf 'DOCKER_GID was not exported\n' >&2
  exit 1
}
[[ "$DOCKER_GID" == "$(stat -c '%g' /var/run/docker.sock)" ]] || {
  printf 'DOCKER_GID does not match the live socket group\n' >&2
  exit 1
}
if (derive_docker_socket_gid /tmp/straylight-missing-docker.sock) >/dev/null 2>&1; then
  printf 'missing Docker socket was unexpectedly accepted\n' >&2
  exit 1
fi
