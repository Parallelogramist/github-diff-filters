/**
 * The settings, for people who do not open a console.
 *
 * Reads and writes the same synced record the page-side bridge does, in the
 * same shape: `{ [localStorage key]: { value, at } }`, newest write wins. The
 * keys are the ones the filter itself reads, so a change here and a change on a
 * diff page are the same act.
 */
(() => {
    'use strict';

    const STORE_KEY = 'settings';
    const PREFIX = 'gh-hide-test-files:';
    const ENABLED_KEY = `${PREFIX}enabled`;
    const ONLY_CHANGED_KEY = `${PREFIX}onlyChanged`;
    const CATEGORIES_KEY = `${PREFIX}categories`;
    const CUSTOM_RULES_KEY = `${PREFIX}customRules`;
    const REPO_ENABLED = new RegExp(`^${PREFIX}enabled:(.+)$`);

    const CATEGORIES = [
        ['test', 'Test files'],
        ['snapshot', 'Snapshots'],
        ['lockfile', 'Lockfiles'],
        ['generated', 'Generated code'],
        ['vendored', 'Vendored code'],
        ['data', 'Seeded data'],
        ['rename', 'Renames with no changes'],
        ['mode', 'Mode-only changes'],
        ['binary', 'Binary files'],
        ['viewed', 'Files you marked viewed']
    ];

    const el = id => document.getElementById(id);
    const status = message => {
        el('status').textContent = message;
        clearTimeout(status.timer);
        status.timer = setTimeout(() => { el('status').textContent = ''; }, 2500);
    };

    let settings = {};

    const valueOf = (key, fallback) => (settings[key] ? settings[key].value : fallback);

    function write(key, value) {
        settings[key] = { value, at: Date.now() };
        chrome.storage.sync.set({ [STORE_KEY]: settings }, () => {
            status(chrome.runtime.lastError ? 'Could not save' : 'Saved');
        });
    }

    function readCategories() {
        try {
            return JSON.parse(valueOf(CATEGORIES_KEY, '{}')) || {};
        } catch (error) {
            return {};
        }
    }

    function renderCategories() {
        const stored = readCategories();
        const host = el('categories');
        host.replaceChildren();
        for (const [name, label] of CATEGORIES) {
            const row = document.createElement('label');
            row.className = 'row';
            const box = document.createElement('input');
            box.type = 'checkbox';
            box.checked = stored[name] !== false;
            box.addEventListener('change', () => {
                const next = readCategories();
                next[name] = box.checked;
                write(CATEGORIES_KEY, JSON.stringify(next));
            });
            const text = document.createElement('span');
            text.textContent = label;
            row.append(box, text);
            host.append(row);
        }
    }

    function renderOverrides() {
        const host = el('overrides');
        host.replaceChildren();
        const rows = Object.keys(settings)
            .map(key => ({ key, repo: (key.match(REPO_ENABLED) || [])[1] }))
            .filter(row => row.repo && settings[row.key].value !== null);
        if (rows.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'empty';
            empty.textContent = 'None — every repository follows the default.';
            host.append(empty);
            return;
        }
        for (const { key, repo } of rows.sort((a, b) => a.repo.localeCompare(b.repo))) {
            const row = document.createElement('div');
            row.className = 'row';
            const name = document.createElement('span');
            name.textContent = repo;
            const state = document.createElement('span');
            state.className = 'count';
            state.textContent = settings[key].value === 'false' ? 'hiding off' : 'hiding on';
            const clear = document.createElement('button');
            clear.type = 'button';
            clear.textContent = 'Clear';
            clear.addEventListener('click', () => {
                write(key, null);
                renderOverrides();
            });
            row.append(name, state, clear);
            host.append(row);
        }
    }

    function render() {
        el('defaultEnabled').checked = valueOf(ENABLED_KEY, 'true') !== 'false';
        el('onlyChanged').checked = valueOf(ONLY_CHANGED_KEY, 'false') === 'true';
        let patterns = [];
        try {
            patterns = JSON.parse(valueOf(CUSTOM_RULES_KEY, '[]')) || [];
        } catch (error) {
            patterns = [];
        }
        el('customRules').value = patterns.join('\n');
        renderCategories();
        renderOverrides();
    }

    el('defaultEnabled').addEventListener('change', event => {
        write(ENABLED_KEY, String(event.target.checked));
    });
    el('onlyChanged').addEventListener('change', event => {
        write(ONLY_CHANGED_KEY, String(event.target.checked));
    });
    el('saveRules').addEventListener('click', () => {
        const lines = el('customRules').value.split('\n').map(line => line.trim()).filter(Boolean);
        // Rejected here rather than stored: a pattern that throws would make
        // every later rule unreachable on a diff page.
        for (const line of lines) {
            try {
                new RegExp(line);
            } catch (error) {
                el('rulesError').textContent = `Not a valid pattern: ${line}`;
                el('rulesError').hidden = false;
                return;
            }
        }
        el('rulesError').hidden = true;
        write(CUSTOM_RULES_KEY, JSON.stringify(lines));
    });

    chrome.storage.sync.get(STORE_KEY, stored => {
        settings = (stored && stored[STORE_KEY]) || {};
        render();
    });

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync' || !changes[STORE_KEY]) return;
        settings = changes[STORE_KEY].newValue || {};
        render();
    });
})();
