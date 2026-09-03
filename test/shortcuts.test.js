/**
 * Keyboard shortcuts, which must stay out of the way of typing and of GitHub's
 * own keys, and must only act on a diff screen.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const EXT = process.env.GH_EXTENSION_DIR || path.join(__dirname, '..', 'extension');
const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));

let failures = 0;
const ok = (cond, label) => { console.log((cond ? '  PASS  ' : '  FAIL  ') + label); if (!cond) failures++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const file = (p, sha) => `<div data-file-path="${p}"><div class="file js-file" id="diff-${sha}">
  <div class="file-header" data-path="${p}"><div class="file-info"><a title="${p}">${p}</a>
    <span aria-label="4 additions &amp; 1 deletion"></span></div></div>
  <table><tbody><tr><td class="blob-num">1</td><td class="blob-code blob-code-addition">+ // hi</td></tr>
  <tr><td class="blob-num">2</td><td class="blob-code blob-code-addition">+ run()</td></tr></tbody></table>
</div></div>`;

const html = `<!doctype html><html><body>
  <span class="diffstat" id="diffstat"><span class="color-fg-success">+9</span><span class="color-fg-danger">−3</span></span>
  <input id="filter" type="text">
  <div id="files">${file('src/app.ts', 'a'.repeat(64))}${file('src/app.spec.ts', 'b'.repeat(64))}</div>
</body></html>`;

(async () => {
    const dom = new JSDOM(html, { url: 'https://github.com/acme/repo/pull/1/files', runScripts: 'outside-only' });
    if (dom.window.document.readyState !== 'complete') {
        await new Promise(r => dom.window.addEventListener('load', r, { once: true }));
    }
    const { window } = dom;
    const doc = window.document;
    for (const f of manifest.content_scripts[0].js) window.eval(fs.readFileSync(path.join(EXT, f), 'utf8'));
    await sleep(400);

    const press = (key, opts = {}, target = doc.body) => target.dispatchEvent(
        new window.KeyboardEvent('keydown', { key, bubbles: true, ...opts }));
    const testFilter = () => window.__ghTestFileFilter;

    console.log('\n-- t toggles the test filter --');
    ok(testFilter().enabled === true, 'starts enabled');
    press('t');
    await sleep(30);
    ok(testFilter().enabled === false, 't turned it off');
    press('t');
    await sleep(30);
    ok(testFilter().enabled === true, 't turned it back on');

    console.log('\n-- c reaches the comment filter --');
    const before = window.__ghCommentFilter && window.__ghCommentFilter.enabled;
    press('c');
    await sleep(30);
    ok(window.__ghCommentFilter && window.__ghCommentFilter.enabled === !before, 'c toggled it');
    press('c');
    await sleep(30);

    console.log('\n-- typing and modifiers are left alone --');
    press('t', {}, doc.getElementById('filter'));
    await sleep(30);
    ok(testFilter().enabled === true, 't in a text field does nothing');
    press('t', { metaKey: true });
    await sleep(30);
    ok(testFilter().enabled === true, 'cmd-t does nothing');

    console.log('\n-- j and k walk the visible files --');
    const seen = [];
    for (const el of doc.querySelectorAll('.js-file')) {
        el.scrollIntoView = () => seen.push(el.id);
    }
    press('j');
    ok(seen.length === 1 && seen[0] === 'diff-' + 'a'.repeat(64),
        'j lands on the first visible file (got: ' + JSON.stringify(seen) + ')');
    press('j');
    ok(seen.length === 2 && seen[1] === 'diff-' + 'a'.repeat(64),
        'and does not walk into the collapsed spec file (got: ' + JSON.stringify(seen) + ')');

    console.log('\n-- nothing fires off a diff screen --');
    dom.reconfigure({ url: 'https://github.com/acme/repo/pulls' });
    press('t');
    await sleep(30);
    ok(testFilter().enabled === true, 't is inert on a non-diff page');

    console.log('\n' + (failures === 0 ? 'ALL SHORTCUT ASSERTIONS PASS' : failures + ' SHORTCUT FAILURES'));
    process.exit(failures ? 1 : 0);
})();
