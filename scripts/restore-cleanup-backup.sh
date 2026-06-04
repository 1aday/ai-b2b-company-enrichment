#!/usr/bin/env bash
set -euo pipefail

snapshot="${1:-}"
if [[ -z "$snapshot" ]]; then
  snapshot="$(find .cleanup-backups -maxdepth 1 -type d -name '*-pre-standalone-cleanup' 2>/dev/null | sort | tail -n 1)"
fi

if [[ -z "$snapshot" ]]; then
  echo "No cleanup backup snapshot found under .cleanup-backups/." >&2
  exit 1
fi

archive="${snapshot%/}/source-config-docs.tgz"
if [[ ! -f "$archive" ]]; then
  echo "Backup archive not found: $archive" >&2
  exit 1
fi

echo "Restoring cleanup backup from: $archive"
tar -xzf "$archive"
echo "Restore complete."
