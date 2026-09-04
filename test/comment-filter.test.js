/**
 * The comment filter, written from source so it can be read and tested. It
 * hides a changed line only when the language is known: guessing that `#`
 * begins a comment in a file whose syntax cannot be named would hide real code.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const src = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', 'hide-comment-diffs.src.js'), 'utf8');

let failures = 0;
const ok = (cond, label) => { console.log((cond ? '  PASS  ' : '  FAIL  ') + label); if (!cond) failures++; };

/** Classic table markup, where a changed line is one row. */
const rows = lines => lines.map(([sign, code], i) =>
    `<tr data-line="${i}"><td class="blob-num">${i}</td>` +
    `<td class="blob-code blob-code-${sign === '+' ? 'addition' : 'deletion'}">${sign}${code}</td></tr>`).join('');

const file = (p, lines, extra) => `<div class="js-file" data-path="${p}">
  <div class="file-info">${p}</div>
  <table>${rows(lines)}${extra || ''}</table></div>`;

const JS = [
    ['+', '// a note'],
    ['+', 'doWork();'],
    ['+', '   '],
    ['+', '/* opening'],
    ['+', ' * middle'],
    ['+', ' */'],
    ['+', '*/ trailing();'],
    ['-', '// removed note'],
    ['+', 'const x = 1; // trailing comment']
];
const PY = [['+', '# note'], ['+', 'value = 2'], ['+', '"""'], ['+', 'docstring'], ['+', '"""']];
const SQL = [['+', '-- note'], ['+', 'select 1;']];
const HTML = [['+', '<!-- note -->'], ['+', '<p>text</p>']];
const UNKNOWN = [['+', '# looks like a comment'], ['+', ''], ['+', 'REAL CODE']];

/**
 * The review view: no path attribute, the header names the file, and a changed
 * line is `code.diff-text.addition|deletion` inside `td.diff-text-cell`, with
 * the sign in a marker span of its own. A split row carries both sides.
 */
const reviewCell = (kind, code) => `<td class="diff-text-cell focusable-grid-cell" role="gridcell">`
    + `<code class="diff-text syntax-highlighted-line${kind ? ' ' + kind : ''}">`
    + (kind ? `<span class="diff-text-marker">${kind === 'addition' ? '+' : '-'}</span>` : '')
    + `<div class="diff-text-inner">${code}</div></code></td>`;
const reviewRow = (i, cells) => `<tr class="diff-line-row" data-line="${i}">`
    + `<td class="focusable-grid-cell new-diff-line-number">${i}</td>`
    + `<td class="focusable-grid-cell new-diff-line-number">${i}</td>${cells}</tr>`;
const REVIEW_PATH = 'client/app/review.ts';
const REVIEW_HTML = `<div class="Diff-module__diffTargetable--z9" id="diff-${'e'.repeat(64)}">
  <div class="Diff-module__diffHeaderWrapper__x"><span>${REVIEW_PATH}</span>
    <span class="sr-only">Lines changed: 6 additions &amp; 2 deletions</span></div>
  <table><tbody>
    <tr class="diff-line-row" data-line="0"><td colspan="4" class="diff-hunk-cell">@@ -1,4 +1,6 @@</td></tr>
    ${reviewRow(1, reviewCell('addition', '<span class="pl-c">// a note</span>'))}
    ${reviewRow(2, reviewCell('addition', 'doWork();'))}
    ${reviewRow(3, reviewCell('deletion', '// removed'))}
    ${reviewRow(4, reviewCell('', 'context();'))}
    ${reviewRow(5, reviewCell('deletion', '// was a note') + reviewCell('addition', 'real();'))}
    ${reviewRow(6, reviewCell('deletion', '// old note') + reviewCell('addition', '// new note'))}
    ${reviewRow(7, reviewCell('addition', '/* opens'))}
    <tr class="diff-line-row" data-line="8"><td colspan="4" class="diff-hunk-cell">@@ -40,2 +42,2 @@</td></tr>
    ${reviewRow(9, reviewCell('addition', 'afterHunk();'))}
  </tbody></table></div>`;

const html = `<!doctype html><html><body><div id="files">
  ${file('src/app.js', JS)}
  ${file('server/run.py', PY)}
  ${file('db/query.sql', SQL)}
  ${file('web/index.html', HTML)}
  ${file('weird/thing.xyz', UNKNOWN)}
  ${file('src/reviewed.js', [['+', '// discussed']],
      '<tr class="ghost"><td><div class="review-comment">why?</div></td></tr>')}
  ${REVIEW_HTML}
</div></body></html>`;

const codeCell = (doc, p, index) =>
    doc.querySelector(`[data-path="${p}"] tr[data-line="${index}"]`);
const isHidden = (doc, p, index) => codeCell(doc, p, index).classList.contains('ghccf-hidden');

(async () => {
    const dom = new JSDOM(html, { url: 'https://github.com/acme/repo/pull/1/files', runScripts: 'outside-only' });
    if (dom.window.document.readyState !== 'complete') {
        await new Promise(r => dom.window.addEventListener('load', r, { once: true }));
    }
    const { window } = dom;
    const doc = window.document;
    window.eval(src);
    const api = window.__ghCommentFilter;

    console.log('=== a language it knows ===');
    ok(isHidden(doc, 'src/app.js', 0), 'a // line is hidden');
    ok(!isHidden(doc, 'src/app.js', 1), 'code is kept');
    ok(isHidden(doc, 'src/app.js', 2), 'a whitespace-only line is hidden');
    ok(isHidden(doc, 'src/app.js', 3), 'a block comment opening is hidden');
    ok(isHidden(doc, 'src/app.js', 4), 'its middle is hidden, tracked across lines');
    ok(isHidden(doc, 'src/app.js', 5), 'its close is hidden');
    ok(!isHidden(doc, 'src/app.js', 6), 'code after the close is NOT hidden');
    ok(isHidden(doc, 'src/app.js', 7), 'a removed comment line is hidden too');
    ok(!isHidden(doc, 'src/app.js', 8), 'code with a trailing comment is kept');

    console.log('\n=== other syntaxes ===');
    ok(isHidden(doc, 'server/run.py', 0) && !isHidden(doc, 'server/run.py', 1), 'python # and code');
    ok(isHidden(doc, 'server/run.py', 2) && isHidden(doc, 'server/run.py', 3)
        && isHidden(doc, 'server/run.py', 4), 'a docstring is a block comment');
    ok(isHidden(doc, 'db/query.sql', 0) && !isHidden(doc, 'db/query.sql', 1), 'sql -- and code');
    ok(isHidden(doc, 'web/index.html', 0) && !isHidden(doc, 'web/index.html', 1), 'html comment and markup');

    console.log('\n=== a syntax it cannot name ===');
    ok(!isHidden(doc, 'weird/thing.xyz', 0),
        'a #-looking line in an unknown language is kept, because it may be code');
    ok(isHidden(doc, 'weird/thing.xyz', 1), 'but a blank line is still noise');
    ok(!isHidden(doc, 'weird/thing.xyz', 2), 'and code is kept');

    console.log('\n=== feedback is never hidden ===');
    ok(!isHidden(doc, 'src/reviewed.js', 0), 'a line carrying a review thread stays visible');

    console.log('\n=== what it reports ===');
    const tally = doc.querySelector('[data-path="src/app.js"] .ghccf-tally');
    ok(!!tally && /6 comment hidden/.test(tally.textContent),
        `the per-file tally names the count (got: ${tally && tally.textContent})`);
    const pill = doc.getElementById('ghccf-pill');
    ok(/comment lines hidden in \d+ files?/.test(pill.textContent),
        `the pill reports lines and files (got: ${pill.textContent})`);
    ok(!!pill.querySelector('.ghdf-pill-label') && !!pill.querySelector('.ghdf-pill-action'),
        'it is built from the shared pill parts, so it matches without being restyled');

    console.log('\n=== showing and hiding ===');
    api.peek(true);
    ok(doc.querySelectorAll('.ghccf-hidden').length === 0, 'a peek shows every line');
    ok(api.enabled === true, 'and leaves the stored preference alone');
    api.peek(false);
    ok(doc.querySelectorAll('.ghccf-hidden').length > 0, 'ending the peek hides them again');
    api.enabled = false;
    ok(doc.querySelectorAll('.ghccf-hidden').length === 0 && api.enabled === false,
        'switching it off keeps every line visible');
    api.enabled = true;

    console.log('\n=== it survives GitHub replacing a row ===');
    const before = codeCell(doc, 'src/app.js', 0);
    const fresh = doc.createElement('tr');
    fresh.setAttribute('data-line', '0');
    fresh.innerHTML = '<td class="blob-num">0</td><td class="blob-code blob-code-addition">+// a note</td>';
    before.replaceWith(fresh);
    api.apply();
    ok(isHidden(doc, 'src/app.js', 0), 'the replacement is hidden again');

    console.log('\n=== the review view\'s rows ===');
    const reviewRowEl = i => doc.querySelector(`#diff-${'e'.repeat(64)} tr[data-line="${i}"]`);
    const reviewHidden = i => reviewRowEl(i).classList.contains('ghccf-hidden');
    ok(reviewHidden(1), 'an added // line is hidden, read past the marker span');
    ok(!reviewHidden(2), 'added code is kept');
    ok(reviewHidden(3), 'a deleted comment line is hidden');
    ok(!reviewHidden(4), 'a context line is left alone');
    ok(!reviewHidden(5), 'a split row whose new side is code stays, so no code disappears with a comment');
    ok(reviewHidden(6), 'a split row that is comment on both sides goes');
    ok(reviewHidden(7), 'an unterminated block opener is hidden');
    ok(!reviewHidden(9), 'and the hunk header in its own row ends that block, so the code after it is kept');
    const reviewTally = doc.querySelector(`#diff-${'e'.repeat(64)} .ghccf-tally`);
    ok(!!reviewTally && /4 comment hidden/.test(reviewTally.textContent),
        `the tally sits in the review header (got: ${reviewTally && reviewTally.textContent})`);
    const hiddenRows = doc.querySelectorAll('.ghccf-hidden').length;
    ok(api.summary().hiddenLines === hiddenRows && hiddenRows > 13 && api.summary().touchedFiles === 6,
        `summary() counts every file's hidden rows (got ${JSON.stringify(api.summary())}, ${hiddenRows} rows)`);

    console.log('\n=== a settled pass writes nothing ===');
    await new Promise(r => setTimeout(r, 700));
    let writes = 0;
    const seen = [];
    const spy = new window.MutationObserver(records => {
        writes += records.length;
        for (const record of records.slice(0, 2)) seen.push(record.target.id || record.target.className);
    });
    spy.observe(doc.documentElement, { childList: true, subtree: true });
    await new Promise(r => setTimeout(r, 1200));
    spy.disconnect();
    ok(writes === 0, `no DOM writes over 1.2s once settled (got ${writes}: ${seen.slice(0, 5).join(', ')})`);

    console.log('\n=== what it reports, as numbers ===');
    const summary = api.summary();
    ok(summary && summary.hiddenLines > 0 && summary.touchedFiles > 0 && summary.hiding === true,
        `summary() carries lines, files and whether hiding is in force (got ${JSON.stringify(summary)})`);
    let announced = 0;
    doc.addEventListener('ghdf:state', () => announced++);
    api.peek(true);
    ok(announced === 1 && api.summary().hiddenLines === 0 && api.summary().paused === true,
        'a peek announces itself once and the summary follows');
    api.peek(false);
    api.enabled = false;
    announced = 0;
    pill.click();
    ok(api.enabled === true && api.paused === false && announced === 1,
        'clicking the pill while it is off turns it on rather than toggling a peek nobody can see');
    ok(!/[\u{1F000}-\u{1FAFF}]/u.test(pill.textContent) && pill.querySelectorAll('svg').length === 1,
        `the pill leads with an icon, not an emoji (text: "${pill.textContent}")`);
    ok(window.getComputedStyle(pill).display === 'flex',
        `a shown pill keeps its flex layout (got ${window.getComputedStyle(pill).display})`);

    console.log('\n' + (failures === 0 ? 'ALL COMMENT-FILTER ASSERTIONS PASS' : failures + ' COMMENT-FILTER FAILURES'));
    process.exit(failures ? 1 : 0);
})();
