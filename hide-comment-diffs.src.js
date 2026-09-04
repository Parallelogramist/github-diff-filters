/**
 * Hides comment-only and whitespace-only lines from a GitHub pull request diff.
 *
 * A line is only hidden when its language is known. Guessing that `#` starts a
 * comment in a file whose syntax we cannot name would hide real code, so an
 * unrecognised extension yields whitespace-only lines and nothing else.
 */
(() => {
    'use strict';

    if (window.__ghCommentFilter) return;

    /**
     * Which build is in the page. A filter runs in the page's own world, where
     * there is no extension API to ask, so it carries the number and `build.sh`
     * checks it against the manifest.
     */
    const VERSION = '1.20.1';

    const ENABLED_KEY = 'gh-hide-comment-diffs:enabled';
    const PAUSED_KEY = 'gh-hide-comment-diffs:paused';
    const STYLE_ID = 'ghccf-style';
    const HIDDEN_CLASS = 'ghccf-hidden';
    const TALLY_CLASS = 'ghccf-tally';
    const PILL_ID = 'ghccf-pill';
    const DOCK_ID = 'ghdf-dock';
    const TEST_FILTER_PILL_ID = 'ghtf-pill';
    // A pass now reads the file that changed rather than the diff, so it can
    // run promptly instead of sparingly: hiding lands about as fast as the
    // reader can see the file arrive, and a burst costs less in total than the
    // few expensive passes it used to get.
    const DEBOUNCE_MS = 120;
    const MAX_WAIT_MS = 400;
    /** On everything this script and its siblings put in the page; the observer skips it. */
    const UI_CLASS = 'ghdf-ui';
    /** Fired after the pill changes, for whatever docks it. */
    const STATE_EVENT = 'ghdf:state';

    const FILE_SELECTOR = ['.js-file', '[class^="Diff-module__diffTargetable"]'].join(',');
    const PATH_ATTRS = ['data-path', 'data-file-path', 'data-tagsearch-path'];
    // The classic view marks the cell; the review view marks the `code` inside
    // it and draws the sign in a marker span of its own.
    const ADDITION_SELECTOR = ['.blob-code-addition', 'td[data-code-marker="+"]', '.diff-text.addition'].join(',');
    const DELETION_SELECTOR = ['.blob-code-deletion', 'td[data-code-marker="-"]', '.diff-text.deletion'].join(',');
    const LINE_TERMS = [
        '.blob-code-addition', 'td[data-code-marker="+"]', '.diff-text.addition',
        '.blob-code-deletion', 'td[data-code-marker="-"]', '.diff-text.deletion'
    ];
    const LINE_SELECTOR = LINE_TERMS.join(',');
    const CODE_SELECTOR = '.diff-text-inner';
    const HUNK_SELECTOR = '.blob-code-hunk,[class*="Hunk"],[class*="hunk"]';
    /** Kept apart rather than joined; see `feedbackRows`. */
    const REVIEW_COMMENT_SELECTORS = [
        '.review-comment', '.js-comment-container', '.js-inline-comments-container .js-comment',
        '[class*="ReviewThread"]', '[data-testid*="comment-thread"]', '[data-testid*="review-thread"]'
    ];
    const HEADER_SELECTOR = ['.file-info', '.file-header',
        '[class*="DiffHeader"]', '[class*="diffHeader"]',
        '[class*="FileHeader"]', '[class*="fileHeader"]'].join(',');
    const SIGN = /^[+\-−]\s?/;

    const SLASH = { line: [/^\/\//], block: [['/*', '*/']], cont: /^\*(?!\/)/ };
    const HASH = { line: [/^#/] };
    const DASH = { line: [/^--/] };
    const MARKUP = { block: [['<!--', '-->']] };

    /**
     * Comment syntax by path. Only what can be named: everything else falls
     * through to whitespace-only, because hiding a line on a guess hides code.
     */
    const SYNTAX = [
        [/\.(js|jsx|mjs|cjs|ts|tsx|mts|cts|java|kt|kts|scala|groovy|c|h|cc|cpp|cxx|hpp|cs|go|swift|rs|php|dart|m|mm|less|scss|sass|proto)$/i, SLASH],
        [/\.css$/i, { block: [['/*', '*/']], cont: /^\*(?!\/)/ }],
        [/\.(py|pyi)$/i, { line: [/^#/], block: [['"""', '"""'], ["'''", "'''"]] }],
        [/\.(rb|sh|bash|zsh|fish|ps1|yml|yaml|toml|ini|cfg|conf|properties|pl|pm|r|tf|tfvars|gemspec|rake)$/i, HASH],
        [/(^|\/)(Dockerfile|Makefile|Gemfile|Rakefile|\.gitignore|\.dockerignore|\.env[^/]*)$/i, HASH],
        [/\.(sql|lua|hs|elm|adb|ads)$/i, DASH],
        [/\.(html|htm|xml|xsl|svg|vue|svelte|md|markdown|mdx)$/i, MARKUP],
        [/\.(clj|cljs|cljc|edn|el|lisp|scm|rkt|asm|s)$/i, { line: [/^;/] }],
        [/\.(tex|sty|erl|hrl)$/i, { line: [/^%/] }],
        [/\.(bat|cmd)$/i, { line: [/^(rem\b|::)/i] }],
        [/\.(vim|vimrc)$/i, { line: [/^"/] }]
    ];

    function syntaxFor(path) {
        for (const [pattern, syntax] of SYNTAX) {
            if (pattern.test(path)) return syntax;
        }
        return null;
    }

    function readEnabled() {
        try {
            return localStorage.getItem(ENABLED_KEY) !== 'false';
        } catch (error) {
            return true;
        }
    }

    function readPaused() {
        try {
            return sessionStorage.getItem(PAUSED_KEY) === 'true';
        } catch (error) {
            return false;
        }
    }

    let enabled = readEnabled();
    let paused = readPaused();
    let pill;
    let pillKey = '';
    let lastSummary = null;
    /**
     * What the observer has seen since the last pass, which is the only thing
     * that can make one necessary. A pass used to re-derive this by counting
     * the diff's changed rows and its own hidden ones: on a 129-file review,
     * 4ms a pass to establish that 1,997 rows were where it left them.
     *
     * `pendingPage` covers a change outside every file, which may have added
     * one; `pendingFiles` names the files whose own rows changed.
     */
    let pendingPage = true;
    let pendingFiles = new Set();
    /** Whether the observer reported anything since the last pass; see the sibling filter. */
    let sawMutations = false;
    let knownContainers = null;
    let scheduled;
    let waitingSince = 0;

    function hiding() {
        return enabled && !paused;
    }

    // ------------------------------------------------------------ the lines

    function fileContainers() {
        // Outermost matches only. The results arrive in document order, so a
        // nested match is always inside the last one accepted: that makes the
        // test a pointer walk instead of a selector matched against every
        // ancestor of every candidate.
        const found = [];
        let outermost = null;
        for (const el of document.querySelectorAll(FILE_SELECTOR)) {
            if (outermost && outermost.contains(el)) continue;
            found.push(el);
            outermost = el;
        }
        return found;
    }

    /** A container's path never changes once its header has rendered, so it is read once. */
    function filePath(container) {
        if (!container.__ghccfPath) container.__ghccfPath = readPath(container);
        return container.__ghccfPath;
    }

    function readPath(container) {
        for (const attr of PATH_ATTRS) {
            const own = container.getAttribute(attr);
            if (own) return own.split('→').pop().trim();
            const nested = container.querySelector(`[${attr}]`);
            if (nested && nested.getAttribute(attr)) return nested.getAttribute(attr).split('→').pop().trim();
        }
        const header = container.querySelector(HEADER_SELECTOR) || container.firstElementChild;
        if (!header) return '';
        const walker = document.createTreeWalker(header, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const text = node.nodeValue.trim();
            if (text.length > 1 && !/\s/.test(text) && (text.includes('/') || /\.[A-Za-z0-9]+$/.test(text))) {
                return text;
            }
        }
        return '';
    }

    /**
     * The rows of a file that add or remove a line, in document order, each
     * with its changed cells: a split view puts the old and the new side of a
     * line in one row.
     */
    /**
     * The changed-line selector with the terms this page cannot use dropped.
     * The two diff views name a changed line differently and a page is one
     * view or the other, so half the terms are dead weight — and a selector
     * list costs far more than the terms in it separately: 3.5ms down to 1.2ms
     * over a 129-file review. One query still, because `judgeFile` carries a
     * block comment's run from one row to the next and only a single query
     * returns them in document order.
     */
    let lineSelector = LINE_SELECTOR;

    function narrowLineSelector() {
        if (lineSelector !== LINE_SELECTOR) return;
        // Before any line has rendered every term misses, which says nothing
        // about the view; the whole selector stands until one proves it.
        const live = LINE_TERMS.filter(term => document.querySelector(term));
        if (live.length > 0 && live.length < LINE_TERMS.length) lineSelector = live.join(',');
    }

    function changedRows(container) {
        const rows = new Map();
        let cells = container.querySelectorAll(lineSelector);
        // Nothing found is either a file with no changed lines or markup the
        // narrowed selector does not name, and only the whole selector tells
        // those apart. Finding lines it missed means the narrowing was wrong,
        // so it is undone rather than paid for once per file.
        if (cells.length === 0 && lineSelector !== LINE_SELECTOR) {
            cells = container.querySelectorAll(LINE_SELECTOR);
            if (cells.length > 0) lineSelector = LINE_SELECTOR;
        }
        for (const el of cells) {
            const row = el.closest('tr') || el;
            if (!rows.has(row)) rows.set(row, []);
            rows.get(row).push(el);
        }
        return rows;
    }

    /** The line's code without its sign, read past the marker where the markup separates them. */
    function codeOf(el) {
        const inner = el.querySelector(CODE_SELECTOR);
        const text = ((inner || el).textContent || '').replace(/ /g, ' ').trim();
        return inner ? text : text.replace(SIGN, '');
    }

    /** A hunk header resets the block-comment run. */
    function followsHunk(row, hunks) {
        return !!row.previousElementSibling && hunks.has(row.previousElementSibling);
    }

    /**
     * Whether a changed line carries nothing to review.
     *
     * `state.inBlock` runs across a file's lines in order, so the body of a
     * block comment is recognised too. A diff shows fragments rather than whole
     * files, so the run resets at every hunk boundary it can see: a stale flag
     * would hide code that follows an unterminated fragment.
     */
    function isNoise(code, syntax, state) {
        if (code === '') return true;
        if (!syntax) return false;
        if (state.inBlock) {
            for (const [, close] of syntax.block || []) {
                const at = code.indexOf(close);
                if (at === -1) continue;
                state.inBlock = false;
                // Anything after the close is real code.
                return code.slice(at + close.length).trim() === '';
            }
            return true;
        }
        for (const pattern of syntax.line || []) {
            if (pattern.test(code)) return true;
        }
        if (syntax.cont && syntax.cont.test(code)) return true;
        for (const [open, close] of syntax.block || []) {
            if (code.indexOf(open) !== 0) continue;
            const rest = code.slice(open.length);
            const at = rest.indexOf(close);
            if (at === -1) {
                state.inBlock = true;
                return true;
            }
            return rest.slice(at + close.length).trim() === '';
        }
        return false;
    }

    // ---------------------------------------------------------------- apply

    function styleElement() {
        let el = document.getElementById(STYLE_ID);
        if (!el) {
            el = document.createElement('style');
            el.id = STYLE_ID;
            el.className = UI_CLASS;
            // One rule for every hidden line: a diff has thousands of them, and
            // a selector each would be a stylesheet the size of the diff.
            el.textContent = `.${HIDDEN_CLASS}{display:none!important}`;
            (document.head || document.documentElement).appendChild(el);
        }
        return el;
    }

    /**
     * The per-file tally. Its `data-added` / `data-deleted` are read by the
     * test-file filter, which takes them off the header figure so that figure
     * is what is left to read once both filters are done.
     */
    function setTally(container, hidden) {
        const header = container.querySelector(HEADER_SELECTOR) || container.firstElementChild;
        let tally = container.querySelector('.' + TALLY_CLASS);
        if (hidden.rows === 0) {
            if (tally) tally.remove();
            return;
        }
        if (!tally) {
            tally = document.createElement('span');
            tally.className = `${TALLY_CLASS} ${UI_CLASS}`;
            tally.style.cssText = 'margin-left:8px;color:var(--fgColor-muted,#8b949e);';
            (header || container).appendChild(tally);
        }
        const text = `${hidden.rows} comment hidden`;
        if (tally.textContent !== text) tally.textContent = text;
        setAttr(tally, 'data-added', String(hidden.added));
        setAttr(tally, 'data-deleted', String(hidden.deleted));
    }

    function setAttr(el, name, value) {
        if (el.getAttribute(name) !== value) el.setAttribute(name, value);
    }

    /** Which side of the diff a changed cell is on. */
    function sideOf(el) {
        if (el.matches(ADDITION_SELECTOR)) return 'added';
        if (el.matches(DELETION_SELECTOR)) return 'deleted';
        return (el.textContent || '').trim().startsWith('+') ? 'added' : 'deleted';
    }

    /**
     * The rows of a file that carry review feedback. GitHub renders an inline
     * thread as its own row after the line it belongs to, so the line itself
     * contains nothing — the row before a thread is marked along with it. One
     * query per file, rather than two per row.
     */
    function feedbackRows(container) {
        const rows = new Set();
        // One selector at a time: six separate searches cost half of what one
        // six-term search costs — 2.5ms to 1.3ms over a 129-file review —
        // because a list of substring matchers loses the fast reject a single
        // one keeps. The caller asks only whether a row is in here, so the
        // order they are found in does not matter.
        for (const selector of REVIEW_COMMENT_SELECTORS) {
            for (const el of container.querySelectorAll(selector)) {
                const row = el.closest('tr') || el;
                rows.add(row);
                if (row.previousElementSibling) rows.add(row.previousElementSibling);
            }
        }
        return rows;
    }

    /** The rows holding a hunk header; the review view gives each one a row of its own. */
    function hunkRows(container) {
        const rows = new Set();
        for (const el of container.querySelectorAll(HUNK_SELECTOR)) rows.add(el.closest('tr') || el);
        return rows;
    }

    function apply(options) {
        const force = !!(options && options.force);
        // Nothing has changed, so every row is already judged as this pass
        // would judge it. Answered from what the observer reported rather than
        // by counting the diff, which is most of what a pass used to cost.
        if (!force && !pendingPage && pendingFiles.size === 0) return lastSummary;
        const pageChanged = force || pendingPage;
        const touched = pendingFiles;
        // A pass the reader asked for does not mean the diff is arriving.
        const pageCaused = !!(options && options.page) || (sawMutations && !force);
        pendingPage = false;
        pendingFiles = new Set();
        sawMutations = false;
        // A file arriving, or being replaced, mutates the list that holds it,
        // which is outside every file and so reported as a page change.
        if (pageChanged || !knownContainers) knownContainers = fileContainers();
        const containers = knownContainers;
        narrowLineSelector();
        styleElement();
        let hiddenLines = 0;
        let hiddenAdded = 0;
        let hiddenDeleted = 0;
        let touchedFiles = 0;
        for (const container of containers) {
            // A file whose rows have not changed keeps its verdict, tally and
            // all: what it counted still stands, so the totals still foot. A
            // pass asked for by hand re-judges every file regardless, because
            // whatever prompted it may not be visible from in here.
            let here = force || touched.has(container) ? null : container.__ghccfHidden;
            if (!here) {
                here = judgeFile(container, syntaxFor(filePath(container)));
                container.__ghccfHidden = here;
                setTally(container, here);
            }
            hiddenLines += here.rows;
            hiddenAdded += here.added;
            hiddenDeleted += here.deleted;
            if (here.rows > 0) touchedFiles++;
        }
        renderPill(containers.length, hiddenLines, touchedFiles, hiddenAdded, hiddenDeleted, pageCaused);
        return lastSummary;
    }

    /** Judge every changed row of one file; returns what it hid, by row and by side. */
    function judgeFile(container, syntax) {
        const state = { inBlock: false };
        const feedback = feedbackRows(container);
        const hunks = hunkRows(container);
        const here = { rows: 0, added: 0, deleted: 0 };
        for (const [row, cells] of changedRows(container)) {
            if (feedback.has(row)) continue;
            if (followsHunk(row, hunks)) state.inBlock = false;
            // Every cell is judged, so a block comment's run is tracked
            // through a row that is only going to stay visible anyway.
            let noise = hiding();
            for (const cell of cells) {
                if (!isNoise(codeOf(cell), syntax, state)) noise = false;
            }
            row.classList.toggle(HIDDEN_CLASS, noise);
            if (!noise) continue;
            here.rows++;
            for (const cell of cells) here[sideOf(cell)]++;
        }
        return here;
    }

    function reset() {
        for (const el of document.querySelectorAll('.' + HIDDEN_CLASS)) el.classList.remove(HIDDEN_CLASS);
        for (const el of document.querySelectorAll('.' + TALLY_CLASS)) el.remove();
        for (const container of fileContainers()) container.__ghccfHidden = null;
        pendingPage = true;
        pendingFiles = new Set();
        knownContainers = null;
    }

    // ----------------------------------------------------------------- pill

    const ICONS = {
        message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'
    };

    /** A stroke icon in the text colour around it. */
    function icon(name) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('width', '14');
        svg.setAttribute('height', '14');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '2');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('class', 'ghdf-icon');
        svg.style.flex = 'none';
        svg.innerHTML = ICONS[name];
        return svg;
    }

    /**
     * Written only when what it says changes: the observer sees each rewrite
     * like any other mutation, and a pass that rewrites its own pill schedules
     * the next pass, for as long as the page is open.
     */
    function renderPill(files, hiddenLines, touchedFiles, hiddenAdded, hiddenDeleted, pageCaused) {
        if (!pill) {
            pill = document.createElement('div');
            pill.id = PILL_ID;
            pill.className = UI_CLASS;
            pill.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483000;'
                + 'display:flex;align-items:center;gap:9px;'
                + 'font:500 12px/1 var(--fontStack-sansSerif,-apple-system,system-ui,sans-serif);'
                + 'background:var(--bgColor-default,#0d1117);color:var(--fgColor-muted,#8b949e);'
                + 'border:1px solid var(--borderColor-default,#30363d);border-radius:999px;'
                + 'padding:9px 10px 9px 14px;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.4);'
                + 'user-select:none;max-width:340px;white-space:nowrap;';
            pill.addEventListener('click', () => {
                // Off is a stored decision, and only an explicit action reverses
                // it. Otherwise a click is a peek.
                if (!enabled) api.enabled = true;
                else api.peek();
            });
        }
        // A navigation can replace body, and the pill with it.
        if (!pill.isConnected) {
            document.body.appendChild(pill);
            pillKey = '';
        }
        if (!pill.closest('#' + DOCK_ID)) {
            const neighbour = document.getElementById(TEST_FILTER_PILL_ID);
            const bottom = neighbour ? `${neighbour.offsetHeight + 24}px` : '16px';
            if (pill.style.bottom !== bottom) pill.style.bottom = bottom;
        }
        const summary = {
            hiddenLines, hiddenAdded, hiddenDeleted, touchedFiles, files,
            enabled, paused, hiding: hiding()
        };
        // Keyed before `arriving` joins it; see the sibling filter for why.
        const key = JSON.stringify(summary);
        const moved = key !== pillKey;
        // A pass the page caused that came to a different answer; see the
        // sibling filter for why both halves are needed.
        summary.arriving = pageCaused && moved;
        if (!moved) {
            // Nothing to redraw, but a burst still going has to say so.
            if (summary.arriving) announce(summary);
            return;
        }
        pillKey = key;
        lastSummary = summary;
        if (files === 0) {
            pill.style.display = 'none';
            announce(summary);
            return;
        }
        pill.style.display = 'flex';
        pill.style.opacity = hiding() ? '1' : '0.85';

        const plural = n => (n === 1 ? '' : 's');
        let state;
        let action;
        if (!enabled) {
            state = 'Comment lines shown';
            action = 'Turn on';
        } else if (paused) {
            state = 'Comment lines shown';
            action = 'Hide';
        } else if (hiddenLines > 0) {
            state = `${hiddenLines.toLocaleString()} comment line${plural(hiddenLines)} hidden`
                + ` in ${touchedFiles} file${plural(touchedFiles)}`;
            action = 'Show';
        } else {
            state = 'No comment-only lines here';
            action = '';
        }

        // The same shape as the test filter's pill, written the same way, so the
        // two read as one control instead of one being restyled from outside.
        pill.replaceChildren();
        const label = document.createElement('span');
        label.className = 'ghdf-pill-label';
        label.style.cssText = 'display:inline-flex;align-items:center;gap:7px;color:var(--fgColor-default,#e6edf3);';
        label.append(icon('message'), document.createTextNode(state));
        pill.append(label);
        if (action) {
            const chip = document.createElement('span');
            chip.className = 'ghdf-pill-action';
            chip.textContent = action;
            chip.style.cssText = 'padding:3px 9px;font-weight:600;color:var(--fgColor-default,#e6edf3);';
            pill.append(chip);
        }
        announce(summary);
    }

    /** What the pill is reporting, for whatever else draws from it. */
    function announce(summary) {
        document.dispatchEvent(new CustomEvent(STATE_EVENT, {
            detail: Object.assign({ source: 'comments' }, summary)
        }));
    }

    // ------------------------------------------------------------ lifecycle

    /**
     * Trailing debounce with a ceiling. A plain trailing debounce never fires
     * while mutations keep arriving faster than its delay, and the review view
     * renders a large diff in bursts for seconds; a pass has to land inside
     * that window, or every line it appends stays visible until it stops.
     */
    function schedule() {
        const now = Date.now();
        if (!waitingSince) waitingSince = now;
        clearTimeout(scheduled);
        const remaining = waitingSince + MAX_WAIT_MS - now;
        scheduled = setTimeout(runPass, Math.max(0, Math.min(DEBOUNCE_MS, remaining)));
    }

    function runPass() {
        waitingSince = 0;
        apply();
    }

    /**
     * Whether a mutation touched anything that is not this extension's own UI.
     * Reacting to our own writes is what made a pass schedule the next one.
     */
    function foreign(record) {
        if (ownNode(record.target)) return false;
        for (const node of record.addedNodes) if (!ownNode(node)) return true;
        for (const node of record.removedNodes) if (!ownNode(node)) return true;
        return false;
    }

    function ownNode(node) {
        const el = node.nodeType === 1 ? node : node.parentElement;
        return !!(el && el.closest(`.${UI_CLASS}`));
    }

    /**
     * Where a mutation landed, which is what the next pass needs to know. A
     * change inside one file can only change that file's lines; a change
     * anywhere else may have added a file.
     */
    function markMutated(target, memo) {
        const el = target && target.nodeType === 1 ? target : target && target.parentElement;
        if (!el) return;
        // A render burst arrives as many records against the same few targets.
        if (el !== memo.target) {
            memo.target = el;
            memo.host = el.closest(FILE_SELECTOR);
        }
        if (memo.host) pendingFiles.add(memo.host);
        else pendingPage = true;
    }

    function onMutations(records) {
        const memo = { target: null, host: null };
        let acted = false;
        for (const record of records) {
            if (!foreign(record)) continue;
            markMutated(record.target, memo);
            acted = true;
        }
        if (!acted) return;
        sawMutations = true;
        schedule();
    }

    function install() {
        apply();
        // documentElement, not body: GitHub replaces body on a navigation.
        new MutationObserver(onMutations).observe(document.documentElement, { childList: true, subtree: true });
        // A navigation replaces the page, so nothing the last pass read of it
        // still holds.
        for (const event of ['turbo:load', 'turbo:render', 'pjax:end', 'popstate']) {
            window.addEventListener(event, () => {
                pendingPage = true;
                knownContainers = null;
                schedule();
            });
        }
    }

    const api = {
        version: VERSION,
        /** Re-judge the diff now, whether or not anything has changed since the last pass. */
        apply: () => apply({ force: true }),
        reset,
        get enabled() {
            return enabled;
        },
        set enabled(value) {
            enabled = Boolean(value);
            paused = false;
            try {
                localStorage.setItem(ENABLED_KEY, String(enabled));
                sessionStorage.removeItem(PAUSED_KEY);
            } catch (error) {
                // Private browsing.
            }
            reset();
            apply();
        },
        get hiding() {
            return hiding();
        },
        get paused() {
            return paused;
        },
        /** What the pill is reporting, as numbers: the last pass's counts and the preferences in force. */
        summary() {
            return lastSummary ? Object.assign({}, lastSummary) : null;
        },
        /** Show the hidden lines for this page without changing the preference. */
        peek(value) {
            paused = value === undefined ? !paused : Boolean(value);
            try {
                sessionStorage.setItem(PAUSED_KEY, String(paused));
            } catch (error) {
                // Private browsing.
            }
            reset();
            apply();
            return paused;
        },
        /** What each changed line was judged to be, for one file or all of them. */
        debug(needle) {
            const rows = [];
            for (const container of fileContainers()) {
                const path = filePath(container);
                if (needle && !path.includes(needle)) continue;
                const syntax = syntaxFor(path);
                const state = { inBlock: false };
                const hunks = hunkRows(container);
                for (const [row, cells] of changedRows(container)) {
                    if (followsHunk(row, hunks)) state.inBlock = false;
                    for (const cell of cells) {
                        const code = codeOf(cell);
                        rows.push({ path, code: code.slice(0, 60), syntax: syntax ? 'known' : 'unknown',
                            hidden: isNoise(code, syntax, state) });
                    }
                }
            }
            console.table(rows);
            return rows;
        },
        selectors: { FILE_SELECTOR, LINE_SELECTOR }
    };
    window.__ghCommentFilter = api;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', install);
    } else {
        install();
    }
})();
