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
// Addressed by world, not by position: the isolated-world bridge is a
// separate entry and the order of the two is not the contract.
const contentScripts = manifest.content_scripts.find(entry => entry.world === 'MAIN');
const bridgeScripts = manifest.content_scripts.find(entry => entry.world === 'ISOLATED');

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
    ok(!contentScripts.js.includes('pill-skin.js'),
        'no pill skin ships: the comment filter renders the shared shape itself');
    ok(contentScripts.js[contentScripts.js.length - 1] === 'controls.js', 'controls run last');
    ok(contentScripts.js[contentScripts.js.length - 1] === 'controls.js',
        'the controls run last, once both pills can exist');
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
    ok(commentPill.querySelector('.ghdf-pill-label') && commentPill.querySelector('.ghdf-pill-action'),
        'the comment pill is built from the shared parts, not restyled from outside');
    ok(!fs.existsSync(path.join(__dirname, '..', 'extension', 'pill-skin.js')),
        'the skin is gone from the tree');
    ok(!fs.readFileSync(path.join(__dirname, '..', 'extension', 'bootstrap.js'), 'utf8')
        .includes('No diff found'),
        'and so is the bootstrap hook that deleted the notice it could not prevent');
    const chipCount = commentPill.querySelectorAll('.ghdf-pill-action').length;
    await sleep(300);
    ok(commentPill.querySelectorAll('.ghdf-pill-action').length === chipCount,
        'the skin settles instead of re-rendering itself in a loop');

    console.log('\n-- the action flips to Hide once the files are showing --');
    dom.window.__ghTestFileFilter.peek(true);
    await sleep(50);
    ok(chipOf(doc.getElementById('ghtf-pill')).textContent === 'Hide',
        'test pill offers Hide while a peek is in force');
    dom.window.__ghTestFileFilter.enabled = false;
    await sleep(50);
    ok(chipOf(doc.getElementById('ghtf-pill')).textContent === 'Turn on',
        'test pill offers Turn on when the repo preference is off');
    dom.window.__ghTestFileFilter.enabled = true;
    await sleep(50);

    console.log('\n-- both pills dock into one control --');
    await sleep(300);
    const dock = doc.getElementById('ghdf-dock');
    ok(!!dock, 'dock created');
    const panel = dock && dock.querySelector('.ghdf-panel');
    ok(panel && panel.contains(doc.getElementById('ghtf-pill')), 'test pill docked in the panel');
    ok(panel && panel.contains(doc.getElementById('ghccf-pill')), 'comment pill docked in the panel');
    ok(doc.getElementById('ghtf-pill').style.position === 'static',
        'the docked pill stops placing itself');
    const help = dom.window.__ghDiffFilterShortcuts;
    ok(Array.isArray(help) && help.some(entry => entry.key === 't' && /filtered files/.test(entry.label))
        && help.some(entry => entry.key === 'j' && /next visible file/.test(entry.label)),
        'the shortcuts are published for the popover to list');

    console.log('\n-- collapsed, the dock says what it is doing; it expands on hover or focus --');
    const indicator = dock.querySelector('.ghdf-indicator');
    const stateLabel = dock.querySelector('.ghdf-state');
    const tests = dom.window.__ghTestFileFilter.summary();
    const comments = dom.window.__ghCommentFilter.summary();
    const settings = dock.querySelector('.ghdf-settings');
    ok(!!indicator && stateLabel.tagName === 'BUTTON' && settings && settings.tagName === 'BUTTON',
        'the state label and the funnel are buttons, so both can take focus');
    // The controls are exactly these two, in this order. The progress bar sits
    // in the same box but takes no space and no focus, so it is counted apart.
    const controls = [...indicator.children].filter(el => el.tagName === 'BUTTON');
    ok(controls.length === 2 && controls[0] === stateLabel && controls[1] === settings,
        'state label on the left, funnel on the right, no other control');
    // The filters announce every pass and the bar follows, so "quiet" is only
    // true once they have stopped, filled to the end and faded back out.
    await sleep(2400);
    const bar = indicator.querySelector('.ghdf-progress');
    ok(!!bar && bar.getAttribute('role') === 'progressbar'
        && !bar.classList.contains('ghdf-progress-on'),
        `a progress bar is present and quiet on a diff that has fully arrived`
        + ` (${bar ? bar.className : 'missing'})`);
    ok(stateLabel && /^Filters applied$/.test(stateLabel.textContent) && !stateLabel.hidden,
        `the label says the filters are applied once they are (got "${stateLabel && stateLabel.textContent}")`);
    ok(tests.hidden === 1 && comments.hiddenLines > 0, 'and there was something to apply them to');
    ok(!!settings.querySelector('svg') && indicator.classList.contains('ghdf-active'),
        'the funnel marks the filters as in force');
    // The icon's resting colour has to out-specify the button reset in the same
    // sheet, which sets color:inherit; when it did not, grey never showed.
    const iconCss = (doc.getElementById('ghdf-dock-style') || {}).textContent || '';
    ok(/#ghdf-dock \.ghdf-indicator \.ghdf-settings\{[^}]*color:var\(--fgColor-muted/.test(iconCss)
        && /\.ghdf-active \.ghdf-settings\{color:var\(--fgColor-success/.test(iconCss),
        'green while in force, grey at rest, and the grey is specific enough to land');
    ok(/1 file and \d+ comment lines? hidden/.test(stateLabel.getAttribute('aria-label') || ''),
        `the figures are still spoken, now that they are not written (got: ${stateLabel.getAttribute('aria-label')})`);
    // The finished label goes on its own. Its two timers are the ten seconds
    // it stands for and the fade after it, so both have to pass.
    const fadeCss = (doc.getElementById('ghdf-dock-style') || {}).textContent || '';
    ok(/\.ghdf-state\{[^}]*transition:opacity 600ms/.test(fadeCss)
        && /\.ghdf-state\.ghdf-state-gone\{opacity:0/.test(fadeCss),
        'it goes by fading rather than by vanishing');
    const css = (doc.getElementById('ghdf-dock-style') || {}).textContent || '';
    ok(/\.ghdf-panel\{display:none/.test(css) && /#ghdf-dock:hover \.ghdf-panel/.test(css)
        && /#ghdf-dock:focus-within \.ghdf-panel/.test(css),
        'the panel is hidden until the dock is hovered or focused');
    stateLabel.click();
    ok(dock.classList.contains('ghdf-pinned') && stateLabel.getAttribute('aria-expanded') === 'true',
        'a click on the label pins the panel open for readers without a hover');
    stateLabel.click();
    ok(!dock.classList.contains('ghdf-pinned') && stateLabel.getAttribute('aria-expanded') === 'false',
        'and a second click lets it collapse again');

    console.log('\n-- the funnel is the settings menu --');
    ok(!doc.getElementById('ghtf-pill').querySelector('.ghtf-pill-settings'),
        'the docked pill carries no settings icon of its own');
    ok(!doc.getElementById('ghtf-popover'), 'the category popover starts closed');
    settings.click();
    ok(!!doc.getElementById('ghtf-popover') && settings.getAttribute('aria-expanded') === 'true',
        'a click on the funnel opens the category popover and says so');
    ok(doc.getElementById('ghtf-popover').querySelectorAll('.ghtf-popover-row').length >= 10,
        'with every category listed');
    settings.click();
    ok(!doc.getElementById('ghtf-popover') && settings.getAttribute('aria-expanded') === 'false',
        'and a second click closes it');
    settings.click();
    doc.body.click();
    ok(!doc.getElementById('ghtf-popover') && settings.getAttribute('aria-expanded') === 'false',
        'a click elsewhere closes it too, and the funnel follows');
    // A peek shows the hidden files again but leaves both filters on, so the
    // icon stays green and only the figures move.
    dom.window.__ghTestFileFilter.peek(true);
    await sleep(50);
    ok(indicator.classList.contains('ghdf-active')
        && /0 files and \d+ comment lines? hidden/.test(stateLabel.getAttribute('aria-label') || ''),
        `a peek moves the figures and leaves the funnel green (got: ${stateLabel.getAttribute('aria-label')})`);
    dom.window.__ghTestFileFilter.peek(false);
    await sleep(50);

    // With both filters off there is nothing to report and nothing in force.
    dom.window.__ghTestFileFilter.enabled = false;
    dom.window.__ghCommentFilter.enabled = false;
    await sleep(50);
    ok(stateLabel.hidden && !indicator.classList.contains('ghdf-active'),
        `no filter active leaves a grey funnel and no label (got hidden=${stateLabel.hidden},`
        + ` class="${indicator.className}")`);
    dom.window.__ghTestFileFilter.enabled = true;
    dom.window.__ghCommentFilter.enabled = true;
    await sleep(200);
    ok(!stateLabel.hidden && indicator.classList.contains('ghdf-active'),
        'and both come back when the filters do');

    console.log('\n-- no emoji anywhere in the control --');
    const glyphs = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;
    ok(!glyphs.test(dock.textContent), `the dock draws icons, not emoji (text: "${dock.textContent}")`);
    ok(doc.getElementById('ghtf-pill').querySelectorAll('svg').length === 1
        && doc.getElementById('ghccf-pill').querySelectorAll('svg').length === 1,
        'each pill leads with one icon and carries no other');

    console.log('\n-- with both filters and the dock installed, the page goes quiet --');
    await sleep(700);
    let writes = 0;
    const seen = [];
    const spy = new dom.window.MutationObserver(records => {
        writes += records.length;
        for (const record of records.slice(0, 2)) seen.push(record.target.id || record.target.className);
    });
    spy.observe(doc.documentElement, { childList: true, subtree: true });
    await sleep(1200);
    spy.disconnect();
    ok(writes === 0, `no filter rewrites anything once settled (got ${writes}: ${seen.slice(0, 5).join(', ')})`);

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

    console.log('\n-- the settings bridge is declared in the isolated world --');
    ok(!!bridgeScripts, 'an isolated-world entry exists');
    ok(bridgeScripts.js.length === 1 && bridgeScripts.js[0] === 'bridge.js', 'it runs only the bridge');
    ok(bridgeScripts.run_at === 'document_start',
        'it starts before the filters, so their first pull is answered');
    ok(Array.isArray(manifest.permissions) && manifest.permissions.includes('storage'),
        'storage is the one permission this needs');
    ok(manifest.options_ui && manifest.options_ui.page === 'options.html', 'an options page is declared');
    for (const file of ['bridge.js', 'options.html', 'options.js', 'options.css']) {
        ok(fs.existsSync(path.join(__dirname, '..', 'extension', file)), `extension/${file} ships`);
    }

    // GitHub renders a large diff in bursts, and a count that has stopped
    // moving looks exactly like a count that is finished. Have the page claim
    // more files than have arrived, which is that state.
    console.log('\n=== while the diff is still arriving ===');
    const nav = doc.createElement('a');
    nav.href = '/acme/repo/pull/1/files';
    nav.innerHTML = 'Files changed <span>99</span>';
    doc.body.appendChild(nav);
    const loading = dock.querySelector('.ghdf-progress');
    dom.window.__ghTestFileFilter.apply();
    await sleep(60);
    ok(loading.classList.contains('ghdf-progress-on'),
        `the bar shows while files are still on their way (${loading.className})`);
    const filled = parseFloat(loading.firstElementChild.style.width);
    ok(filled > 0 && filled < 100, `and stops short of the end (${loading.firstElementChild.style.width})`);
    const state = dom.window.__ghTestFileFilter.summary();
    ok(state.expected > state.files,
        `the summary says how many the page is still expecting (${state.files} of ${state.expected})`);
    nav.remove();
    dom.window.__ghTestFileFilter.apply();
    await sleep(1500);
    ok(loading.getAttribute('aria-valuenow') === '100',
        `it fills to the end when the diff is complete (got ${loading.getAttribute('aria-valuenow')})`);

    console.log('\n=== the reader is not the diff ===');
    // Everything the filters do announces itself the same way, so the bar has
    // to be told which announcements mean the page is still filling in.
    await sleep(2400);
    dom.window.__ghTestFileFilter.toggleSettings(true);
    await sleep(200);
    ok(!loading.classList.contains('ghdf-progress-on'),
        `opening the menu leaves the bar alone (${loading.className})`);
    dom.window.__ghTestFileFilter.toggleSettings(false);
    await sleep(200);
    ok(!loading.classList.contains('ghdf-progress-on'), 'and so does closing it');

    console.log('\n=== the bar fills as the work goes on ===');
    const host = doc.querySelector('.js-file,[class^="Diff-module__diffTargetable"]') || doc.body;
    host.appendChild(doc.createElement('div'));
    await sleep(450);
    const early = parseFloat(loading.firstElementChild.style.width) || 0;
    host.appendChild(doc.createElement('div'));
    await sleep(550);
    const later = parseFloat(loading.firstElementChild.style.width) || 0;
    ok(loading.classList.contains('ghdf-progress-on'),
        `the page changing does start the bar (${loading.className})`);
    ok(later > early && later < 100, `and it fills without arriving early (${early}% then ${later}%)`);

    console.log('\n=== the label says which of the two is happening ===');
    const label = dock.querySelector('.ghdf-state');
    ok(label.textContent === 'Applying filters\u2026' && !label.hidden,
        `it reads as working while the page is still changing (got "${label.textContent}")`);
    // Still working a beat later: the label has to stay put until the work
    // stops, not time out under a reader who is waiting on it.
    host.appendChild(doc.createElement('div'));
    await sleep(600);
    ok(label.textContent === 'Applying filters\u2026',
        `and it stays for as long as that lasts (got "${label.textContent}")`);
    await sleep(1600);
    ok(label.textContent === 'Filters applied' && !label.hidden
        && !label.classList.contains('ghdf-state-gone'),
        `then says so once the work stops (got "${label.textContent}", `
        + `class "${label.className}")`);
    // Ten seconds of standing, then the fade. Worth the wait in the suite:
    // this is the whole of what the reader was promised would happen.
    await sleep(10000 + 600 + 300);
    ok(label.hidden, `and goes on its own once it has been read (class "${label.className}")`);
    // Gone means gone: a redraw for some unrelated reason must not bring the
    // finished label back on a page where nothing more has happened.
    dom.window.__ghTestFileFilter.toggleSettings(true);
    await sleep(150);
    dom.window.__ghTestFileFilter.toggleSettings(false);
    await sleep(150);
    ok(label.hidden, `and a later redraw does not bring it back (class "${label.className}")`);
    // New work does, though.
    host.appendChild(doc.createElement('div'));
    await sleep(450);
    ok(!label.hidden && label.textContent === 'Applying filters\u2026',
        `while more work brings it back (got "${label.textContent}", hidden=${label.hidden})`);

    console.log('\n' + (failures === 0 ? 'ALL EXTENSION ASSERTIONS PASS' : failures + ' EXTENSION FAILURES'));
    process.exit(failures ? 1 : 0);
})();
