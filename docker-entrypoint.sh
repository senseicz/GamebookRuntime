#!/bin/sh
# Downloads the adventure from GitHub into the data directory BEFORE the
# runtime starts. The .NET app itself never talks to GitHub.
#
# Environment:
#   ADVENTURE_REPO            owner/name of the adventure repo (required to download)
#   ADVENTURE_REPO_BRANCH     branch/tag/commit to download (default: main)
#   ADVENTURE_FILE_PATH       path to the main adventure JSON inside the repo (default: adventure.json)
#   ADVENTURE_TOKEN           optional GitHub token (private repos / rate limits)
#   ADVENTURE_DATA_DIR        where to place files (default: /data)
#   ADVENTURE_FORCE_DOWNLOAD  "1" = re-download even if the adventure file already exists
set -e

DATA_DIR="${ADVENTURE_DATA_DIR:-/data}"
FILE_PATH="${ADVENTURE_FILE_PATH:-adventure.json}"
BRANCH="${ADVENTURE_REPO_BRANCH:-main}"
TARGET="$DATA_DIR/$FILE_PATH"

if [ -z "$ADVENTURE_REPO" ]; then
  echo "[entrypoint] ADVENTURE_REPO not set — assuming the adventure is already baked into the image."
else
  if [ -f "$TARGET" ] && [ "$ADVENTURE_FORCE_DOWNLOAD" != "1" ]; then
    echo "[entrypoint] Adventure already present at $TARGET — skipping download (set ADVENTURE_FORCE_DOWNLOAD=1 to force)."
  else
    echo "[entrypoint] Downloading $ADVENTURE_REPO@$BRANCH into $DATA_DIR …"
    mkdir -p "$DATA_DIR"

    # Repo tarball for the requested branch/tag/commit, flattened into DATA_DIR.
    if [ -n "$ADVENTURE_TOKEN" ]; then
      curl -sSfL -H "Authorization: Bearer $ADVENTURE_TOKEN" \
        "https://api.github.com/repos/$ADVENTURE_REPO/tarball/$BRANCH" \
        | tar xz --strip-components=1 -C "$DATA_DIR"
    else
      curl -sSfL "https://api.github.com/repos/$ADVENTURE_REPO/tarball/$BRANCH" \
        | tar xz --strip-components=1 -C "$DATA_DIR"
    fi

    if [ ! -f "$TARGET" ]; then
      echo "[entrypoint] ERROR: $FILE_PATH not found in $ADVENTURE_REPO@$BRANCH" >&2
      exit 1
    fi
    echo "[entrypoint] Download complete."
  fi
fi

# Point the runtime at the data directory and start the app.
export ADVENTURE__DATADIR="$DATA_DIR"
export ADVENTURE__FILEPATH="$FILE_PATH"
exec dotnet GamebookRuntime.dll
