#!/bin/sh
set -eu

DEPLOY_ROOT=${BLADEIA_DEPLOY_ROOT:-/srv/bladeia}
cd "$DEPLOY_ROOT"
export BLADEIA_IMAGE_TAG=$(cat "$DEPLOY_ROOT/.deployed-image-tag")
docker compose --profile jobs run --rm job npm run jobs:campaign-dispatch

