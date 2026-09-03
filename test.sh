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
echo "=== extension content scripts (built bundle) ==="
node "$HERE/test/extension.test.js" | grep -E '^(  FAIL|ALL|[0-9]+ EXTENSION)'

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
fi
