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

test('room URLs preserve the GitHub Pages project path and support root hosting', async () => {
    const { getAppBasePath, getRoomCodeFromPath, getRoomPath, getRoomUrl } = await import(moduleUrl('js/room-url.js'));

    assert.equal(getRoomCodeFromPath('/bandito/K3F9QX'), 'K3F9QX');
    assert.equal(getRoomCodeFromPath('/bandito/k3f9qx/'), 'K3F9QX');
    assert.equal(getRoomCodeFromPath('/bandito/'), null);
    assert.equal(getAppBasePath('/bandito/K3F9QX'), '/bandito/');
    assert.equal(getRoomPath('K3F9QX', '/bandito/'), '/bandito/K3F9QX');
    assert.equal(getRoomPath(null, '/bandito/K3F9QX'), '/bandito/');
    assert.equal(getRoomPath('K3F9QX', '/'), '/K3F9QX');
    assert.equal(
        getRoomUrl('K3F9QX', { protocol: 'https:', origin: 'https://kipetsh.github.io', pathname: '/bandito/' }),
        'https://kipetsh.github.io/bandito/K3F9QX'
    );
    assert.equal(
        getRoomUrl('K3F9QX', { protocol: 'bandito:', origin: 'bandito://localhost', pathname: '/' }),
        'https://kipetsh.github.io/bandito/K3F9QX'
    );
});

test('a player who leaves a running game returns the hand under the deck and draws a new one on coming back', async () => {
    const { leaveRoom, returnToGame } = await import(moduleUrl('js/room-seats.js'));
    const room = {
        owner: 'anna',
        players: { anna: { name: 'Аня' }, boris: { name: 'Боря' } },
        game: {
            started: true,
            finished: false,
            deck: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }],
            hands: { anna: [{ id: 5 }], boris: [{ id: 10 }, { id: 9 }] },
            turnUid: 'boris',
        },
    };

    const left = leaveRoom(structuredClone(room), 'boris', 1000);
    assert.deepEqual(Object.keys(left.players), ['anna']);
    assert.deepEqual(Object.keys(left.game.hands), ['anna']);
    assert.deepEqual(
        left.game.deck.map((card) => card.id),
        [10, 9, 1, 2, 3, 4],
        'the hand goes under the deck'
    );
    assert.deepEqual(left.game.left.boris, { at: 1000 });
    assert.equal(left.game.turnUid, 'anna');

    const back = returnToGame(left.game, 'boris');
    assert.deepEqual(
        back.hands.boris.map((card) => card.id),
        [4, 3, 2],
        'the new hand comes from the top of the deck'
    );
    assert.deepEqual(
        back.deck.map((card) => card.id),
        [10, 9, 1]
    );
    assert.deepEqual(back.left, {});
    assert.equal(returnToGame(back, 'vera'), undefined, 'a stranger was not in the game');

    const finished = structuredClone(room);
    finished.game.finished = true;
    assert.equal(leaveRoom(finished, 'boris').game.left, undefined);
    assert.equal(leaveRoom({ owner: 'anna', players: { anna: {} } }, 'anna'), null, 'the last player removes the room');
});

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
        location: { pathname: '/bandito/', protocol: 'https:', origin: 'https://kipetsh.github.io' },
        history: { state: null, replaceState: () => {} },
        matchMedia: () => ({ matches: false }),
        fetch: () => new Promise(() => {}),
        requestAnimationFrame: () => 0,
        ResizeObserver: class {
            observe() {}
        },
        addEventListener: () => {},
    };
    await withGlobals({ ...globals, window: globals }, async () => {
        const { appReady } = await import(moduleUrl('js/main.js'));
        await appReady;
    });
});

test('a menu opens from its toggle and closes on an action, a click outside and Esc', async () => {
    const listeners = [];
    const fakeDocument = {
        activeElement: null,
        addEventListener: (type, handler, capture = false) => listeners.push({ type, handler, capture }),
    };
    const element = (id, parent = null) => {
        const el = {
            id,
            parent,
            attributes: {},
            handlers: {},
            classList: createClassList(),
            setAttribute: (name, value) => (el.attributes[name] = value),
            addEventListener: (type, handler) => (el.handlers[type] = handler),
            contains: (other) => other === el || (!!other?.parent && el.contains(other.parent)),
            closest: (selector) => (selector === 'button' && id.startsWith('button') ? el : null),
            focus: () => (fakeDocument.activeElement = el),
        };
        return el;
    };
    const fire = (type, event, target) => {
        target.handlers[type]?.(event);
        target.parent?.handlers[type]?.(event);
        listeners.filter((l) => l.type === type).forEach((l) => l.handler(event));
    };
    const toggle = element('button-toggle');
    const popover = element('popover');
    const action = element('button-action', popover);
    const outside = element('outside');
    popover.classList.add('hidden');

    await withGlobals({ document: fakeDocument }, async () => {
        const { createMenu, hideMenus } = await import(moduleUrl('js/menu.js'));
        const menu = createMenu(toggle, popover);
        const click = (target) => fire('click', { target }, target);

        click(toggle);
        assert.equal(menu.isOpen(), true);
        assert.equal(toggle.attributes['aria-expanded'], 'true');
        click(toggle);
        assert.equal(menu.isOpen(), false);

        click(toggle);
        click(action);
        assert.equal(menu.isOpen(), false, 'an action closes the menu');

        click(toggle);
        click(outside);
        assert.equal(menu.isOpen(), false, 'a click outside closes the menu');

        click(toggle);
        action.focus();
        let stopped = false;
        const escape = { key: 'Escape', target: action, preventDefault() {}, stopPropagation: () => (stopped = true) };
        listeners.filter((l) => l.type === 'keydown' && l.capture).forEach((l) => l.handler(escape));
        assert.equal(menu.isOpen(), false, 'Esc closes the menu');
        assert.equal(stopped, true, 'Esc does not reach the page handlers');
        await Promise.resolve();
        assert.equal(fakeDocument.activeElement, toggle, 'focus returns to the toggle');

        click(toggle);
        hideMenus();
        assert.equal(menu.isOpen(), false);
        assert.equal(toggle.attributes['aria-expanded'], 'false');
    });
});

test('a pressed mouse pointer does not clear the placement preview', async () => {
    const { shouldClearPlacementPreview } = await import(moduleUrl('js/game.js'));
    const mouseHover = { pointerType: 'mouse', buttons: 0 };

    assert.equal(shouldClearPlacementPreview(mouseHover, null), true);
    assert.equal(shouldClearPlacementPreview({ ...mouseHover, buttons: 1 }, null), false);
    assert.equal(shouldClearPlacementPreview(mouseHover, {}), false);
    assert.equal(shouldClearPlacementPreview({ ...mouseHover, pointerType: 'pen' }, null), false);
});

test('challenge placement validation reuses the game rules for connections and overlaps', async () => {
    const { validOnBoard, rotateMatrix } = await import(moduleUrl('js/game.js'));
    const board = [{ id: 1, x: 0, y: 0, m: [[1]] }];

    assert.equal(validOnBoard(board, [[1]], 1, 0), true);
    assert.equal(validOnBoard(board, [[0]], 1, 0), false);
    assert.equal(validOnBoard(board, [[1]], 0, 0), false);
    assert.equal(validOnBoard(board, [[1]], 5, 0), false);
    assert.deepEqual(rotateMatrix([[1, 0]], 1), [[1], [0]]);
});

test('Firebase challenge arrays normalize empty and numeric-key object values', async () => {
    const { normalizeChallengeArray } = await import(moduleUrl('js/game.js'));

    assert.deepEqual(normalizeChallengeArray(null), []);
    assert.deepEqual(normalizeChallengeArray([]), []);
    assert.deepEqual(normalizeChallengeArray({ 1: 'second', 0: 'first' }), ['first', 'second']);
    assert.deepEqual(normalizeChallengeArray({ invalid: 'ignored' }), []);
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

test('settings modal reveals a static backdrop blur without animating the filter', () => {
    const css = readFileSync(resolve(projectRoot, 'css/blocks/modal.css'), 'utf8');
    const keyframesStart = css.indexOf('@keyframes settings-backdrop-in');
    const keyframesEnd = css.indexOf('\n    .modal__dialog {', keyframesStart);
    const keyframes = css.slice(keyframesStart, keyframesEnd);

    assert.match(css, /content: ['"]{2};/);
    assert.ok(css.includes('backdrop-filter: blur(4px);'));
    assert.ok(css.includes('-webkit-backdrop-filter: blur(4px);'));
    assert.ok(css.includes('settings-backdrop-in 120ms'));
    assert.ok(css.includes('settings-backdrop-out 100ms'));
    assert.ok(css.includes('settings-panel-in 120ms'));
    assert.ok(css.includes('settings-panel-out 100ms'));
    assert.doesNotMatch(keyframes, /filter:/);
});
