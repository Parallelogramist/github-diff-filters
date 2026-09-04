# Publishing to the Chrome Web Store

Everything below is done once per extension, from a Google account you own.
Note up front: a public listing shows a **publisher name**, so whichever
account you use, your name or chosen publisher display name is visible on the
listing page.

## 1. Register as a developer (one time)

1. Sign in to the Google account you want to own the listing.
2. Open the [Developer Dashboard](https://chrome.google.com/webstore/devconsole).
3. Accept the developer agreement and pay the **one-time 5 USD** registration
   fee. It covers the account, not the extension.
4. Verify your contact email in **Account** → it must be verified before you
   can publish.

## 2. Build the upload

```bash
npm run package
```

Upload `dist/github-diff-filters-<version>-webstore.zip`. That is the one with
`manifest.json` at the **root** of the zip — the store rejects a zip that wraps
the files in a folder. The other zip in `dist/` is the folder-shaped one for
sharing with someone who will Load unpacked; don't upload that.

Each submission needs a higher `version` than the last, so bump it in
`extension/manifest.json` before packaging an update. A version number can
never be reused.

## 3. Create the item

**Dashboard** → **Items** → **Add new item** → drop the zip in.

## 4. Store listing

Assets in this repo:

| Field | File |
| --- | --- |
| Store icon, 128×128 | `extension/icons/icon-128.png` |
| Screenshot, 1280×800 | `docs/store-screenshot-1280x800.png` |

At least one screenshot is required (1280×800 or 640×400, PNG or JPEG, up to
five). A 440×280 small promo tile is optional and only affects how the listing
looks in store collections.

Copy you can paste:

**Summary** (single line, keep it under 132 characters)

> Collapses test files, lockfiles, generated code and comment-only lines in GitHub pull request diffs, so a review shows only the code that changed.

**Description**

> GitHub diff filters shrinks a pull request diff to the part you actually have to read.
>
> Hide files — every test file, snapshot, lockfile, generated or vendored file collapses to a one-line stub showing its path and diffstat, each category switchable per repository. The file tree hides them too, and a directory disappears once every file under it is hidden, so a test/ subtree collapses whole. The PR header gains a second figure beside its own totals, showing how many lines changed outside the tests.
>
> Hide comment diffs — hides diff lines whose only change is a comment or whitespace.
>
> Both apply themselves on every PR diff screen. One control in the corner reads `files:lines` — what each filter hid — and expands on hover to the two pills, each stating what it hid and what clicking does. The choice is remembered.
>
> Files are matched by path, not content, so a test file collapses before its diff has finished loading — which is what makes it usable on a very large pull request. Test conventions for JavaScript, TypeScript, Python, Go, Ruby, Java, Kotlin, Scala, C#, PHP, Cucumber and the common test-runner configs are recognised, and you can add a pattern of your own from the console.
>
> Nothing is collected and nothing is sent anywhere. The extension requests no permissions and only hides page content GitHub already sent to your browser.

**Category**: Developer Tools. **Language**: English.

## 5. Privacy practices

This is where submissions usually stall, so fill it carefully.

**Single purpose**

> Hides parts of a GitHub pull request diff — test files, lockfiles, generated code and comment-only lines — so a code review shows only the code that changed.

**Host permission justification** (asked because the content script matches
`https://github.com/*`)

> The extension's content script runs on github.com pull request pages, where it reads the rendered diff and hides the file sections and diff lines the user has chosen not to see. It needs page access on github.com to find and hide that markup. No other host is requested, and no page data leaves the browser.

**Remote code**: answer **No**. Everything executes from files in the package;
nothing is fetched or evaluated from a remote source.

**Data usage**: certify that you do **not** collect or transmit user data. This
extension only hides DOM that GitHub already served, and stores two
preferences in `localStorage` on github.com. Because no user data is
collected, no privacy-policy URL is required — if the form insists on one, any
page stating that the extension collects nothing satisfies it.

## 6. Visibility and submit

- **Public** — anyone can find and install it.
- **Unlisted** — installable only by direct link; does not appear in search.
  A good first step if you want coworkers on it before the world.
- **Private** — restricted to accounts you name as trusted testers.

Then **Submit for review**. Review is typically a few days, and can be longer
for a first submission from a new account. You get email on approval or
rejection; a rejection names the policy at issue and you resubmit after
fixing it.

## What the reviewer sees

Every script in the package is readable source. Nothing is minified and nothing
is obfuscated, so there is no source to be asked for that is not already there:

| File | What it does |
| --- | --- |
| `bridge.js` | Relays preferences to and from synced storage (isolated world) |
| `filters/hide-test-files.js` | Classifies files and hides the noise |
| `filters/hide-comment-diffs.js` | Hides comment-only and whitespace-only lines |
| `bootstrap.js` | Starts the filters once a diff is on screen |
| `controls.js` | The corner control the two pills expand from, and the keyboard shortcuts |
| `options.html` / `options.js` / `options.css` | The settings page |

The minified builds in the repository root exist for the bookmarklets, which
have to fit in a URL. They are not part of the extension.
