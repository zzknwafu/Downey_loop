#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/downey-evals-loop/app}"
BRANCH="${BRANCH:-main}"

echo "Deploying Downey Evals Loop"
echo "APP_DIR=$APP_DIR"
echo "BRANCH=$BRANCH"

cd "$APP_DIR"
git fetch origin
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"
npm ci
npm run build
pm2 startOrReload ecosystem.config.cjs
pm2 save

echo "Deploy complete"
