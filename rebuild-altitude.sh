#!/bin/bash
set -euo pipefail

# A rebuilt image does not replace the running container by itself: compose compares
# the service configuration rather than the image under the tag, so a deploy that only
# builds leaves the previous binary serving and looks like it worked. --no-deps keeps
# the deploy to altitude; caddy in front of it does not need restarting to route to a
# new process.
git -C ~/altitude pull --ff-only
docker compose -f ~/straylight-docker/docker-compose.yml up -d --build --force-recreate --no-deps altitude
