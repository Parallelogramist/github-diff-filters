/**
 * One control in the corner for both filters, and the keyboard shortcuts.
 *
 * Collapsed, it says what the filters are doing beside an icon that goes green
 * while they are in force; on hover or focus it expands to the two pills, which
 * say what was hidden and let the reader show it. The pills are the filters'
 * own elements, created by separate scripts, so their behaviour is theirs; this
 * owns only where they sit.
 */
(() => {
    'use strict';

    if (window.__ghDiffFilterControls) return;

    const DOCK_ID = 'ghdf-dock';
    const PILL_IDS = ['ghtf-pill', 'ghccf-pill'];
    const DIFF_PATH = /\/pull\/\d+\/(files|changes|commits\/[0-9a-f]{7,})/;
    const CONTAINER_SELECTOR = '.js-file,[class^="Diff-module__diffTargetable"]';
    const TYPING_SELECTOR = 'input,textarea,select,[contenteditable=""],[contenteditable="true"]';
    const KEYS_KEY = 'gh-diff-filters:keys';
    const ENABLED_KEY = 'gh-diff-filters:shortcuts';
    /** On everything the filters and this script put in the page; their observers skip it. */
    const UI_CLASS = 'ghdf-ui';
    /** Fired by a filter after its pill changes. */
    const STATE_EVENT = 'ghdf:state';
    const STYLE_ID = 'ghdf-dock-style';
    const PINNED_CLASS = 'ghdf-pinned';
    const FUNNEL = '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>';
    const WORKING_TEXT = 'Applying filters\u2026';
    const DONE_TEXT = 'Done';
    /** How long the finished label stays before it goes; a label that never leaves stops being read. */
    const APPLIED_MS = 5000;
    /** How long the label takes to leave, in the CSS below and in the JS that drives it. */
    const FADE_MS = 450;
    /** One easing for everything the dock moves, so the parts read as one. */
    const EASE = 'cubic-bezier(.4,0,.2,1)';
    const DOCK_CSS = `
#${DOCK_ID}{position:fixed;right:16px;bottom:16px;z-index:2147483000;display:flex;flex-direction:column;align-items:flex-end;gap:6px;}
#${DOCK_ID} .ghdf-panel{display:none;flex-direction:column;align-items:flex-end;gap:6px;}
#${DOCK_ID}:hover .ghdf-panel,#${DOCK_ID}:focus-within .ghdf-panel,#${DOCK_ID}.${PINNED_CLASS} .ghdf-panel{display:flex;}
#${DOCK_ID} .ghdf-indicator{position:relative;display:inline-flex;align-items:center;gap:0;margin:0;padding:6px 10px 6px 12px;transition:padding-left ${FADE_MS}ms ${EASE};border-radius:999px;border:1px solid var(--borderColor-default,#30363d);background:var(--bgColor-default,#0d1117);color:var(--fgColor-default,#e6edf3);font:600 12px/1 var(--fontStack-monospace,ui-monospace,SFMono-Regular,monospace);box-shadow:0 6px 20px rgba(0,0,0,.4);user-select:none;}
#${DOCK_ID} .ghdf-indicator button{all:unset;display:inline-flex;align-items:center;font:inherit;color:inherit;line-height:1;cursor:pointer;}
#${DOCK_ID} .ghdf-indicator button:focus-visible{outline:2px solid var(--focus-outlineColor,#1f6feb);outline-offset:3px;border-radius:2px;}
/* Reaches past the button reset above, which sets color:inherit and is the more
   specific of the two by type. Without this the icon never went grey. */
#${DOCK_ID} .ghdf-indicator .ghdf-settings{padding:3px;margin:-3px;border-radius:50%;color:var(--fgColor-muted,#8b949e);}
#${DOCK_ID} .ghdf-settings svg{display:block;}
#${DOCK_ID} .ghdf-settings:hover,#${DOCK_ID} .ghdf-settings[aria-expanded="true"]{color:var(--fgColor-default,#e6edf3);}
#${DOCK_ID} .ghdf-indicator.ghdf-active .ghdf-settings{color:var(--fgColor-success,#3fb950);}
#${DOCK_ID} .ghdf-progress{position:absolute;left:12px;right:10px;bottom:3px;height:2px;border-radius:999px;background:var(--borderColor-muted,#30363d);overflow:hidden;opacity:0;transition:opacity .3s ease;pointer-events:none;}
#${DOCK_ID} .ghdf-progress.ghdf-progress-on{opacity:1;}
#${DOCK_ID} .ghdf-progress span{display:block;height:100%;width:0;border-radius:999px;background:var(--fgColor-accent,#388bfd);transition:width .18s ease;}
/* Reaches past the same button reset. The width is animated from a measured
   number rather than from the keyword auto, which no browser transitions, and
   the margin goes with it so the pill closes around the icon in one movement. */
#${DOCK_ID} .ghdf-indicator .ghdf-state{white-space:nowrap;overflow:hidden;opacity:1;margin-right:8px;transition:max-width ${FADE_MS}ms ${EASE},margin-right ${FADE_MS}ms ${EASE},opacity ${Math.round(FADE_MS * 0.6)}ms ease;}
#${DOCK_ID} .ghdf-indicator .ghdf-state.ghdf-state-gone{opacity:0;margin-right:0;}
#${DOCK_ID} .ghdf-indicator.ghdf-lean{padding-left:10px;}
@media (prefers-reduced-motion:reduce){#${DOCK_ID} .ghdf-progress span,#${DOCK_ID} .ghdf-indicator,#${DOCK_ID} .ghdf-indicator .ghdf-state{transition:none;}}
`;

    const DEFAULT_KEYS = { tests: 't', comments: 'c', next: 'j', previous: 'k' };
    const ACTION_LABELS = {
        tests: 'hide or show the filtered files',
        comments: 'hide or show comment-only lines',
        next: 'next visible file',
        previous: 'previous visible file'
    };

    function stored(key, fallback) {
        try {
            const value = localStorage.getItem(key);
            return value === null ? fallback : value;
        } catch (error) {
            return fallback;
        }
    }

    function readKeys() {
        let overrides = {};
        try {
            overrides = JSON.parse(stored(KEYS_KEY, '{}')) || {};
        } catch (error) {
            overrides = {};
        }
        const keys = Object.assign({}, DEFAULT_KEYS);
        for (const action of Object.keys(DEFAULT_KEYS)) {
            const key = overrides[action];
            if (typeof key === 'string' && key.length === 1) keys[action] = key;
        }
        return keys;
    }

    /**
     * Whether the reader has turned single-character shortcuts off.
     *
     * GitHub offers that as an accessibility setting and marks the document when
     * it is in force. The marker is matched by shape rather than by name, so the
     * setting keeps being honoured when GitHub renames the attribute — the cost
     * of guessing wrong here is shadowing a key someone relies on.
     */
    function characterKeysDisabled() {
        for (const el of [document.documentElement, document.body]) {
            if (!el || !el.attributes) continue;
            for (const attr of el.attributes) {
                if (!/(single.?character|character.?key).*(shortcut|key)|shortcut.*character/i.test(attr.name)) continue;
                const value = String(attr.value).toLowerCase();
                if (value !== 'false' && value !== '0' && value !== 'enabled') return true;
            }
        }
        return false;
    }

    let keys = readKeys();

    function shortcutsEnabled() {
        return stored(ENABLED_KEY, 'true') !== 'false' && !characterKeysDisabled();
    }

    /** Read by the test filter's popover, so the keys are visible somewhere. */
    function publishHelp() {
        window.__ghDiffFilterShortcuts = shortcutsEnabled()
            ? Object.keys(DEFAULT_KEYS).map(action => ({ key: keys[action], label: ACTION_LABELS[action] }))
            : [];
    }

    let dock;
    let panel;
    let indicator;
    let stateLabel;
    let settings;
    let progress;
    let progressFill;
    let doneTimer;
    let activityTimer;
    let busy = false;
    /** What the indicator last drew, so the settle can finish from it alone. */
    let drawn = { arrived: 0, expected: 0, active: false };
    let appliedTimer;
    /** Whether the finished label has already had its say for this run of work. */
    let retired = false;
    let tick;
    let startedAt = 0;
    let reached = 0;
    /**
     * How long after the last pass the filters are taken to be finished.
     * Measured on a 129-file review: GitHub's rendering bursts leave gaps of
     * well under a second, and a shorter settle than this reported the work
     * finished two or three times over during one load.
     */
    const SETTLE_MS = 1200;
    let indicatorKey = '';

    const nextFrame = typeof requestAnimationFrame === 'function'
        ? callback => requestAnimationFrame(callback)
        : callback => setTimeout(callback, 16);

    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.className = UI_CLASS;
        style.textContent = DOCK_CSS;
        (document.head || document.documentElement).appendChild(style);
    }

    function funnel() {
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
        svg.innerHTML = FUNNEL;
        return svg;
    }

    function ensureDock() {
        const pills = PILL_IDS.map(id => document.getElementById(id)).filter(Boolean);
        if (pills.length === 0) return;
        ensureStyle();
        if (!dock || !dock.isConnected) {
            dock = document.createElement('div');
            dock.id = DOCK_ID;
            dock.className = UI_CLASS;
            panel = document.createElement('div');
            panel.className = 'ghdf-panel';
            indicator = document.createElement('div');
            indicator.className = 'ghdf-indicator';
            stateLabel = document.createElement('button');
            stateLabel.type = 'button';
            stateLabel.className = 'ghdf-state';
            stateLabel.setAttribute('aria-expanded', 'false');
            // Hover is not available to everyone; a click keeps the pills open.
            stateLabel.addEventListener('click', () => {
                const pinned = dock.classList.toggle(PINNED_CLASS);
                stateLabel.setAttribute('aria-expanded', String(pinned));
            });
            settings = document.createElement('button');
            settings.type = 'button';
            settings.className = 'ghdf-settings';
            settings.setAttribute('aria-label', 'Choose what to hide');
            settings.setAttribute('aria-haspopup', 'dialog');
            settings.setAttribute('aria-expanded', 'false');
            settings.append(funnel());
            settings.addEventListener('click', () => {
                const filter = window.__ghTestFileFilter;
                if (filter && typeof filter.toggleSettings === 'function') filter.toggleSettings();
            });
            progress = document.createElement('div');
            progress.className = 'ghdf-progress';
            progress.setAttribute('role', 'progressbar');
            progress.setAttribute('aria-label', 'Filtering the diff');
            progress.setAttribute('aria-valuemin', '0');
            progress.setAttribute('aria-valuemax', '100');
            progressFill = document.createElement('span');
            progress.append(progressFill);
            indicator.append(stateLabel, settings, progress);
            dock.append(panel, indicator);
            document.body.appendChild(dock);
            // This script runs after both filters, so their first pass has
            // already announced itself and been missed. If it said the diff
            // was arriving, that work is in flight now: adopt it, or the
            // control opens on "Done" and only goes back to working when
            // GitHub's next burst lands.
            if (['__ghTestFileFilter', '__ghCommentFilter']
                .some(name => (summaryOf(name) || {}).arriving)) {
                noteActivity();
            }
        }
        for (const pill of pills) {
            if (pill.parentElement !== panel) panel.appendChild(pill);
            // The pills each placed themselves before there was a dock.
            if (pill.style.position !== 'static') {
                pill.style.position = 'static';
                pill.style.right = 'auto';
                pill.style.bottom = 'auto';
            }
        }
        renderIndicator();
    }

    function summaryOf(name) {
        const filter = window[name];
        return filter && typeof filter.summary === 'function' ? filter.summary() : null;
    }

    /**
     * Note that the filters are working. They announce every pass, and GitHub
     * renders a large diff in bursts, so passes keep arriving for as long as
     * the diff does — a quiet spell is the end of it. This is the only signal
     * available on the review view, which lists every file's container up front
     * and fills the bodies in afterwards: by the time the slow part starts,
     * every file has "arrived" and a percentage has nothing left to count.
     */
    function noteActivity() {
        if (!busy) {
            startedAt = Date.now();
            retired = false;
        }
        busy = true;
        clearTimeout(activityTimer);
        // The bar advances on its own between bursts: passes arrive in clumps,
        // and a bar that only moved when one landed would sit still through
        // the gaps that make a load feel slow.
        if (!tick) tick = setInterval(() => renderProgress(true, drawn.arrived, drawn.expected), 140);
        activityTimer = setTimeout(() => {
            busy = false;
            clearInterval(tick);
            tick = null;
            // Only the bar has anything to say when the work stops. Rewriting
            // the rest would be a write into a page that has gone quiet, which
            // is the thing every observer here is built to avoid.
            renderProgress(false, drawn.arrived, drawn.expected);
            renderState(false, drawn.active);
        }, SETTLE_MS);
    }

    /**
     * How far along to draw when the page offers no total to count against.
     *
     * The review view renders by viewport, so the files on screen are never a
     * fraction of a knowable whole and no counted bar could ever complete.
     * This estimates from elapsed time instead, approaching the end without
     * reaching it, and never going backwards within a run; the settle takes it
     * the rest of the way. Same shape as a browser's own load bar, and for the
     * same reason.
     */
    function estimate() {
        const elapsed = Date.now() - (startedAt || Date.now());
        const eased = 92 * (1 - Math.exp(-elapsed / 1400));
        reached = Math.max(reached, Math.round(eased));
        return Math.max(6, reached);
    }

    function renderIndicator() {
        const tests = summaryOf('__ghTestFileFilter');
        const comments = summaryOf('__ghCommentFilter');
        const files = tests ? tests.hidden : 0;
        const lines = comments ? comments.hiddenLines : 0;
        const active = Boolean((tests && tests.hiding) || (comments && comments.hiding));
        const filter = window.__ghTestFileFilter;
        const settingsOpen = Boolean(filter && filter.settingsOpen);
        const arrived = tests ? tests.files : 0;
        const expected = tests ? Math.max(tests.expected || 0, arrived) : 0;
        const loading = busy || Boolean(tests && tests.incomplete && expected > 0);
        const key = `${files}:${lines}:${active}:${settingsOpen}:${!!filter}:${arrived}/${expected}:${loading}`;
        if (key === indicatorKey) return;
        indicatorKey = key;
        indicator.classList.toggle('ghdf-active', active);
        const count = (n, noun) => `${n.toLocaleString()} ${noun}${n === 1 ? '' : 's'}`;
        // The figures are no longer on the button, so this is the only place
        // they are spoken; the pills carry them for everyone else.
        stateLabel.setAttribute('aria-label', `Diff filters${active ? '' : ', off'}: ${count(files, 'file')}`
            + ` and ${count(lines, 'comment line')} hidden. Details on hover or focus.`);
        // The categories belong to the test-file filter; without it there is nothing to open.
        settings.hidden = !filter;
        settings.setAttribute('aria-expanded', String(settingsOpen));
        drawn = { arrived, expected, active };
        renderState(loading, active);
        renderProgress(loading, arrived, expected);
    }

    /**
     * What the filters are doing, in words.
     *
     * A count said what had been hidden but not whether more was coming, and on
     * a large diff those are seconds apart. The working label stays for as long
     * as passes keep arriving, so the reader waits on something rather than on
     * nothing; the finished label says so once and then goes, leaving the icon
     * to carry the state.
     */
    function renderState(loading, active) {
        if (!stateLabel) return;
        clearTimeout(appliedTimer);
        // Nothing is being filtered, so there is nothing to report; and once
        // the finished label has gone it stays gone until there is more work,
        // rather than coming back at every unrelated redraw.
        if (!active || (!loading && retired)) {
            closeState();
            return;
        }
        openState(loading ? WORKING_TEXT : DONE_TEXT);
        if (loading) return;
        appliedTimer = setTimeout(retireState, APPLIED_MS);
    }

    /**
     * The label, at the width these particular words need.
     *
     * Kept a measured number rather than left to the text, because that width
     * is animated and no browser transitions to or from `auto`: as a number it
     * slides when the wording changes and closes when the label goes.
     */
    function openState(text) {
        stateLabel.hidden = false;
        if (stateLabel.textContent !== text) stateLabel.textContent = text;
        stateLabel.classList.remove('ghdf-state-gone');
        indicator.classList.remove('ghdf-lean');
        stateLabel.style.maxWidth = `${stateLabel.scrollWidth}px`;
    }

    /** The label away, and the pill closed around the icon in the same movement. */
    function closeState() {
        if (stateLabel.hidden) return;
        // From the width it has: a transition that starts at a guessed maximum
        // stands still until the guess is reached.
        stateLabel.style.maxWidth = `${stateLabel.scrollWidth}px`;
        nextFrame(() => {
            stateLabel.classList.add('ghdf-state-gone');
            indicator.classList.add('ghdf-lean');
            stateLabel.style.maxWidth = '0px';
        });
        // Out of the layout only once it has finished leaving it, so the pill
        // does not jump at the end of its own animation.
        appliedTimer = setTimeout(() => { stateLabel.hidden = true; }, FADE_MS + 60);
    }

    function retireState() {
        // The label is the only way to pin the panel open, so it stays while
        // the reader has the panel pinned.
        if (dock && dock.classList.contains(PINNED_CLASS)) {
            appliedTimer = setTimeout(retireState, APPLIED_MS);
            return;
        }
        retired = true;
        closeState();
    }

    /**
     * A bar while the diff is still arriving. GitHub renders a large one in
     * bursts over several seconds, and a count that has stopped moving looks
     * exactly like a count that is finished — this says which. It fills to the
     * end before going away, so finishing is something the reader sees rather
     * than something they infer from the bar's absence.
     */
    function renderProgress(loading, arrived, expected) {
        if (!progress) return;
        clearTimeout(doneTimer);
        // Count against a real total where the page gives one that is still
        // ahead of what has arrived; estimate where it does not.
        const counted = expected > arrived;
        if (loading) {
            // A sliver reads as "started"; nothing reads as broken.
            const percent = Math.max(4, counted
                ? Math.min(100, Math.round((arrived / expected) * 100))
                : estimate());
            progress.classList.add('ghdf-progress-on');
            if (progress.getAttribute('aria-valuenow') !== String(percent)) {
                progress.setAttribute('aria-valuenow', String(percent));
                progressFill.style.width = `${percent}%`;
            }
            return;
        }
        if (!progress.classList.contains('ghdf-progress-on')) return;
        progress.setAttribute('aria-valuenow', '100');
        progressFill.style.width = '100%';
        startedAt = 0;
        reached = 0;
        doneTimer = setTimeout(() => progress.classList.remove('ghdf-progress-on'), 900);
    }

    function onDiffScreen() {
        return DIFF_PATH.test(location.pathname);
    }

    /** Files still on screen, in document order, skipping what a filter collapsed. */
    function visibleFiles() {
        return Array.from(document.querySelectorAll(CONTAINER_SELECTOR))
            .filter(el => !el.classList.contains('ghtf-hidden-file')
                && getComputedStyle(el).display !== 'none');
    }

    let cursor = -1;
    function step(delta) {
        const files = visibleFiles();
        if (files.length === 0) return;
        cursor = Math.max(0, Math.min(files.length - 1, cursor === -1 ? 0 : cursor + delta));
        const target = files[cursor];
        if (target.scrollIntoView) target.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }

    function toggle(name) {
        const filter = window[name];
        if (!filter) return;
        // A peek where the filter offers one: showing the files is not the same
        // as changing what this repository does from now on.
        if (typeof filter.peek === 'function') filter.peek();
        else filter.enabled = !filter.enabled;
    }

    const ACTIONS = {
        tests: () => toggle('__ghTestFileFilter'),
        comments: () => toggle('__ghCommentFilter'),
        next: () => step(1),
        previous: () => step(-1)
    };

    function onKeyDown(event) {
        if (!shortcutsEnabled()) return;
        if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
        if (event.defaultPrevented || !onDiffScreen()) return;
        const target = event.target;
        if (target && target.closest && target.closest(TYPING_SELECTOR)) return;
        for (const action of Object.keys(ACTIONS)) {
            if (event.key !== keys[action]) continue;
            ACTIONS[action]();
            event.preventDefault();
            return;
        }
    }

    document.addEventListener('keydown', onKeyDown, true);
    // A filter announces each change to its pill, including a pill it had to
    // put back after a navigation replaced body.
    document.addEventListener(STATE_EVENT, event => {
        // Only the page filling the diff in counts as work. Switching a
        // category, or opening this menu, announces itself the same way and
        // used to make the bar start over on every click.
        if (event.detail && event.detail.arriving) noteActivity();
        ensureDock();
    });
    ensureDock();
    publishHelp();

    window.__ghDiffFilterControls = {
        get keys() {
            return Object.assign({}, keys);
        },
        /** Rebind one action to a single character; pass null to restore the default. */
        setKey(action, key) {
            if (!Object.prototype.hasOwnProperty.call(DEFAULT_KEYS, action)) {
                throw new Error(`unknown action: ${action}`);
            }
            if (key !== null && (typeof key !== 'string' || key.length !== 1)) {
                throw new Error('a shortcut is a single character');
            }
            let overrides = {};
            try {
                overrides = JSON.parse(stored(KEYS_KEY, '{}')) || {};
            } catch (error) {
                overrides = {};
            }
            if (key === null) delete overrides[action];
            else overrides[action] = key;
            try {
                localStorage.setItem(KEYS_KEY, JSON.stringify(overrides));
            } catch (error) {
                // Private browsing; the change lasts as long as the page does.
            }
            keys = readKeys();
            if (key !== null) keys[action] = key;
            publishHelp();
            return this.keys;
        },
        get enabled() {
            return shortcutsEnabled();
        },
        set enabled(value) {
            try {
                localStorage.setItem(ENABLED_KEY, String(Boolean(value)));
            } catch (error) {
                // Private browsing.
            }
            publishHelp();
        },
        /** Why the shortcuts are off, when they are. */
        get characterKeysDisabledByGitHub() {
            return characterKeysDisabled();
        },
        help() {
            // Recomputed, because GitHub's setting can change without us acting.
            publishHelp();
            return window.__ghDiffFilterShortcuts;
        }
    };
})();
