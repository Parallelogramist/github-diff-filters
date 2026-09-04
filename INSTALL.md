# GitHub diff filters

Two filters that shrink a pull request's diff to the part you actually have to
read.

- **Hide files** — test files, snapshots, lockfiles, generated and vendored
  code, seeded data, renames with no changes, mode-only changes, binaries, and
  files you have marked Viewed each collapse to a one-line stub showing the path
  and diffstat. The file tree hides them too, and a directory disappears once
  every file under it is hidden, so a `test/` subtree collapses whole.
- **Hide comment diffs** — hides diff lines whose only change is a comment or
  whitespace, in languages whose comment syntax is known.

The PR header gains a second figure beside GitHub's own, typed the same way:
`+5,826 -179 · after filter +2,708 -168 -714 comment` — what is left to read once
both filters have done their work.

Both apply themselves on every PR diff screen — `/pull/N/files`,
`/pull/N/changes`, and a PR's per-commit diffs. Nothing to click.

## Install

1. Open `chrome://extensions/`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → choose the `github-diff-filters` folder you unzipped

Chrome only installs `.crx` files from the Web Store, so an unpacked folder is
the way to share this.

**Updating:** unzip the new archive over the same folder, then press **Reload**
on the extension's card at `chrome://extensions/`.

## Using it

One control sits in the bottom-right corner: `23:1383` — files hidden, then
comment lines hidden — beside a funnel that is lit while the filters are in
force. Hover it (or press Tab to it) and it expands into two pills, one per
filter, each saying what it hid.

- **Show** on a pill reveals that filter's hidden content for this pull request
  in this tab — a peek. It does not change what happens on the next PR.
- Click a collapsed file's stub to open just that file.
- The **funnel** opens the settings: switch the filter off for this repository,
  or turn any category off — say, keep lockfiles visible here. Those choices
  are stored per repository and follow your Chrome profile between machines.
  The extension's options page has the same controls.
- Keyboard: `t` shows or hides files, `c` shows or hides comment lines, `j` and
  `k` step through the files still on screen. Off automatically if you have
  disabled single-character shortcuts in GitHub's accessibility settings.

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
the rule that matched, and its state; `__ghTestFileFilter.report()` is the
compact version to paste into a bug report. If the pill warns `N unread`, it
matched N file containers but could not read their paths — GitHub's markup
moved, and the table says which files.

## Why the header sometimes says "lines" instead of "+X -Y"

GitHub's classic file headers carry only a combined changed-lines number per
file, not a signed split. Counting rendered `+`/`-` rows looks like a way to
recover it, but a file Chrome left collapsed renders few rows, so those counts
under-report. The filter trusts a row count only when it foots to that file's
own changed-lines total, and otherwise reports changed lines.

## One permission, no network

`manifest.json` requests `storage`, so your preferences sync across the
machines signed into your Chrome profile, and a content script matched to
`github.com`. Nothing else. The filters only hide DOM that GitHub already sent
you; nothing is collected and nothing is sent anywhere.

## Can't enable Developer mode?

Some managed Chrome profiles block unpacked extensions. Open
`bookmarklets.html` from this folder and drag either button to your bookmarks
bar — same filters, one click per page instead of automatic.
