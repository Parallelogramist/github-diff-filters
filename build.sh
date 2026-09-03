#!/usr/bin/env bash
# Minify a bookmarklet source file and emit the pasteable javascript: URL.
#   ./build.sh hide-test-files
set -euo pipefail

NAME="${1:?usage: build.sh <basename-without-extension>}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_MODULES="$HERE/node_modules"

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

node "$HERE/make-install-page.js"
node "$HERE/build-extension.js"

printf "%s\n" "source     $(wc -c < "$SRC" | tr -d ' ') bytes" \
              "minified   $(wc -c < "$MIN" | tr -d ' ') bytes" \
              "bookmarklet $(wc -c < "$OUT" | tr -d ' ') bytes -> $OUT"
