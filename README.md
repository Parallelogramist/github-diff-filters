# GitHub diff filters

A Chrome extension that shrinks a GitHub pull request diff to the part you
actually have to read. Two filters, applied automatically on every PR diff
screen:

- **Hide test files** — every test file collapses to a one-line stub showing its
  path and diffstat. The file tree hides them too, and a directory disappears
  once every file under it is hidden, so a `test/` subtree collapses whole. The
  PR header gains a second figure beside its own totals:
  `+3,022 −227 · excluding tests 1,320 lines`.
- **Hide comment diffs** — hides diff lines whose only change is a comment or
  whitespace.

Beyond tests, it hides the rest of what swamps a large diff — lockfiles,
snapshots, generated and vendored code, seeded data — each category switchable
on its own, per repository. A file carrying **review feedback is never
collapsed**, and `onlyChanged` mode collapses whatever is identical to your
previous visit, which is what a re-review after a fix round actually needs.

![Both filters running on a pull request](docs/pills.png)

The extension keeps one control in the bottom-right corner: `files:lines` — how
many files and how many comment-only lines are hidden — beside an icon that is
lit while the filters are in force. Hover or focus it and it expands to the two
pills, each stating what it hid and what clicking does; a click on the icon pins
them open. The choice persists per browser.

![Test files collapsed to one-line stubs](docs/collapsed-test-files.png)

## Install

Load it unpacked:

1. Open `chrome://extensions/`
2. Turn on **Developer mode**
3. **Load unpacked** → choose this repository's `extension/` folder

`npm run package` builds two zips in `dist/`: one wrapping a folder for sharing
with someone who will Load unpacked, and one with `manifest.json` at the root
for a Chrome Web Store submission. See [CHROME_WEB_STORE.md](CHROME_WEB_STORE.md)
to publish it.

Managed Chrome profiles often block unpacked extensions. `install.html` offers
the same two filters as bookmarklets — drag either button to the bookmarks bar
and click it on a diff.

## Keyboard

| Key | Action |
| --- | --- |
| `t` | Hide or show test files |
| `c` | Hide or show comment-only lines |
| `j` / `k` | Next and previous file still on screen |

Modifiers, text fields and anything that is not a diff screen are left alone.

## How it decides what is a test file

By **path**, never by content, so a file collapses before its diff has finished
loading — which is what makes it usable on a 500-file PR.

Covered: `test`/`tests`/`spec`/`specs`/`__tests__`/`__mocks__`/`__snapshots__`/
`__fixtures__`/`testdata`/`e2e`/`cypress`/`playwright` directories; `.spec.`
`.test.` `.cy.` filenames with `.`, `-` or `_` separators; Python `test_*.py`,
`*_test.py`, `conftest.py`; Go `_test.go`; Ruby `_spec.rb`; JVM `*Test.java`,
`*Spec.kt`, `*IT.java`; .NET `*Tests.cs`; PHP `*Test.php`; `.snap`; `.feature`;
and test-runner configs.

Deliberately not matched: `test-utils/`, `latest.ts`, `manifest.js`,
`request.ts`, `webpack.config.js` — near-misses a looser rule would eat. The
full table of both is in `test/rules.test.js`.

For a repo that keeps tests somewhere unusual, add a pattern from the console;
it persists:

```js
__ghTestFileFilter.addRule('/legacy-checks/')
```

## Console API

`window.__ghTestFileFilter`:

| Member | Purpose |
| --- | --- |
| `enabled` | Get/set the repository's stored preference |
| `hiding` | Whether files are hidden right now, preference and peek together |
| `peek(on)` | Show the hidden files for this pull request without changing the preference |
| `debug()` | Table of every file with its path, matched rule, state and diffstat |
| `rules` | The active rule list |
| `addRule(pattern)` | Persist an extra path pattern |
| `clearCustomRules()` | Drop the persisted extras |
| `show(needle)` | Reveal every hidden file whose path contains `needle` |
| `apply()` / `reset()` | Re-run or undo the pass |
| `defaultEnabled` | The setting for repositories with no preference of their own |
| `repo` / `clearRepoPreference()` | The current scope, and handing it back to the default |
| `onlyChanged` | Collapse files identical to your previous visit to this PR |
| `categories` / `setCategory(name, on)` | Which kinds of noise hide: test, snapshot, lockfile,
generated, vendored, data, rename, mode, binary, viewed |
| `report()` | Dump what the path and count probes actually saw, for a markup change |

Preferences resolve per repository with a global fallback, so switching tests
back on for one repo leaves the rest alone, and they follow your Chrome profile
between machines. Nothing here needs the console: the gear on the pill opens the
same controls, and the extension has an options page.

Clicking the pill, or pressing `t`, is a **peek** — it shows the hidden files
for this pull request and leaves the repository's setting alone. Only the
popover, the options page or `enabled` change what happens next time.

`window.__ghCommentFilter` carries the same `enabled` / `hiding` / `peek()` /
`apply()` / `reset()` / `debug(needle)` surface for comment-only lines, and
`window.__ghDiffFilterControls` exposes `keys`, `setKey(action, key)`, `enabled`
and `help()` for the keyboard shortcuts.

If the pill warns `N unread`, it matched N file containers but could not read
their paths — GitHub's markup moved, and `debug()` says which files.

## Why the header sometimes says "lines" instead of "+X −Y"

GitHub's classic file headers carry only a combined changed-lines number per
file, not a signed split; the signed totals exist only for the PR as a whole.
Counting rendered `+`/`−` rows looks like a way to recover the split, but a file
GitHub left collapsed renders few or no rows, so those counts silently
under-report. A row count is trusted only when it foots to that file's own
changed-lines total, and otherwise changed lines are reported. A wrong number is
worse than a coarser one.

## Two GitHub diff UIs

`/pull/N/files` exposes a path on `data-path`. The newer `/pull/N/changes`
review view carries the path only as header text, split across a directory span
and a filename span with the diffstat glued on the end and a chevron in front.
Path extraction handles both, and reports the count of containers whose path it
could not read rather than skipping them silently.

## Development

```bash
npm install
npm test        # every suite, against the readable source AND the minified build
npm run build   # minify, encode the bookmarklet URL, regenerate install.html + extension
npm run icons   # rasterise icon.svg to the PNG sizes the manifest declares
npm run package # build, then zip for sharing and for the Web Store
```

Edit `hide-test-files.src.js`. `extension/filters/*.js` and the `.min.js` /
`.bookmarklet.txt` artifacts are build output.

The extension ships the **readable** source of both filters rather than the
minified builds:
the Chrome Web Store rejects obfuscated code, and reviewers read what ships.
Minification exists only to fit the bookmarklet into a URL.

Tests run in jsdom against markup modelled on both GitHub diff views, and the
filter behaviour was checked against live public pull requests —
`vercel/next.js#98217` (86 files: 54 hidden, 32 kept, 89 of 141 tree rows
hidden, header figure matching the number computed from the GitHub API) and
`facebook/react#37516`.

## License

MIT — see [LICENSE](LICENSE).
