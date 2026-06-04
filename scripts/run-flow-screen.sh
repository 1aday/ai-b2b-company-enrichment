#!/usr/bin/env bash
set -euo pipefail

run_id=""
for arg in "$@"; do
  case "$arg" in
    --run-id=*) run_id="${arg#--run-id=}" ;;
  esac
done

if [[ -z "$run_id" ]]; then
  run_id="capital-source-$(date -u +%Y%m%dT%H%M%SZ)"
  set -- "$@" "--run-id=${run_id}"
fi

session="capital-source-${run_id//[^A-Za-z0-9_-]/-}"
printf -v quoted_cwd "%q" "$(pwd)"
printf -v quoted_args " %q" "$@"
cmd="cd ${quoted_cwd} && npm run flow --${quoted_args}"

if ! command -v screen >/dev/null 2>&1; then
  echo "screen is not installed; running in the foreground." >&2
  exec bash -lc "$cmd"
fi

screen -dmS "$session" bash -lc "$cmd"
echo "started screen session: $session"
echo "attach with: screen -r $session"
