/**
 * The review view renders a file's container before the header that names it,
 * so a pass can run against markup carrying no readable path. Every container
 * here is header-less for the whole run: the only path source is the file tree,
 * which GitHub fills in with the page navigation rather than with the diff
 * bodies. A file that stays unclassified would be a file silently shown.
 *
 * Shape mirrors a real 65-file pull request: a deep spec directory, two
 * co-located component specs, a seeded-data directory, and ordinary source.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { JSDOM } = require('jsdom');
const src = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', 'hide-test-files.src.js'), 'utf8');

let failures = 0;
const ok = (cond, label) => { console.log((cond ? '  PASS  ' : '  FAIL  ') + label); if (!cond) failures++; };

// GitHub keys a diff container and its tree row by `diff-` + sha256(path);
// verified against real markup, so the fixture uses the real scheme.
const anchor = p => 'diff-' + crypto.createHash('sha256').update(p).digest('hex');

const NOISE = [
    ...Array.from({ length: 17 }, (_, i) => `test/api/spec/batch-7/case${i + 1}.js`),
    'client/app/components/panel/panelHeader.component.spec.ts',
    'client/app/components/panel/panelBody.component.spec.ts',
    ...Array.from({ length: 4 }, (_, i) => `database/seed/prompts/pack${i + 1}.md`)
];
const SOURCE = [
    ...Array.from({ length: 21 }, (_, i) => `server/lib/service${i + 1}.js`),
    ...Array.from({ length: 21 }, (_, i) => `client/app/view${i + 1}.ts`)
];
const ALL = NOISE.concat(SOURCE).sort();
const statOf = p => (NOISE.includes(p) ? { add: 10, del: 5 } : { add: 20, del: 7 });
const TOTAL_ADD = ALL.reduce((n, p) => n + statOf(p).add, 0);
const TOTAL_DEL = ALL.reduce((n, p) => n + statOf(p).del, 0);
const VISIBLE_ADD = SOURCE.reduce((n, p) => n + statOf(p).add, 0);
const VISIBLE_DEL = SOURCE.reduce((n, p) => n + statOf(p).del, 0);

/** A container with a diff body and no header of any kind. */
const container = p => `<div class="Diff-module__diffTargetable--z9" id="${anchor(p)}">
  <div class="DiffLine-module__line--q">+ code()</div>
</div>`;

const treeRow = (p, labelled) => {
    const stat = statOf(p);
    const label = labelled ? `<span>${p}</span>` : '';
    return `<li role="treeitem" data-tree-entry-type="file" id="file-tree-item-${anchor(p)}">
      ${label}<span>+${stat.add}</span><span>−${stat.del}</span></li>`;
};

const page = labelledTree => `<!doctype html><html><body>
  <div id="toolbar"><span>+${TOTAL_ADD}</span><span>−${TOTAL_DEL}</span></div>
  <ul role="tree">${ALL.map(p => treeRow(p, labelledTree)).join('')}</ul>
  <div id="files">${ALL.map(container).join('')}</div>
</body></html>`;

async function load(html) {
    const dom = new JSDOM(html, { url: 'https://github.com/acme/repo/pull/14297/changes', runScripts: 'outside-only' });
    if (dom.window.document.readyState !== 'complete') {
        await new Promise(r => dom.window.addEventListener('load', r, { once: true }));
    }
    dom.window.eval(src);
    return dom;
}

const stateCount = (doc, state) => doc.querySelectorAll(`[data-ghtf="${state}"]`).length;

(async () => {
    console.log('=== a header-less diff classifies from the tree alone ===');
    const dom = await load(page(true));
    const doc = dom.window.document;
    const api = dom.window.__ghTestFileFilter;

    ok(doc.querySelectorAll('[class^="Diff-module__diffTargetable"]').length === 65,
        '65 containers in the fixture');
    ok(!/case3\.js/.test(ALL.map(container).join('')),
        'no container carries its path as text (nothing to scrape)');

    ok(stateCount(doc, 'hidden') === 23,
        `23 files hidden with no header to read (got ${stateCount(doc, 'hidden')})`);
    ok(stateCount(doc, 'pending') === 0,
        `no file left unresolved (got ${stateCount(doc, 'pending')})`);
    ok(stateCount(doc, 'source') === 42, `42 files kept (got ${stateCount(doc, 'source')})`);

    const report = api.report();
    ok(report.joinedFromTree === 65, `every container joined to a tree row (got ${report.joinedFromTree})`);
    ok(report.treeMatching === 23, `tree independently reports 23 matches (got ${report.treeMatching})`);
    ok(api.debug().every(row => row.from === 'exact'), 'every path came from a key, not a guess');

    console.log('\n-- counts also come from the tree row --');
    const stub = doc.querySelector('.ghtf-stub');
    ok(/\+10\s*−\s*5/.test(stub.textContent.replace(/ /g, ' ')),
        `a stub shows its signed pair (got: ${stub.textContent.trim()})`);
    const badge = doc.querySelector('.ghtf-visible-stat');
    ok(!!badge && badge.textContent.includes(VISIBLE_ADD.toLocaleString())
        && badge.textContent.includes(VISIBLE_DEL.toLocaleString()),
        `visible totals read +${VISIBLE_ADD} −${VISIBLE_DEL} (got: ${badge && badge.textContent.trim()})`);

    console.log('\n-- the pill names the noise, not just tests --');
    const pill = doc.getElementById('ghtf-pill');
    ok(/23 files hidden/.test(pill.textContent),
        `pill counts every hidden file (got: ${pill.textContent.trim()})`);
    ok(!/unread/.test(pill.textContent), 'no unread warning when everything resolved');

    console.log('\n=== an unreadable pass recovers without a further mutation ===');
    // Tree rows arrive without labels, so nothing on the page yields a path.
    const late = await load(page(false));
    const lateDoc = late.window.document;
    ok(stateCount(lateDoc, 'pending') === 65,
        `every file marked pending, not skipped (got ${stateCount(lateDoc, 'pending')})`);
    const latePill = lateDoc.getElementById('ghtf-pill');
    ok(/65 unread/.test(latePill.textContent),
        `pill surfaces all 65 as unread (got: ${latePill.textContent.trim()})`);
    ok(/report\(\)/.test(latePill.title), 'pill points at report() for the unreadable case');

    // An attribute write is invisible to a childList observer, so only the
    // filter's own retry can notice the tree became readable.
    for (const row of lateDoc.querySelectorAll('[role="treeitem"]')) {
        const sha = row.id.replace('file-tree-item-', '');
        const match = ALL.find(p => anchor(p) === sha);
        if (match) row.setAttribute('data-path', match);
    }
    await new Promise(r => setTimeout(r, 900));

    ok(stateCount(lateDoc, 'hidden') === 23,
        `the retry classified all 23 once the tree became readable (got ${stateCount(lateDoc, 'hidden')})`);
    ok(stateCount(lateDoc, 'pending') === 0,
        `nothing left pending (got ${stateCount(lateDoc, 'pending')})`);

    console.log('\n' + (failures === 0 ? 'ALL RENDER-RACE ASSERTIONS PASS' : failures + ' RENDER-RACE FAILURES'));
    process.exit(failures ? 1 : 0);
})();
