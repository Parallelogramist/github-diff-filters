/**
 * The extension's content scripts, loaded in manifest order into a page that
 * mimics GitHub. Covers what the bookmarklet tests cannot: that the filters
 * stay dormant off a diff screen, start once a diff appears (including after a
 * Turbo navigation), never toggle themselves off on a second run, and drop the
 * "no diff found" nudge that only makes sense for a manual click.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// GH_EXTENSION_DIR lets the same suite verify a packaged copy, not just the source tree.
const EXT = process.env.GH_EXTENSION_DIR || path.join(__dirname, '..', 'extension');
const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
const contentScripts = manifest.content_scripts[0];

let failures = 0;
const ok = (cond, label) => { console.log((cond ? '  PASS  ' : '  FAIL  ') + label); if (!cond) failures++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const diffFile = (p, sha) => `<div data-file-path="${p}"><div class="file js-file" id="diff-${sha}">
  <div class="file-header" data-path="${p}"><div class="file-info"><a title="${p}">${p}</a></div>
    <span class="diffstat" aria-hidden="true">4 <span class="diffstat-block-added"></span></span></div>
  <table><tbody>
    <tr><td class="blob-num">1</td><td class="blob-code blob-code-addition">+ // a comment</td></tr>
    <tr><td class="blob-num">2</td><td class="blob-code blob-code-addition">+ code()</td></tr>
    <tr><td class="blob-num">3</td><td class="blob-code blob-code-addition">+ more()</td></tr>
    <tr><td class="blob-num">4</td><td class="blob-code blob-code-addition">+ last()</td></tr>
  </tbody></table></div></div>`;

const DIFF_HTML = `<span class="diffstat" id="diffstat">
    <span class="color-fg-success">+100</span><span class="color-fg-danger">−20</span></span>
  <div id="files">${diffFile('src/app.ts', 'a'.repeat(64))}${diffFile('src/app.spec.ts', 'b'.repeat(64))}</div>`;

function loadContentScripts(window) {
    for (const file of contentScripts.js) {
        window.eval(fs.readFileSync(path.join(EXT, file), 'utf8'));
    }
}

(async () => {
    console.log('\n-- manifest --');
    ok(manifest.manifest_version === 3, 'manifest v3');
    ok(contentScripts.world === 'MAIN',
        'content scripts run in the MAIN world, so the console API and the bookmarklets share one instance');
    ok(contentScripts.matches.length === 1 && contentScripts.matches[0] === 'https://github.com/*',
        'matched across github.com, because Turbo navigation never reloads the document');
    ok(contentScripts.js.indexOf('bootstrap.js') === 2, 'bootstrap runs after both filters');
    ok(contentScripts.js[contentScripts.js.length - 1] === 'pill-skin.js', 'pill skin runs last');
    for (const file of contentScripts.js) {
        ok(fs.existsSync(path.join(EXT, file)), `${file} exists`);
    }

    console.log('\n-- icons --');
    const declared = manifest.icons || {};
    ok(Object.keys(declared).length === 4, 'four icon sizes declared');
    for (const [size, file] of Object.entries(declared)) {
        const abs = path.join(EXT, file);
        if (!fs.existsSync(abs)) { ok(false, `${file} exists`); continue; }
        const png = fs.readFileSync(abs);
        const isPng = png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
        const width = png.readUInt32BE(16);
        const height = png.readUInt32BE(20);
        ok(isPng && width === Number(size) && height === Number(size),
            `${file} is a ${size}x${size} PNG (got ${width}x${height})`);
    }

    console.log('\n-- dormant on a PR page that is not a diff --');
    let dom = new JSDOM('<!doctype html><html><body><div id="conversation"></div></body></html>',
        { url: 'https://github.com/acme/repo/pull/7', runScripts: 'outside-only' });
    if (dom.window.document.readyState !== 'complete') {
        await new Promise(r => dom.window.addEventListener('load', r, { once: true }));
    }
    loadContentScripts(dom.window);
    await sleep(400);
    ok(dom.window.__ghDiffFilterBootstrap === true, 'bootstrap itself ran');
    ok(dom.window.__ghDiffFilterQueue.length === 2, 'both filters queued, neither started');
    ok(typeof dom.window.__ghTestFileFilter === 'undefined', 'test filter not installed');
    ok(!dom.window.document.getElementById('ghtf-pill'), 'no pill on a non-diff page');
    ok(!/No diff found/.test(dom.window.document.body.textContent), 'no stray nudge');

    console.log('\n-- starts after a Turbo navigation into the diff --');
    dom.reconfigure({ url: 'https://github.com/acme/repo/pull/7/files' });
    dom.window.document.body.innerHTML = DIFF_HTML;
    dom.window.dispatchEvent(new dom.window.Event('turbo:load'));
    await sleep(500);
    const doc = dom.window.document;
    ok(dom.window.__ghDiffFilterAuto === true, 'auto flag set for the filters to read');
    ok(typeof dom.window.__ghTestFileFilter === 'object', 'test filter installed on the diff screen');
    ok(doc.querySelectorAll('.ghtf-stub').length === 1, 'the .spec.ts file is hidden (got '
        + doc.querySelectorAll('.ghtf-stub').length + ')');
    ok(!!doc.getElementById('ghtf-pill'), 'pill rendered');
    ok(!!doc.querySelector('.ghtf-visible-stat'), 'visible-count badge rendered');

    console.log('\n-- both pills read the same way, with the action spelled out --');
    await sleep(300);
    const testPill = doc.getElementById('ghtf-pill');
    const commentPill = doc.getElementById('ghccf-pill');
    ok(!!commentPill, 'comment filter rendered its pill');
    const chipOf = el => el && el.querySelector('.ghdf-pill-action');
    ok(chipOf(testPill) && chipOf(testPill).textContent === 'Show',
        'test pill offers Show (got: ' + (chipOf(testPill) || {}).textContent + ')');
    ok(chipOf(commentPill) && chipOf(commentPill).textContent === 'Show',
        'comment pill offers Show (got: ' + (chipOf(commentPill) || {}).textContent + ')');
    ok(!/click to/i.test(testPill.textContent + commentPill.textContent),
        'neither pill still says "click to"');
    ok(commentPill.getAttribute('data-ghdf-skin') === 'styled', 'comment pill restyled to match');
    const chipCount = commentPill.querySelectorAll('.ghdf-pill-action').length;
    await sleep(300);
    ok(commentPill.querySelectorAll('.ghdf-pill-action').length === chipCount,
        'the skin settles instead of re-rendering itself in a loop');

    console.log('\n-- the action flips to Hide once hiding is off --');
    dom.window.__ghTestFileFilter.enabled = false;
    await sleep(50);
    ok(chipOf(doc.getElementById('ghtf-pill')).textContent === 'Hide',
        'test pill offers Hide when files are shown');
    dom.window.__ghTestFileFilter.enabled = true;
    await sleep(50);

    console.log('\n-- a second run re-applies instead of toggling off --');
    const before = doc.querySelectorAll('.ghtf-stub').length;
    for (const filter of dom.window.__ghDiffFilterQueue) filter();
    await sleep(50);
    ok(dom.window.__ghTestFileFilter.enabled === true, 'still enabled after a repeat run');
    ok(doc.querySelectorAll('.ghtf-stub').length === before, 'still ' + before + ' file hidden, not unhidden');

    console.log('\n-- the "no diff found" nudge is suppressed while auto-installed --');
    doc.getElementById('files').remove();
    dom.window.__ghTestFileFilter.apply();
    await sleep(100);
    ok(!/No diff found/.test(doc.body.textContent),
        'nudge never reaches the page (got: ' + JSON.stringify(doc.body.textContent.slice(0, 60)) + ')');

    console.log('\n-- a bookmarklet click still gets the nudge --');
    const plain = new JSDOM('<!doctype html><html><body></body></html>',
        { url: 'https://github.com/acme/repo', runScripts: 'outside-only' });
    if (plain.window.document.readyState !== 'complete') {
        await new Promise(r => plain.window.addEventListener('load', r, { once: true }));
    }
    plain.window.eval(fs.readFileSync(path.join(EXT, 'filters', 'hide-test-files.js'), 'utf8')
        .replace(/^[\s\S]*?\{\s*if \(window\.__ghTestFileFilter\)[^\n]*\n/, '')
        .replace(/\}\);\s*$/, ''));
    ok(/No diff found/.test(plain.window.document.body.textContent),
        'the bookmarklet build keeps its nudge, since nothing set the auto flag');

    console.log('\n' + (failures === 0 ? 'ALL EXTENSION ASSERTIONS PASS' : failures + ' EXTENSION FAILURES'));
    process.exit(failures ? 1 : 0);
})();
