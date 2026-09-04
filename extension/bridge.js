/**
 * Carries preferences between this browser's synced storage and the filters.
 *
 * The filters run in the page's own world so that `window.__gh*` is reachable
 * from the console and a bookmarklet shares one instance with the extension.
 * That world has no `chrome.storage`, so every preference lived in
 * localStorage: correct on one machine and invisible on the next. This script
 * runs in the isolated world, where the extension APIs exist, and relays over
 * DOM events — the only channel the two worlds share.
 *
 * Each setting carries the time it was written, and the newer write wins. There
 * is no merge to attempt: a preference is one value, and the alternative to
 * last-write-wins is asking someone to resolve a conflict about whether
 * lockfiles are hidden.
 */
(() => {
    'use strict';

    if (window.__ghDiffFilterBridge) return;
    window.__ghDiffFilterBridge = true;

    const STORE_KEY = 'settings';
    const PULL = 'ghdf:sync-pull';
    const PUSH = 'ghdf:sync-push';
    const DATA = 'ghdf:sync-data';

    const storage = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync;
    if (!storage) return;

    function send(settings) {
        document.dispatchEvent(new CustomEvent(DATA, { detail: { settings: settings || {} } }));
    }

    function read(then) {
        try {
            const result = storage.get(STORE_KEY, stored => then((stored && stored[STORE_KEY]) || {}));
            // Promise form, in browsers that return one instead of calling back.
            if (result && typeof result.then === 'function') {
                result.then(stored => then((stored && stored[STORE_KEY]) || {}), () => then({}));
            }
        } catch (error) {
            then({});
        }
    }

    document.addEventListener(PULL, () => read(send));

    document.addEventListener(PUSH, event => {
        const change = event.detail;
        if (!change || typeof change.key !== 'string') return;
        read(settings => {
            const existing = settings[change.key];
            // A push that is older than what is stored is a stale tab catching
            // up, not a decision.
            if (existing && existing.at > change.at) return;
            settings[change.key] = { value: change.value, at: change.at };
            try {
                storage.set({ [STORE_KEY]: settings });
            } catch (error) {
                // Over quota or storage disabled; the local value still stands.
            }
        });
    });

    if (chrome.storage.onChanged && chrome.storage.onChanged.addListener) {
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== 'sync' || !changes[STORE_KEY]) return;
            send(changes[STORE_KEY].newValue || {});
        });
    }
})();
