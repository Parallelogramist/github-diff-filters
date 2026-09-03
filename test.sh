#!/usr/bin/env bash
# Run the bookmarklet test suites against both the readable source and the
# minified build, so a mangling regression cannot ship unnoticed.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== path classification rules ==="
node "$HERE/test/rules.test.js" | tail -3

echo
echo "=== DOM behaviour, /files markup (source) ==="
node "$HERE/test/dom.test.js" "$HERE/hide-test-files.src.js" | grep -E '^(  FAIL|ALL|[0-9]+ DOM)'

echo
echo "=== path extraction, /changes markup (source) ==="
node "$HERE/test/newui.test.js" "$HERE/hide-test-files.src.js" | grep -E '^(  FAIL|ALL|[0-9]+ NEW-UI)'

echo
echo "=== file tree + visible counts (source) ==="
node "$HERE/test/tree.test.js" "$HERE/hide-test-files.src.js" | grep -E '^(  FAIL|ALL|[0-9]+ TREE)'

echo
echo "=== collapsed-file counts (source) ==="
node "$HERE/test/collapsed.test.js" "$HERE/hide-test-files.src.js" | grep -E '^(  FAIL|ALL|[0-9]+ COLLAPSED)'

echo
echo "=== totals host without an id (source) ==="
node "$HERE/test/totals-host.test.js" "$HERE/hide-test-files.src.js" | grep -E '^(  FAIL|ALL|[0-9]+ TOTALS)'

echo
echo "=== per-file counts in the review view (source) ==="
node "$HERE/test/changes-counts.test.js" "$HERE/hide-test-files.src.js" | grep -E '^(  FAIL|ALL|[0-9]+ CHANGES)'

echo
echo "=== comment guard (source) ==="
node "$HERE/test/comments.test.js" "$HERE/hide-test-files.src.js" | grep -E '^(  FAIL|ALL|[0-9]+ COMMENT)'

echo
echo "=== per-repo preferences (source) ==="
node "$HERE/test/per-repo.test.js" "$HERE/hide-test-files.src.js" | grep -E '^(  FAIL|ALL|[0-9]+ PER)'

echo
echo "=== unchanged since last visit (source) ==="
node "$HERE/test/unchanged.test.js" "$HERE/hide-test-files.src.js" | grep -E '^(  FAIL|ALL|[0-9]+ UNCHANGED)'

echo
echo "=== noise categories (source) ==="
node "$HERE/test/categories.test.js" "$HERE/hide-test-files.src.js" | grep -E '^(  FAIL|ALL|[0-9]+ CATEGORY)'

echo
echo "=== extension content scripts (built bundle) ==="
node "$HERE/test/extension.test.js" | grep -E '^(  FAIL|ALL|[0-9]+ EXTENSION)'

echo
echo "=== keyboard shortcuts (built bundle) ==="
node "$HERE/test/shortcuts.test.js" | grep -E '^(  FAIL|ALL|[0-9]+ SHORTCUT)'

if [[ -f "$HERE/hide-test-files.min.js" ]]; then
    echo
    echo "=== DOM behaviour, /files markup (minified build) ==="
    node "$HERE/test/dom.test.js" "$HERE/hide-test-files.min.js" | grep -E '^(  FAIL|ALL|[0-9]+ DOM)'
    echo
    echo "=== path extraction, /changes markup (minified build) ==="
    node "$HERE/test/newui.test.js" "$HERE/hide-test-files.min.js" | grep -E '^(  FAIL|ALL|[0-9]+ NEW-UI)'
    echo
    echo "=== file tree + visible counts (minified build) ==="
    node "$HERE/test/tree.test.js" "$HERE/hide-test-files.min.js" | grep -E '^(  FAIL|ALL|[0-9]+ TREE)'
    echo
    echo "=== collapsed-file counts (minified build) ==="
    node "$HERE/test/collapsed.test.js" "$HERE/hide-test-files.min.js" | grep -E '^(  FAIL|ALL|[0-9]+ COLLAPSED)'
    echo
    echo "=== totals host without an id (minified build) ==="
    node "$HERE/test/totals-host.test.js" "$HERE/hide-test-files.min.js" | grep -E '^(  FAIL|ALL|[0-9]+ TOTALS)'
    echo
    echo "=== per-file counts in the review view (minified build) ==="
    node "$HERE/test/changes-counts.test.js" "$HERE/hide-test-files.min.js" | grep -E '^(  FAIL|ALL|[0-9]+ CHANGES)'
    echo
    echo "=== comment guard (minified build) ==="
    node "$HERE/test/comments.test.js" "$HERE/hide-test-files.min.js" | grep -E '^(  FAIL|ALL|[0-9]+ COMMENT)'
    echo
    echo "=== per-repo preferences (minified build) ==="
    node "$HERE/test/per-repo.test.js" "$HERE/hide-test-files.min.js" | grep -E '^(  FAIL|ALL|[0-9]+ PER)'
    echo
    echo "=== unchanged since last visit (minified build) ==="
    node "$HERE/test/unchanged.test.js" "$HERE/hide-test-files.min.js" | grep -E '^(  FAIL|ALL|[0-9]+ UNCHANGED)'
    echo
    echo "=== noise categories (minified build) ==="
    node "$HERE/test/categories.test.js" "$HERE/hide-test-files.min.js" | grep -E '^(  FAIL|ALL|[0-9]+ CATEGORY)'
fi
