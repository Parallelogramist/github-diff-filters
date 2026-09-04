#!/usr/bin/env bash
# The minified filter, the bookmarklet URL, the install page and the extension
# bundle are generated and committed, so they can drift from the source they
# were built from with nothing failing. This rebuilds them and compares against
# what is on disk, so it answers the same question in CI and locally: does the
# checked-out output match the checked-out source?
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

GENERATED=(
    hide-test-files.min.js
    hide-test-files.bookmarklet.txt
    install.html
    extension/filters/hide-test-files.js
    extension/filters/hide-comment-diffs.js
)

SNAPSHOT="$(mktemp -d)"
trap 'rm -rf "$SNAPSHOT"' EXIT
for file in "${GENERATED[@]}"; do
    mkdir -p "$SNAPSHOT/$(dirname "$file")"
    cp "$file" "$SNAPSHOT/$file"
done

npm run build > /dev/null

STALE=()
for file in "${GENERATED[@]}"; do
    if ! cmp -s "$SNAPSHOT/$file" "$file"; then STALE+=("$file"); fi
done

if [ ${#STALE[@]} -eq 0 ]; then
    printf 'built artifacts match their source (%d checked)\n' "${#GENERATED[@]}"
    exit 0
fi

printf 'these built artifacts do not match their source — run `npm run build` and commit the result:\n'
printf '  %s\n' "${STALE[@]}"
exit 1
