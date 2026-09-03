# GitHub diff filters

Two filters that shrink a pull request's diff to the part you actually have to
read.

- **Hide test files** — every test file collapses to a one-line stub showing its
  path and diffstat. The file tree hides them too, and a directory disappears
  once every file under it is hidden, so a `test/` subtree collapses whole. The
  PR header gains a second figure beside its own totals:
  `+3,022 −227 · excluding tests 1,320 lines`.
- **Hide comment diffs** — hides diff lines whose only change is a comment or
  whitespace.

Both apply themselves on every PR diff screen — `/pull/N/files`,
`/pull/N/changes`, and a PR's per-commit diffs. Nothing to click.

## Install

1. Open `chrome://extensions/`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → choose the `github-diff-filters` folder you unzipped

Chrome only installs `.crx` files from the Web Store, so an unpacked folder is
the way to share this.

## Using it

Each filter puts a pill in the bottom-right corner. Click a pill to toggle that
filter; the choice sticks per browser. Click a collapsed file's stub to open
just that file.

Files are matched by **path**, not content, so a test file collapses before its
diff has finished loading — which is what makes it usable on a 500-file PR.
Covered: test/spec/e2e/cypress/playwright/`__tests__`/`__mocks__`/
`__snapshots__` directories; `.spec.` `.test.` `.cy.` filenames; Python
`test_*.py` and `*_test.py`; Go `_test.go`; Ruby `_spec.rb`; JVM `*Test.java`
and `*Spec.kt`; .NET `*Tests.cs`; PHP `*Test.php`; `.snap`; `.feature`; and
test-runner configs.

For a repo that keeps tests somewhere unusual, add a pattern from the console —
it persists:

```js
__ghTestFileFilter.addRule('/legacy-checks/')
```

## If something looks wrong

`__ghTestFileFilter.debug()` prints a table of every file with the path it read,
the rule that matched, and its state. If the pill reads `⚠ N unread`, it matched
N file containers but could not read their paths — GitHub's markup moved, and
that table says which files.

## Why the header sometimes says "lines" instead of "+X −Y"

GitHub's classic file headers carry only a combined changed-lines number per
file, not a signed split. Counting rendered `+`/`−` rows looks like a way to
recover it, but a file Chrome left collapsed renders few rows, so those counts
under-report. The filter trusts a row count only when it foots to that file's
own changed-lines total, and otherwise reports changed lines.

## No permissions, no network

`manifest.json` requests no permissions and no host access beyond a content
script matched to `github.com`. The filters only hide DOM that GitHub already
sent you; nothing is collected and nothing is sent anywhere. Preferences live in
`localStorage` on github.com.

## Can't enable Developer mode?

Some managed Chrome profiles block unpacked extensions. Open
`bookmarklets.html` from this folder and drag either button to your bookmarks
bar — same filters, one click per page instead of automatic.
