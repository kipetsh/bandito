import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

function localReferences(html) {
    return [...html.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi)]
        .map((match) => match[1])
        .filter((value) => value && !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(value))
        .map((value) => decodeURIComponent(value.split(/[?#]/, 1)[0]).replace(/^\.\//, ''));
}

test('all local resources referenced by index.html exist', () => {
    const html = readFileSync(resolve(projectRoot, 'index.html'), 'utf8');
    for (const reference of localReferences(html)) {
        assert.ok(existsSync(resolve(projectRoot, reference)), `Missing local resource: ${reference}`);
    }
});

// Vite resolves image imports to URLs; in Node they resolve to the file URL itself.
const imageImportHooks = `export async function load(url, context, nextLoad) {
    if (/\\.(?:png|jpe?g|webp)$/.test(url)) {
        return { format: 'module', source: 'export default ' + JSON.stringify(url) + ';', shortCircuit: true };
    }
    return nextLoad(url, context);
}`;

function createClassList() {
    const classes = new Set();
    return {
        add: (...names) => names.forEach((name) => classes.add(name)),
        remove: (...names) => names.forEach((name) => classes.delete(name)),
        toggle: (name, force = !classes.has(name)) => (force ? classes.add(name) : classes.delete(name), force),
        contains: (name) => classes.has(name),
    };
}

register('data:text/javascript,' + encodeURIComponent(imageImportHooks));

const moduleUrl = (path) => pathToFileURL(resolve(projectRoot, path)).href;

function createStorage() {
    const storage = new Map();
    return {
        storage,
        localStorage: {
            getItem: (key) => storage.get(key) ?? null,
            setItem: (key, value) => storage.set(key, String(value)),
            removeItem: (key) => storage.delete(key),
        },
    };
}

async function withGlobals(globals, run) {
    Object.assign(globalThis, globals);
    try {
        await run();
    } finally {
        for (const name of Object.keys(globals)) delete globalThis[name];
    }
}

test('saveSettings and applySettings save and restore preferences', async () => {
    const { storage, localStorage } = createStorage();
    const elements = {
        '#reduceMotion': { checked: false },
        '#darkTheme': { checked: false },
        '#brandLogo': { src: '' },
    };
    const body = { classList: createClassList(), style: {} };
    const document = { body, querySelector: (selector) => elements[selector] ?? null };

    await withGlobals({ document, localStorage }, async () => {
        const { applySettings, saveSettings } = await import(moduleUrl('js/settings.js'));

        // The settings checkboxes call saveSettings on change.
        elements['#reduceMotion'].checked = true;
        elements['#darkTheme'].checked = true;
        saveSettings();
        assert.deepEqual(JSON.parse(storage.get('banditoSettings')), { reduceMotion: true, darkTheme: true });
        assert.ok(body.classList.contains('reduce-motion'));
        assert.ok(body.classList.contains('dark-theme'));
        assert.match(elements['#brandLogo'].src, /bandito-logo-night-512\.png$/);

        // The reset button clears storage and calls applySettings.
        storage.delete('banditoSettings');
        applySettings();
        assert.equal(elements['#reduceMotion'].checked, false);
        assert.equal(elements['#darkTheme'].checked, false);
        assert.ok(!body.classList.contains('reduce-motion'));
        assert.ok(!body.classList.contains('dark-theme'));
        assert.match(elements['#brandLogo'].src, /bandito-logo\.png$/);
    });
});

// Any DOM lookup returns a stub that absorbs property access, calls and assignments.
// Tree traversal yields null so the stub behaves like an empty element in loops.
const emptyTreeProperties = new Set(['firstChild', 'lastChild', 'nextSibling', 'previousSibling', 'parentNode']);

function createStub() {
    const stub = new Proxy(function () {}, {
        get: (_target, property) => {
            if (property === Symbol.toPrimitive) return () => '';
            if (property === Symbol.iterator) return function* () {};
            if (property === 'then' || emptyTreeProperties.has(property)) return undefined;
            return stub;
        },
        set: () => true,
        apply: () => stub,
        construct: () => stub,
    });
    return stub;
}

test('the entry point loads every application module without runtime errors', async () => {
    const html = readFileSync(resolve(projectRoot, 'index.html'), 'utf8');
    const localScripts = [...html.matchAll(/<script[^>]*src="([^":]+)"/g)].map((match) => match[1]);
    assert.deepEqual(localScripts, ['js/main.js'], 'index.html must load only the js/main.js entry point');

    const { localStorage } = createStorage();
    const globals = {
        document: createStub(),
        firebase: createStub(),
        localStorage,
        matchMedia: () => ({ matches: false }),
        fetch: () => new Promise(() => {}),
        requestAnimationFrame: () => 0,
        addEventListener: () => {},
    };
    await withGlobals({ ...globals, window: globals }, () => import(moduleUrl('js/main.js')));
});

test('all game scripts pass the JavaScript parser', () => {
    const scriptsDirectory = resolve(projectRoot, 'js');
    const scripts = readdirSync(scriptsDirectory).filter((name) => name.endsWith('.js'));
    assert.ok(scripts.length > 0, 'No game scripts found');

    for (const script of scripts) {
        const file = join(scriptsDirectory, script);
        const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
        assert.equal(result.status, 0, `${script} has a syntax error:\n${result.stderr}`);
    }
});

test('the card data is structurally valid and contains all supported starting cards', () => {
    const data = JSON.parse(readFileSync(resolve(projectRoot, 'resources/bandido-matrices/cards.json'), 'utf8'));
    assert.ok(Array.isArray(data.cards) && data.cards.length > 0, 'Card list is empty');

    const ids = new Set();
    for (const card of data.cards) {
        assert.ok(Number.isInteger(card.id), 'Every card needs an integer ID');
        assert.ok(!ids.has(card.id), `Duplicate card ID: ${card.id}`);
        ids.add(card.id);

        if (card.kind === 'back') {
            assert.equal(card.matrix, null, 'The card back must not have a playable matrix');
            continue;
        }

        assert.ok(Array.isArray(card.matrix) && card.matrix.length > 0, `Card ${card.id} has no matrix`);
        const width = card.matrix[0].length;
        assert.ok(width > 0, `Card ${card.id} has an empty row`);
        for (const row of card.matrix) {
            assert.equal(row.length, width, `Card ${card.id} has a non-rectangular matrix`);
            assert.ok(
                row.every((cell) => cell === 0 || cell === 1),
                `Card ${card.id} contains an invalid cell`
            );
        }
    }

    const starts = new Map(data.cards.filter((card) => card.kind === 'start').map((card) => [card.id, card.exitCount]));
    assert.equal(starts.get(75), 2, 'Two-exit start card is missing');
    assert.equal(starts.get(72), 5, 'Five-exit start card is missing');
    assert.equal(starts.get(71), 6, 'Six-exit start card is missing');
});
