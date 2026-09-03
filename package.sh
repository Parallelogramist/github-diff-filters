#!/usr/bin/env bash
# Build a shareable zip of the extension.
#
# Chrome refuses .crx files installed from outside the Web Store, so the only
# thing worth handing a coworker is the unpacked folder plus install notes.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NAME="github-diff-filters"
VERSION="$(node -p "require('$HERE/extension/manifest.json').version")"
DIST="$HERE/dist"
STAGE="$(mktemp -d)/$NAME"
ZIP="$DIST/$NAME-$VERSION.zip"
STORE_ZIP="$DIST/$NAME-$VERSION-webstore.zip"

"$HERE/build.sh" hide-test-files > /dev/null

mkdir -p "$STAGE" "$DIST"
cp -R "$HERE/extension/." "$STAGE/"
cp "$HERE/install.html" "$STAGE/bookmarklets.html"
cp "$HERE/INSTALL.md" "$STAGE/INSTALL.md"
find "$STAGE" -name '.DS_Store' -delete

rm -f "$ZIP"
(cd "$(dirname "$STAGE")" && zip -r -X -q "$ZIP" "$NAME")
rm -rf "$(dirname "$STAGE")"

# The Web Store wants manifest.json at the zip root; "Load unpacked" wants a
# folder. Same files, two shapes.
rm -f "$STORE_ZIP"
(cd "$HERE/extension" && zip -r -X -q "$STORE_ZIP" . -x '.DS_Store')

echo "$ZIP"
unzip -Z1 "$ZIP" | sed 's/^/  /'
echo "$STORE_ZIP"
unzip -Z1 "$STORE_ZIP" | sed 's/^/  /'
