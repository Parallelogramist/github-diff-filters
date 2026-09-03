/**
 * Gives hide-comment-diffs' pill the shape hide-test-files uses: state on the
 * left, the action the click performs in a chip on the right. Its own text
 * states what it hid without saying what clicking does, and it is a minified
 * artifact with no source here, so the two are reconciled at this end rather
 * than at the producer.
 */
(() => {
    'use strict';

    if (window.__ghDiffFilterPillSkin) return;
    window.__ghDiffFilterPillSkin = true;

    const PILL_ID = 'ghccf-pill';
    const SKIN_ATTR = 'data-ghdf-skin';
    const LABEL_CLASS = 'ghdf-pill-label';
    const ACTION_CLASS = 'ghdf-pill-action';
    const ACTION_CLAUSE = /\s*[—–-]\s*click to (?:show|hide|re-hide).*$/i;

    const PILL_CSS = 'position:fixed;right:16px;bottom:16px;z-index:2147483000;'
        + 'display:flex;align-items:center;gap:9px;'
        + 'font:500 12px/1 var(--fontStack-sansSerif,-apple-system,system-ui,sans-serif);'
        + 'background:var(--bgColor-default,#0d1117);color:var(--fgColor-muted,#8b949e);'
        + 'border:1px solid var(--borderColor-default,#30363d);border-radius:999px;'
        + 'padding:9px 10px 9px 14px;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.4);'
        + 'user-select:none;max-width:340px;white-space:nowrap;';

    function actionFor(state) {
        if (/\bshown\b/i.test(state)) return 'Hide';
        if (/\bhidden\b/i.test(state)) return 'Show';
        return '';
    }

    function render(pill, state, action) {
        pill.replaceChildren();
        const label = document.createElement('span');
        label.className = LABEL_CLASS;
        label.textContent = state;
        label.style.color = 'var(--fgColor-default,#e6edf3)';
        pill.append(label);
        if (!action) return;
        const chip = document.createElement('span');
        chip.className = ACTION_CLASS;
        chip.textContent = action;
        chip.style.cssText = 'padding:3px 9px;border-radius:999px;font-weight:600;'
            + 'background:var(--bgColor-neutral-muted,#282e36);color:var(--fgColor-default,#e6edf3);';
        pill.append(chip);
    }

    function skin(pill) {
        if (pill.getAttribute(SKIN_ATTR) !== 'styled') {
            pill.style.cssText = PILL_CSS;
            pill.setAttribute(SKIN_ATTR, 'styled');
        }
        const label = pill.querySelector('.' + LABEL_CLASS);
        const source = (label ? label.textContent : pill.textContent) || '';
        const state = source.replace(ACTION_CLAUSE, '').trim();
        if (!state) return;
        const action = actionFor(state);
        // Re-rendering what is already rendered would retrigger the observer.
        const settled = label && label.textContent === state
            && Boolean(pill.querySelector('.' + ACTION_CLASS)) === Boolean(action);
        if (settled) return;
        render(pill, state, action);
    }

    let watched;
    function attach() {
        const pill = document.getElementById(PILL_ID);
        if (!pill) return;
        if (pill !== watched) {
            watched = pill;
            new MutationObserver(() => skin(pill))
                .observe(pill, { childList: true, characterData: true, subtree: true });
        }
        skin(pill);
    }

    new MutationObserver(attach).observe(document.body, { childList: true });
    attach();
})();
