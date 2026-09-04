#!/usr/bin/env bash
# Minify a bookmarklet source file and emit the pasteable javascript: URL.
#   ./build.sh hide-test-files
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_MODULES="$HERE/node_modules"

# Both filters by default; a single name still works for one of them.
NAMES=("$@")
if [ ${#NAMES[@]} -eq 0 ]; then NAMES=(hide-test-files hide-comment-diffs); fi

for NAME in "${NAMES[@]}"; do
    SRC="$HERE/$NAME.src.js"
    MIN="$HERE/$NAME.min.js"
    OUT="$HERE/$NAME.bookmarklet.txt"

    node --check "$SRC"
    node "$NODE_MODULES/terser/bin/terser" "$SRC" \
        --compress passes=3 --mangle --format quote_style=1 --output "$MIN"
    node --check "$MIN"
    node -e '
const fs = require("fs");
const min = fs.readFileSync(process.argv[1], "utf8").trim();
fs.writeFileSync(process.argv[2], "javascript:" + encodeURIComponent(min) + "\n");
    ' "$MIN" "$OUT"

    printf "%s\n" "$NAME  source $(wc -c < "$SRC" | tr -d ' ') / minified $(wc -c < "$MIN" | tr -d ' ') / bookmarklet $(wc -c < "$OUT" | tr -d ' ') bytes"
done

node "$HERE/make-install-page.js"
node "$HERE/build-extension.js"

# An unpacked extension Chrome has loaded from another directory drifts the
# moment this one is rebuilt, and the copy Chrome reads is the one that matters.
# `.extension-mirror` (gitignored, one path per line) names those directories.
MIRROR_LIST="$HERE/.extension-mirror"
if [ -f "$MIRROR_LIST" ]; then
    while IFS= read -r MIRROR; do
        [ -n "$MIRROR" ] || continue
        [ -d "$MIRROR" ] || continue
        rm -rf "$MIRROR.tmp"
        cp -R "$HERE/extension" "$MIRROR.tmp"
        rm -rf "$MIRROR"
        mv "$MIRROR.tmp" "$MIRROR"
        printf "mirrored to %s\n" "$MIRROR"
    done < "$MIRROR_LIST"
fi
