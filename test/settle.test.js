/**
 * Scheduling, against the ways a pass can stop happening.
 *
 * Measured live on a 65-file review: the first pass hid 23 files, GitHub then
 * re-rendered every container, and no pass ran for the rest of the visit. The
 * sibling filter rewrote its pill on every pass, its observer saw the rewrite
 * and scheduled another pass every 343ms, and each rewrite cancelled this
 * filter's debounce before it could fire. So: a settled pass writes nothing, a
 * pass lands under sustained foreign mutation, GitHub's re-renders are undone
 * within the ceiling, and a hidden file's tree row is hidden by the stylesheet
 * rather than by a pass.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { JSDOM } = require('jsdom');
const src = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', 'hide-test-files.src.js'), 'utf8');

let failures = 0;
const ok = (cond, label) => { console.log((cond ? '  PASS  ' : '  FAIL  ') + label); if (!cond) failures++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const anchor = p => 'diff-' + crypto.createHash('sha256').update(p).digest('hex');

const file = p => `<div class="Diff-module__diffTargetable--z9" id="${anchor(p)}">
  <div class="Diff-module__diffHeaderWrapper__x"><span>${p}</span>
    <span class="sr-only">Lines changed: 4 additions &amp; 1 deletions</span></div>
  <div class="DiffLine-module__line--q">+ code()</div></div>`;
// The review view's tree: the row id is the path, the anchor lives only in the
// link inside the row's own label, and a directory row has no link of its own.
const treeFile = p => `<li role="treeitem" id="${p}"><div class="item-container"><div class="item-content">
  <span class="item-text"><a role="presentation" href="#${anchor(p)}">${p.split('/').pop()}</a></span></div></div></li>`;
const treeDir = (name, children) => `<li role="treeitem" id="${name}" aria-expanded="true">
  <div class="item-container"><span class="item-text">${name}</span></div><ul role="group">${children}</ul></li>`;

const SOURCE = 'src/app.ts';
const SPEC = 'src/app.spec.ts';
const E2E = 'test/e2e/flow.test.ts';
const LATE = 'test/e2e/late.test.ts';

const html = `<!doctype html><html><body>
  <nav><a href="/acme/repo/pull/7/changes">Files changed <span>3</span></a></nav>
  <div id="toolbar"><div class="d-flex flex-items-center gap-1">
    <span class="f6 fgColor-success text-bold">+100</span><span class="f6 fgColor-danger text-bold">-20</span>
    <span class="sr-only">Lines changed: 100 additions &amp; 20 deletions</span></div></div>
  <ul role="tree" id="tree">
    ${treeDir('src', treeFile(SOURCE) + treeFile(SPEC))}
    ${treeDir('test/e2e', treeFile(E2E))}
  </ul>
  <div id="files">${[SOURCE, SPEC, E2E].map(file).join('')}</div>
</body></html>`;

const childListRecords = (window, root, ms) => new Promise(resolve => {
    let count = 0;
    const seen = [];
    const observer = new window.MutationObserver(records => {
        count += records.length;
        for (const record of records.slice(0, 3)) {
            seen.push((record.target.id || record.target.className || record.target.tagName) + ':'
                + Array.from(record.addedNodes).concat(Array.from(record.removedNodes))
                    .map(n => n.className || n.nodeName).join('+'));
        }
    });
    observer.observe(root, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); resolve({ count, seen: seen.slice(0, 6) }); }, ms);
});

(async () => {
    const dom = new JSDOM(html, { url: 'https://github.com/acme/repo/pull/7/changes', runScripts: 'outside-only' });
    if (dom.window.document.readyState !== 'complete') {
        await new Promise(r => dom.window.addEventListener('load', r, { once: true }));
    }
    const { window } = dom;
    const doc = window.document;
    window.eval(src);
    const api = window.__ghTestFileFilter;
    const state = p => (doc.getElementById(anchor(p)) || { getAttribute: () => null }).getAttribute('data-ghtf');
    const sheet = () => doc.getElementById('ghtf-style').textContent;
    const treeRule = () => (sheet().split('\n')[1] || '').replace(/\{.*$/, '');

    console.log('\n-- the first pass --');
    ok(state(SPEC) === 'hidden' && state(E2E) === 'hidden' && state(SOURCE) === 'source',
        `paths resolved through the tree and decided (${[SOURCE, SPEC, E2E].map(state).join(', ')})`);
    ok(api.report().resolvedPaths.every(row => / exact /.test(row)), 'every path came from a key, not a guess');
    ok(!!doc.querySelector('.ghtf-visible-stat'), 'header figure rendered');

    console.log('\n-- a settled pass writes nothing --');
    await sleep(700);
    const quiet = await childListRecords(window, doc.documentElement, 1200);
    ok(quiet.count === 0, `no DOM writes over 1.2s once settled (got ${quiet.count}: ${quiet.seen.join(' | ')})`);

    console.log('\n-- the tree row is hidden by the stylesheet, not by the pass --');
    const rule = treeRule();
    ok(/:has\(/.test(rule) && rule.includes(anchor(SPEC)) && rule.includes(anchor(E2E)),
        'the sheet carries a :has() rule per hidden file keyed on its link');
    ok(!rule.includes(anchor(SOURCE)), 'and none for the source file');
    ok(sheet().split('\n').length === 2 && !sheet().split('\n')[0].includes(':has('),
        'in its own rule, so a browser without :has() still hides the diff pane');
    const oldTree = doc.getElementById('tree');
    const freshTree = oldTree.cloneNode(false);
    freshTree.innerHTML = treeDir('src', treeFile(SOURCE) + treeFile(SPEC)) + treeDir('test/e2e', treeFile(E2E));
    oldTree.replaceWith(freshTree);
    const row = p => doc.getElementById(p);
    ok(row(SPEC).matches(rule) && row(E2E).matches(rule),
        'a re-rendered row for a hidden file matches the rule with no pass having run');
    ok(!row(SOURCE).matches(rule), 'the source file\'s row does not');
    ok(!row('src').matches(rule) && !row('test/e2e').matches(rule),
        'nor do the directory rows above them');

    console.log('\n-- GitHub re-renders every container: the next pass restores the marks --');
    await sleep(700);
    const files = doc.getElementById('files');
    for (const stub of files.querySelectorAll('.ghtf-stub')) stub.remove();
    for (const container of Array.from(files.children)) {
        const fresh = doc.createElement('div');
        fresh.className = container.className;
        fresh.id = container.id;
        fresh.innerHTML = container.innerHTML;
        container.replaceWith(fresh);
    }
    ok(doc.querySelectorAll('[data-ghtf]').length === 0 && doc.querySelectorAll('.ghtf-stub').length === 0,
        'the replacement carries neither marks nor stubs');
    ok(doc.getElementById(anchor(SPEC)).matches(sheet().split('\n')[0].replace(/\{.*$/, '')),
        'yet the pane is hidden by the sheet already');
    await sleep(1500);
    ok(doc.querySelectorAll('[data-ghtf]').length === 3, 'every container is marked again within the ceiling');
    ok(doc.querySelectorAll('.ghtf-stub').length === 2, 'and the two stubs are back');

    console.log('\n-- a pass lands while mutations keep arriving faster than the debounce --');
    const noise = doc.createElement('div');
    noise.id = 'noise';
    doc.body.appendChild(noise);
    const storm = setInterval(() => {
        const span = doc.createElement('span');
        noise.appendChild(span);
        span.remove();
    }, 100);
    await sleep(200);
    files.insertAdjacentHTML('beforeend', file(LATE));
    doc.getElementById('test/e2e').querySelector('[role="group"]').insertAdjacentHTML('beforeend', treeFile(LATE));
    doc.querySelector('nav a span').textContent = '4';
    await sleep(1700);
    ok(state(LATE) === 'hidden', `the late test file was hidden under the storm (state: ${state(LATE)})`);
    clearInterval(storm);
    noise.remove();

    console.log('\n-- GitHub re-renders the header row: the figure comes back --');
    await sleep(700);
    const oldHost = doc.querySelector('#toolbar > div');
    const freshHost = oldHost.cloneNode(false);
    freshHost.innerHTML = '<span class="f6 fgColor-success text-bold">+100</span>'
        + '<span class="f6 fgColor-danger text-bold">-20</span>'
        + '<span class="sr-only">Lines changed: 100 additions &amp; 20 deletions</span>';
    oldHost.replaceWith(freshHost);
    ok(!doc.querySelector('.ghtf-visible-stat'), 'the figure went with the old row');
    await sleep(1500);
    const badge = doc.querySelector('.ghtf-visible-stat');
    ok(!!badge && freshHost.contains(badge), 'and is rendered into the new one');
    ok(!!badge && /after filter/.test(badge.textContent) && /\+88/.test(badge.textContent),
        `with the totals net of the three hidden files (got: ${badge && badge.textContent})`);
    const added = badge && badge.querySelector('[class*="fgColor-success"]');
    const deleted = badge && badge.querySelector('[class*="fgColor-danger"]');
    ok(added && added.className === 'f6 fgColor-success text-bold'
        && deleted && deleted.className === 'f6 fgColor-danger text-bold',
        `the figures wear exactly the classes GitHub's own figures wear (got: ${added && added.className})`);
    ok(deleted && deleted.textContent === '-17' && !/\u2212/.test(badge.textContent),
        `and the minus sign GitHub uses here (got: ${deleted && deleted.textContent})`);
    ok(!/font|color:/.test(added.getAttribute('style') || ''), 'with no type or colour of their own');

    console.log('\n-- what the pill says is available as numbers --');
    const summary = api.summary();
    ok(summary && summary.hidden === 3 && summary.files === 4 && summary.hiding === true,
        `summary() reports hidden/files/hiding (got ${JSON.stringify(summary)})`);
    let announced = 0;
    doc.addEventListener('ghdf:state', () => announced++);
    api.peek(true);
    ok(announced === 1 && api.summary().hidden === 0 && api.summary().paused === true,
        'a peek announces itself once and the summary follows');
    api.peek(false);

    console.log('\n-- nothing this script draws is an emoji --');
    const pill = doc.getElementById('ghtf-pill');
    const glyphs = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;
    ok(!glyphs.test(pill.textContent) && pill.querySelectorAll('svg').length >= 1,
        `the pill draws icons (text: "${pill.textContent}")`);
    ok(window.getComputedStyle(pill).display === 'flex',
        `a shown pill keeps its flex layout, so the chip is centred beside the label (got ${window.getComputedStyle(pill).display})`);
    ok(!glyphs.test(doc.querySelector('.ghtf-stub').textContent) && !!doc.querySelector('.ghtf-stub svg'),
        'so does a stub');

    console.log('\n' + (failures === 0 ? 'ALL SETTLE ASSERTIONS PASS' : failures + ' SETTLE FAILURES'));
    process.exit(failures ? 1 : 0);
})();
