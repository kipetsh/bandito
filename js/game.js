/* Single-player rules, board rendering, controls, and end screens. */
import { $ } from '#js/dom.js';
import { rememberOpener, returnFocus } from '#js/focus-return.js';
import { createMenu } from '#js/menu.js';
import { closeModal, isModalOpen, openModal } from '#js/modal.js';
import { applySettings, saveSettings } from '#js/settings.js';
import { snackbar } from '#js/snackbar.js';
import {
    leaveMultiplayer,
    mpExchange,
    mpLeaveForSolo,
    mpPlay,
    mpRoomCode,
    mpRoomData,
    mpStart,
    mpStopTimer,
    mpUid,
} from '#js/multiplayer.js';

const gameMenu = createMenu($('#gameMenuToggle'), $('#gameMenu'));

// Current game state; multiplayer.js replaces it from the room snapshot.
export const state = {
    all: [],
    deck: [],
    hand: [],
    placed: [],
    selected: -1,
    rotation: 0,
    finished: false,
    exits: 6,
    turnCount: 0,
    // The placement of the selected card shown on the board: a selected card always has one if it can be placed.
    placementPreview: null,
    lastPlaced: null,
    animateLastPlacement: false,
    tutorial: null,
    challenge: null,
};
let challengeEditorMode = false;
// The last key pressed; a press of a pointer clears it.
let lastKey = '';
// Whether the player uses touch: the last press, before any press the device's main pointer.
let touchInput = window.matchMedia('(pointer: coarse)').matches;
// A preview on the board: the arrows walk the placements of the selected card instead of the cards. It shows
// on a hover over a placement, a tap on one, Enter on the selected card and the keys 1/2/3.
const placing = () => !!state.placementPreview;
// The preview was picked from the keyboard or with a tap, not hovered: its pin is checked and the
// «Отмена» / «Поставить» buttons show.
let previewPicked = false;
// The discard button was shown at the last render.
let exchangeShown = false;
let challengeEditorSelectedPiece = -1;
const defaultStats = { games: 0, wins: 0, losses: 0, best: null };
let playerStats = {
    ...defaultStats,
    ...(() => {
        try {
            return (
                JSON.parse(localStorage.getItem('banditoStats') || localStorage.getItem('bandidoStats') || '{}') || {}
            );
        } catch {
            return {};
        }
    })(),
};
function saveStats() {
    localStorage.setItem('banditoStats', JSON.stringify(playerStats));
    updateStats();
}
function updateStats() {
    const set = (id, v) => {
        const el = $('#' + id);
        if (el) el.textContent = v;
    };
    set('gameWins', playerStats.wins);
    set('turnCount', state.turnCount);
}
function finishGame(won) {
    if (state.finished) return;
    state.finished = true;
    if (state.tutorial) return;
    playerStats.games++;
    if (won) {
        playerStats.wins++;
        if (playerStats.best === null || state.turnCount < playerStats.best) playerStats.best = state.turnCount;
    } else playerStats.losses++;
    saveStats();
}
export const clone = (m) => m.map((r) => r.slice());
function rot(m) {
    let h = m.length,
        w = m[0].length,
        o = Array.from({ length: w }, () => Array(h));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) o[x][h - 1 - y] = m[y][x];
    return o;
}
export function rotateMatrix(m, turns = 1) {
    let result = clone(m);
    for (let i = 0; i < ((turns % 4) + 4) % 4; i++) result = rot(result);
    return result;
}
function dims(m) {
    return [m[0].length, m.length];
}
let boardIndex = null,
    indexedBoard = null,
    indexedBoardSignature = '';
function ensureBoardIndex() {
    // A board snapshot can be updated in place without changing its array identity or length.
    // Include every piece's position and matrix in the cache key so legality never uses stale cells.
    const signature = state.placed
        .map((p) => p.x + ',' + p.y + ':' + p.m.map((row) => row.join('')).join('/'))
        .join(';');
    if (boardIndex && indexedBoard === state.placed && indexedBoardSignature === signature) return boardIndex;
    const index = new Map();
    for (const p of state.placed)
        for (let y = 0; y < p.m.length; y++)
            for (let x = 0; x < p.m[y].length; x++) index.set(p.x + x + ',' + (p.y + y), p.m[y][x]);
    boardIndex = index;
    indexedBoard = state.placed;
    indexedBoardSignature = signature;
    return index;
}
function cellAt(gx, gy) {
    const value = ensureBoardIndex().get(gx + ',' + gy);
    return value === undefined ? null : value;
}
function validAgainstBoard(placed, index, m, x, y) {
    const [w, h] = dims(m);
    // A card occupies its entire rectangular footprint, including wall cells.
    // Checking piece bounds explicitly prevents a stale/missing cell index from
    // allowing a card to be squeezed into a gap that is smaller than the card.
    for (const p of placed) {
        const [pw, ph] = dims(p.m);
        if (x < p.x + pw && x + w > p.x && y < p.y + ph && y + h > p.y) return false;
    }
    let connected = false;
    for (let yy = 0; yy < h; yy++)
        for (let xx = 0; xx < w; xx++) {
            if (index.has(x + xx + ',' + (y + yy))) return false;
            const value = m[yy][xx];
            for (const [dx, dy] of [
                [0, -1],
                [0, 1],
                [-1, 0],
                [1, 0],
            ]) {
                const adjacent = index.get(x + xx + dx + ',' + (y + yy + dy));
                if (adjacent === undefined) continue;
                if (adjacent !== value) return false;
                if (adjacent === 1 && value === 1) connected = true;
            }
        }
    return connected;
}
export function validOnBoard(placed, m, x, y) {
    const index = new Map();
    for (const p of placed)
        for (let yy = 0; yy < p.m.length; yy++)
            for (let xx = 0; xx < p.m[yy].length; xx++) index.set(p.x + xx + ',' + (p.y + yy), p.m[yy][xx]);
    return validAgainstBoard(placed, index, m, x, y);
}
export function valid(m, x, y) {
    return validAgainstBoard(state.placed, ensureBoardIndex(), m, x, y);
}
export function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
        let j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
function draw() {
    while (state.hand.length < 3 && state.deck.length) state.hand.push(state.deck.pop());
}
// The status while no card is selected: how to select one with the mouse, a tap or the keyboard;
// on a touch device it does not mention the keyboard.
export const chooseCardMessage = 'Выбери карту для хода в руке, либо ←→ и Enter.';
export const chooseCardTouchMessage = 'Выбери карту для хода в руке.';
// The status while a card is selected from the keyboard and its placements wait for Enter.
const confirmCardMessage = 'Выбери положение карты на поле, либо Enter, чтобы перейти к положениям.';
// The status while the placements of the selected card are chosen with the pointer or the keyboard.
const choosePlacementMessage = 'Выбери положение карты на поле, либо ←→ и Enter.';
const choosePlacementTouchMessage = 'Выбери положение карты на поле и нажми «Поставить».';
// Sets the status line; a status that mentions the keyboard gives a text without it for touch.
export function status(t, k = '', touch = t) {
    if (challengeEditorMode) return;
    $('#status').textContent = touchInput ? touch : t;
    $('#status').classList.toggle('hidden', k === 'win' || k === 'lose');
}
// The status of the current selection step. With no moves at all the status of the discard stays.
function selectionStatus() {
    if (!$('#exchange').disabled) return;
    if (state.selected < 0) status(chooseCardMessage, '', chooseCardTouchMessage);
    else if (!boardTargets.length) status('Этой карте некуда встать. Выбери другую карту.');
    else if (placing()) status(choosePlacementMessage, '', choosePlacementTouchMessage);
    else status(confirmCardMessage, '', choosePlacementTouchMessage);
}
// The line under the heading: the task of a tutorial level or the description of a challenge. A plain game has
// none, its hints are in the status and «?»: the empty line goes and the board takes its room.
export function setSubtitle(text = '', tutorial = false) {
    $('#gameSubtitle').textContent = text;
    $('#gameSubtitle').classList.toggle('game__subtitle--tutorial', tutorial);
    $('#gameSubtitleRow').classList.toggle('game__subtitle-row--empty', !text);
}
export function opens() {
    let n = 0;
    for (const p of state.placed) {
        const [w, h] = dims(p.m);
        for (let yy = 0; yy < h; yy++)
            for (let xx = 0; xx < w; xx++)
                if (p.m[yy][xx] === 1)
                    for (const [dx, dy] of [
                        [0, -1],
                        [0, 1],
                        [-1, 0],
                        [1, 0],
                    ])
                        if (cellAt(p.x + xx + dx, p.y + yy + dy) === null) n++;
    }
    return n;
}
async function begin(n) {
    if (!state.all.length) return;
    state.tutorial = null;
    state.challenge = null;
    resetEndScreen();
    // The solo modes stay clickable next to the coop lobby: a solo game leaves the room first,
    // otherwise the room's turn order keeps every card in the hand disabled.
    await mpLeaveForSolo();
    mpStopTimer();
    state.exits = n;
    let s = state.all.find((c) => c.id === (n === 2 ? 75 : n === 6 ? 71 : 72));
    state.deck = shuffle(state.all.filter((c) => c.kind === 'tunnel').map((c) => ({ id: c.id, m: clone(c.matrix) })));
    state.hand = [];
    state.placed = [{ id: s.id, x: 0, y: 0, m: clone(s.matrix) }];
    state.lastPlaced = null;
    state.animateLastPlacement = false;
    state.selected = -1;
    state.rotation = 0;
    state.finished = false;
    state.turnCount = 0;
    state.placementPreview = null;
    draw();
    $('#menu').classList.add('hidden');
    $('#play').classList.remove('hidden');
    $('#heading').textContent = n === 2 ? 'Bandito · лёгкая партия' : 'Bandito · ' + n + ' выходов';
    $('#tutorialGoal').classList.add('hidden');
    setSubtitle();
    status(chooseCardMessage, '', chooseCardTouchMessage);
    render();
    centerCamera();
    startHand();
}
export function normalizeChallengeArray(value) {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== 'object') return [];
    return Object.keys(value)
        .filter((key) => /^(0|[1-9]\d*)$/.test(key))
        .sort((a, b) => Number(a) - Number(b))
        .map((key) => value[key]);
}
export async function beginChallenge(challenge) {
    if (!state.all.length || !challenge) return false;
    const boardData = normalizeChallengeArray(challenge.board);
    const handData = normalizeChallengeArray(challenge.hand);
    const deckData = normalizeChallengeArray(challenge.deck);
    const exits = Number(challenge.exits),
        startId = { 2: 75, 5: 72, 6: 71 }[exits],
        start = state.all.find((card) => card.id === startId),
        cardById = new Map(state.all.filter((card) => card.kind === 'tunnel').map((card) => [card.id, card]));
    if (!start || boardData.length < 1 || boardData.length > 73) {
        snackbar('В испытании повреждена стартовая раскладка.', 'error');
        return false;
    }
    if (
        handData.length > 3 ||
        handData.some((id) => !cardById.has(Number(id))) ||
        deckData.length > 72 ||
        deckData.some((id) => !cardById.has(Number(id)))
    ) {
        snackbar('В испытании повреждены стартовая рука или колода добора.', 'error');
        return false;
    }
    const placed = [];
    for (let index = 0; index < boardData.length; index++) {
        const piece = boardData[index];
        if (!piece || typeof piece !== 'object') {
            snackbar('В испытании повреждена раскладка поля.', 'error');
            return false;
        }
        const card = index === 0 ? start : cardById.get(Number(piece.id)),
            x = Number(piece.x),
            y = Number(piece.y),
            rotation = Number(piece.rotation || 0);
        if (
            !card ||
            !Number.isInteger(x) ||
            !Number.isInteger(y) ||
            x < -48 ||
            y < -28 ||
            !Number.isInteger(rotation) ||
            rotation < 0 ||
            rotation > 3 ||
            (index === 0 && (Number(piece.id) !== startId || x !== 0 || y !== 0 || rotation !== 0))
        ) {
            snackbar('В испытании повреждена раскладка поля.', 'error');
            return false;
        }
        const matrix = rotateMatrix(card.matrix, rotation);
        if (
            x + matrix[0].length > 52 ||
            y + matrix.length > 32 ||
            (index > 0 && placed.some((placedPiece) => placedPiece.id === card.id)) ||
            (index > 0 && !validOnBoard(placed, matrix, x, y))
        ) {
            snackbar('В испытании есть карта, которая не соединяется с полем по правилам.', 'error');
            return false;
        }
        placed.push({ id: card.id, x, y, m: matrix });
    }
    const usedIds = new Set(placed.map((piece) => piece.id));
    for (const id of handData.concat(deckData)) {
        const cardId = Number(id);
        if (!cardById.has(cardId) || usedIds.has(cardId)) {
            snackbar('В испытании одна и та же карта указана в нескольких местах.', 'error');
            return false;
        }
        usedIds.add(cardId);
    }
    const hand = handData.map((id) => {
        const card = cardById.get(Number(id));
        return { id: card.id, m: clone(card.matrix) };
    });
    const deck = deckData.map((id) => {
        const card = cardById.get(Number(id));
        return { id: card.id, m: clone(card.matrix) };
    });
    await mpLeaveForSolo();
    mpStopTimer();
    resetEndScreen();
    state.tutorial = null;
    state.challenge = {
        id: challenge.id || null,
        title: String(challenge.title || 'Пользовательское испытание').slice(0, 60),
        description: String(challenge.description || '').slice(0, 240),
        exits,
        board: boardData.map((piece) => ({
            id: Number(piece.id),
            x: Number(piece.x),
            y: Number(piece.y),
            rotation: Number(piece.rotation || 0),
        })),
        hand: handData.map(Number),
        deck: deckData.map(Number),
    };
    state.exits = exits;
    state.deck = shuffle(deck);
    state.hand = hand;
    state.placed = placed;
    state.lastPlaced = null;
    state.animateLastPlacement = false;
    state.selected = -1;
    state.rotation = 0;
    state.finished = false;
    state.turnCount = 0;
    state.placementPreview = null;
    $('#menu').classList.add('hidden');
    $('#mpLobby').classList.add('hidden');
    $('#play').classList.remove('hidden');
    gameMenu.hide();
    $('#heading').textContent = 'Bandito · ' + state.challenge.title;
    $('#tutorialGoal').classList.add('hidden');
    setSubtitle(state.challenge.description || 'Пользовательское испытание · закрой все выходы.');
    status(chooseCardMessage, '', chooseCardTouchMessage);
    render();
    centerCamera();
    startHand();
    return true;
}
const tutorialLevels = [
    {
        start: 75,
        exits: 2,
        cards: [45, 65],
        subtitle: 'Уровень 1 · Поставь Г-образную и прямую карты, чтобы закрыть оба выхода.',
        status: 'Выбери карту в руке, затем подходящий поворот на поле.',
    },
    {
        start: 75,
        exits: 2,
        cards: [17, 22, 14, 19, 20, 24, 45, 65],
        subtitle: 'Уровень 2 · Соедини выходы простым маршрутом из прямых участков и поворотов.',
        status: 'Начни с простых карт и постепенно соедини оба выхода. Необязательно использовать все карты.',
    },
    {
        start: 75,
        exits: 2,
        cards: [17, 22, 14, 19, 20, 24, 27, 30, 15, 26, 3, 4, 45, 65],
        subtitle: 'Уровень 3 · Построй более сложный маршрут, сочетая прямые участки, повороты и развилки.',
        status: 'Используй разные формы карт и соединяй участки постепенно. Выходы оставь напоследок.',
    },
];

async function startTutorial(levelNumber) {
    const level = tutorialLevels[levelNumber - 1];
    if (!level || !state.all.length) return;
    rememberWelcomeChoice();
    returnFocus(welcomeModal);
    resetEndScreen();
    await mpLeaveForSolo();
    mpStopTimer();
    const cardFor = (id) => {
        const card = state.all.find((item) => item.id === id);
        return card ? { id: card.id, m: clone(card.matrix) } : null;
    };
    const startCard = cardFor(level.start);
    const cards = level.cards.map(cardFor);
    if (!startCard || cards.some((card) => !card)) {
        snackbar('Не удалось загрузить карты обучения.', 'error');
        return;
    }
    state.tutorial = { level: levelNumber };
    state.challenge = null;
    state.exits = level.exits;
    state.deck = cards.slice(3).reverse();
    state.hand = cards.slice(0, 3);
    state.placed = [{ id: startCard.id, x: 0, y: 0, m: startCard.m }];
    state.lastPlaced = null;
    state.animateLastPlacement = false;
    state.selected = -1;
    state.rotation = 0;
    state.finished = false;
    state.turnCount = 0;
    state.placementPreview = null;
    $('#menu').classList.add('hidden');
    $('#mpLobby').classList.add('hidden');
    $('#play').classList.remove('hidden');
    $('#heading').textContent = 'Обучение · ' + levelNumber + ' уровень';
    $('#tutorialGoal').classList.remove('hidden');
    setSubtitle(level.subtitle, true);
    gameMenu.hide();
    status(level.status);
    render();
    centerCamera();
    startHand();
}

function rotated(m, r) {
    let a = clone(m);
    for (let i = 0; i < r; i++) a = rot(a);
    return a;
}
function legalSpots(m) {
    const [w, h] = dims(m),
        candidates = new Set();
    for (const p of state.placed)
        for (let py = 0; py < p.m.length; py++)
            for (let px = 0; px < p.m[py].length; px++) {
                if (p.m[py][px] !== 1) continue;
                for (const [dx, dy] of [
                    [0, -1],
                    [0, 1],
                    [-1, 0],
                    [1, 0],
                ])
                    for (let y = 0; y < h; y++)
                        for (let x = 0; x < w; x++) {
                            if (m[y][x] !== 1) continue;
                            candidates.add(p.x + px + dx - x + ',' + (p.y + py + dy - y));
                        }
            }
    const spots = [];
    for (const key of candidates) {
        const comma = key.indexOf(','),
            x = Number(key.slice(0, comma)),
            y = Number(key.slice(comma + 1));
        if (valid(m, x, y)) spots.push([x, y]);
    }
    return spots;
}
export function canPlayAny() {
    return state.hand.some((card) => [0, 1, 2, 3].some((r) => legalSpots(rotated(card.m, r)).length > 0));
}
// The placed cards plus boardMargin cells on each side (1.5 card lengths) form the play area.
// The board is the play area joined with the camera's view: a play area inside the view does not scroll,
// a part outside the view can be scrolled to.
const boardMargin = 9;
// Board px of cell (0, 0) and the cell size at the last render. A new card keeps the view where it was,
// so the cards stay at the same place on the screen; the zoom and a resize keep the cell in the middle.
let boardOrigin = null;
// Centres the play area in the camera (a new game).
export function centerCamera() {
    boardOrigin = null;
    render({ hand: false });
}
// A resize keeps the zoom in percent (100% differs on narrow screens).
window.addEventListener('resize', () => {
    const base = baseCellSize();
    if (base === zoomBase) return;
    cellSize = clampCell(Math.round((cellSize * base) / zoomBase / 2) * 2);
    zoomBase = base;
    // Crossing the narrow breakpoint turns the cards in the hand, so the hand is rebuilt too.
    if (!$('#play').classList.contains('hidden')) render({ hand: !challengeEditorMode });
});
// The view changes with the window and, on a phone, with the bottom sheet (the discard button slides in). The cell
// in the middle of the view stays put at once; the board is re-rendered once the size settles, not on every frame.
let cameraSize = { w: 0, h: 0 },
    cameraResizeTimer = 0,
    // The scroll that keeps the middle cell: a growing view cannot scroll past the old board, so the next render
    // takes this one instead of the clamped scroll of the camera.
    cameraScroll = null;
new ResizeObserver(() => {
    const camera = $('#camera'),
        w = camera.clientWidth,
        h = camera.clientHeight,
        prev = cameraSize;
    cameraSize = { w, h };
    // Showing or hiding the game: a new game centres the camera itself.
    if (!prev.w || !prev.h || !w || !h || !boardOrigin) return;
    const left = (cameraScroll?.left ?? camera.scrollLeft) + (boardOrigin.w - w) / 2,
        top = (cameraScroll?.top ?? camera.scrollTop) + (boardOrigin.h - h) / 2;
    cameraScroll = { left, top };
    camera.scrollLeft = left;
    camera.scrollTop = top;
    boardOrigin.w = w;
    boardOrigin.h = h;
    clearTimeout(cameraResizeTimer);
    cameraResizeTimer = setTimeout(() => {
        if (!$('#play').classList.contains('hidden')) render({ hand: false });
    }, 150);
}).observe($('#camera'));
// hand: false keeps the hand as it is (zoom changes only the board).
export function render({ hand = true } = {}) {
    const camera = $('#camera'),
        savedLeft = cameraScroll?.left ?? (camera?.scrollLeft || 0),
        savedTop = cameraScroll?.top ?? (camera?.scrollTop || 0);
    cameraScroll = null;
    if (state.selected >= state.hand.length) state.selected = -1;
    if (state.finished) state.selected = -1;
    // Spots touch the placed cards, so they always lie inside the margin.
    const minX = Math.min(...state.placed.map((p) => p.x)) - boardMargin,
        minY = Math.min(...state.placed.map((p) => p.y)) - boardMargin,
        maxX = Math.max(...state.placed.map((p) => p.x + dims(p.m)[0])) + boardMargin,
        maxY = Math.max(...state.placed.map((p) => p.y + dims(p.m)[1])) + boardMargin;
    const legalByRotation = placementOptions();
    const c = cellSize,
        b = $('#board'),
        viewW = camera?.clientWidth || 0,
        viewH = camera?.clientHeight || 0,
        // The view's top left corner in px of the current scale, measured from cell (0, 0).
        viewX = Math.round(
            boardOrigin
                ? ((savedLeft + boardOrigin.w / 2 - boardOrigin.x) / boardOrigin.c) * c - viewW / 2
                : ((minX + maxX) / 2) * c - viewW / 2
        ),
        viewY = Math.round(
            boardOrigin
                ? ((savedTop + boardOrigin.h / 2 - boardOrigin.y) / boardOrigin.c) * c - viewH / 2
                : ((minY + maxY) / 2) * c - viewH / 2
        ),
        left = Math.min(minX * c, viewX),
        top = Math.min(minY * c, viewY),
        right = Math.max(maxX * c, viewX + viewW),
        bottom = Math.max(maxY * c, viewY + viewH),
        padX = minX * c - left,
        padY = minY * c - top,
        scrollLeft = viewX - left,
        scrollTop = viewY - top;
    boardOrigin = { x: -left, y: -top, c, w: viewW, h: viewH };
    b.innerHTML = '';
    b.style.width = right - left + 'px';
    b.style.height = bottom - top + 'px';
    b.style.setProperty('--board-cell', c + 'px');
    // The pins grow with the zoom more gently than the cells: 12px at the smallest zoom, 20px at the largest,
    // in whole 2px steps, so the pin stays centred in its 40px box without half pixels.
    const zoomShare = (c - clampCell(0)) / (clampCell(Infinity) - clampCell(0)),
        pinSize = 12 + 2 * Math.round(4 * zoomShare);
    b.style.setProperty('--board-pin-size', pinSize + 'px');
    for (const [pieceIndex, p] of state.placed.entries()) {
        const [w, h] = dims(p.m),
            el = document.createElement('div');
        const isLatest =
            !!state.lastPlaced &&
            p.id === state.lastPlaced.id &&
            p.x === state.lastPlaced.x &&
            p.y === state.lastPlaced.y;
        const animateThis = isLatest && state.animateLastPlacement;
        el.className =
            'board__piece' +
            (isLatest && p !== state.placed[0] ? ' board__piece--latest' : '') +
            (animateThis ? ' board__piece--fresh' : '');
        // In the editor a placed card is picked to be removed; the start card stays, so it is not pickable.
        if (challengeEditorMode && pieceIndex > 0) {
            el.classList.add('challenge-editor__piece');
            el.dataset.editorPieceIndex = String(pieceIndex);
            el.tabIndex = 0;
            el.setAttribute('role', 'button');
            el.setAttribute('aria-label', 'Выбрать карту ' + p.id);
            el.classList.toggle('challenge-editor__piece--selected', pieceIndex === challengeEditorSelectedPiece);
        }
        if (animateThis) state.animateLastPlacement = false;
        el.style.cssText = `left:${padX + (p.x - minX) * c}px;top:${padY + (p.y - minY) * c}px;width:${w * c}px;height:${h * c}px;grid-template-columns:repeat(${w},${c}px);grid-template-rows:repeat(${h},${c}px)`;
        p.m.flat().forEach((v) => {
            const q = document.createElement('i');
            q.className = 'board__cell' + (v ? '' : ' board__cell--wall');
            el.append(q);
        });
        b.append(el);
    }
    const canAct = !mpRoomCode || mpRoomData?.game?.turnUid === mpUid;
    const hasMoves = canAct && !state.finished && state.hand.length > 0 && canPlayAny();
    if (hand) renderHand(canAct);
    $('#deckcount').textContent = state.deck.length;
    $('#openCount').textContent = opens();
    $('#turnCount').textContent = state.turnCount;
    const canExchange = !challengeEditorMode && !state.finished && canAct && state.hand.length > 0 && !hasMoves;
    $('#exchange').disabled = !canExchange;
    $('#exchange').classList.toggle('is-visible', canExchange);
    $('#exchange').setAttribute('aria-hidden', String(!canExchange));
    // With no moves left the only action is the discard: it gets focus when it appears.
    if (canExchange && !exchangeShown) $('#exchange').focus({ preventScroll: true });
    exchangeShown = canExchange;
    $('#zoomLevel').textContent = Math.round((cellSize / zoomBase) * 100) + '%';
    if (!challengeEditorMode && !mpRoomCode && canAct && !state.finished && state.hand.length > 0 && !hasMoves) {
        if (!state.deck.length) {
            finishGame(false);
            status('Поражение. Нет доступных ходов, а колода пуста.', 'lose');
            showEndScreen(false);
        } else status('Нет доступных ходов. Нажми «Сбросить карты», чтобы получить новые.');
    }
    boardTargets = [];
    if (state.selected >= 0 && state.hand[state.selected] && !state.finished && canAct) {
        const ghost = document.createElement('div');
        ghost.className = 'board__piece board__piece--ghost hidden';
        ghost.dataset.ghost = '';
        b.append(ghost);
        const pinOffset = pinOffsetsFor(legalByRotation);
        for (let r = 0; r < legalByRotation.length; r++) {
            const { m, w: mw, h: mh, spots } = legalByRotation[r];
            for (const [sx, sy] of spots) {
                const [ox, oy] = pinOffset(r, sx, sy),
                    left = padX + (sx - minX) * c,
                    top = padY + (sy - minY) * c,
                    pin = document.createElement('span');
                // The pin only marks the spot: the board picks the placement under the cursor (targetAt()).
                pin.className = 'board__pin board__pin--' + r;
                pin.setAttribute('aria-hidden', 'true');
                pin.dataset.spot = sx + ',' + sy + ',' + r;
                pin.style.cssText =
                    'left:' + (left + (mw * c) / 2 - 20 + ox) + 'px;top:' + (top + (mh * c) / 2 - 20 + oy) + 'px';
                const show = () => {
                    ghost.innerHTML = '';
                    ghost.style.width = mw * c + 'px';
                    ghost.style.height = mh * c + 'px';
                    ghost.style.gridTemplateColumns = 'repeat(' + mw + ',' + c + 'px)';
                    ghost.style.gridTemplateRows = 'repeat(' + mh + ',' + c + 'px)';
                    m.flat().forEach((v) => {
                        const q = document.createElement('i');
                        q.className = 'board__cell' + (v ? '' : ' board__cell--wall');
                        ghost.append(q);
                    });
                    ghost.classList.remove('hidden');
                    ghost.style.left = left + 'px';
                    ghost.style.top = top + 'px';
                };
                const target = { x: sx, y: sy, r, m, pin, show };
                // The card's box and its pin centre, in px of the board.
                Object.assign(target, { left, top, w: mw * c, h: mh * c });
                Object.assign(target, { px: left + (mw * c) / 2 + ox, py: top + (mh * c) / 2 + oy });
                boardTargets.push(target);
                b.append(pin);
            }
        }
    }
    if (camera) {
        camera.scrollLeft = scrollLeft;
        camera.scrollTop = scrollTop;
    }
    // The selected card keeps its preview; a new one appears only on a hover, a tap or the keyboard (see setPreview()).
    const preview = state.placementPreview,
        previewed = preview && targetFor(preview);
    syncPlacementOptions();
    if (previewed) setPreview(previewed, previewPicked);
    else {
        state.placementPreview = null;
        previewPicked = false;
        if (state.selected >= 0 && boardTargets.length) selectionStatus();
    }
    showPlacementPanel();
    b.classList.toggle('board--pointing', !!targetAt(cursor));
    requestAnimationFrame(() => {
        if (camera) {
            camera.scrollLeft = scrollLeft;
            camera.scrollTop = scrollTop;
        }
    });
}

// Each card in the hand lies at 0° or 180°, chosen at random once per card id, so a rebuild keeps it.
const handFlips = new Map();
function handFlip(id) {
    if (!handFlips.has(id)) handFlips.set(id, Math.random() < 0.5 ? 0 : 2);
    return handFlips.get(id);
}
// The hand is rendered separately from the board: zooming re-renders only the board. The cards that stay in the hand
// are kept and updated in place: a new element under a resting cursor would lose :hover for a moment and the hovered
// card would blink, focus would be lost and the transitions would not run.
// Each card is a label around a hidden native radio: Tab enters the group once (on the checked card, else on the
// first one, which stays unchecked) and the arrows move the check, as in any radio group.
function renderHand(canAct) {
    const hand = $('#hand');
    // Cards stand upright on wide screens and lie flat in the narrow bottom sheet.
    const upright = narrowScreen() ? 0 : 1;
    const kept = new Map([...hand.children].map((card) => [Number(card.dataset.cardId), card]));
    for (const [id, card] of kept) if (!state.hand.some((c) => c.id === id)) card.remove();
    state.hand.forEach((card, i) => {
        let label = kept.get(card.id);
        if (!label) {
            label = document.createElement('label');
            label.className = 'hand-card hand-card--fresh';
            label.dataset.cardId = card.id;
            const input = document.createElement('input');
            input.type = 'radio';
            input.name = 'handCard';
            input.className = 'visually-hidden';
            input.setAttribute('aria-label', 'Карта ' + card.id);
            label.append(input);
            // A hovering pointer and focus from the keyboard (Tab, arrows) point at the card; touch does not hover.
            label.addEventListener('pointerenter', (e) => e.pointerType !== 'touch' && pointCard(card.id));
            label.addEventListener('pointerleave', () => pointedCardId === card.id && pointCard(null));
            input.addEventListener('focus', () => input.matches(':focus-visible') && pointCard(card.id));
            input.addEventListener(
                'blur',
                () => pointedCardId === card.id && !label.matches(':hover') && pointCard(null)
            );
        }
        const input = label.querySelector('input'),
            disabled = state.finished || !canAct;
        input.disabled = disabled;
        input.checked = i === state.selected;
        label.classList.toggle('hand-card--disabled', disabled);
        label.classList.toggle('hand-card--selected', i === state.selected);
        label.classList.toggle('hand-card--pointed', card.id === pointedCardId && !disabled);
        // The miniature is drawn again only when the card turns between upright and flat.
        if (label.dataset.upright !== String(upright)) {
            const m = rotated(card.m, upright + handFlip(card.id)),
                mini = document.createElement('span');
            mini.className = 'hand-card__mini';
            mini.style.cssText = `grid-template-columns:repeat(${m[0].length},var(--hand-card-size));grid-template-rows:repeat(${m.length},var(--hand-card-size))`;
            m.flat().forEach((v) => {
                const q = document.createElement('i');
                q.className = 'hand-card__cell' + (v ? '' : ' hand-card__cell--wall');
                mini.append(q);
            });
            input.nextElementSibling?.remove();
            label.append(mini);
            label.dataset.upright = upright;
        }
        // Kept cards are already in order: moving a node would drop its focus and hover.
        if (hand.children[i] !== label) hand.insertBefore(label, hand.children[i] ?? null);
    });
}
const handInputs = () => [...$('#hand').querySelectorAll('input')];
// The card under a hovering pointer or under the keyboard focus, whichever came last: a hover over another card
// takes the highlight from the card the arrows moved to, as one mouse cursor would. The lit card shows that
// the hand has focus.
let pointedCardId = null;
function pointCard(id) {
    pointedCardId = id;
    for (const card of $('#hand').children)
        card.classList.toggle(
            'hand-card--pointed',
            Number(card.dataset.cardId) === id && !card.classList.contains('hand-card--disabled')
        );
}
// The deal animation class stays on the card until the animation ends, so a render in the middle does not cut it off.
$('#hand').addEventListener('animationend', (e) => {
    if (e.animationName === 'hand-card-deal') e.target.classList.remove('hand-card--fresh');
});
// A click, a tap or the arrows (they check the next radio natively and click it too) select a card: its pins show,
// and a hover, a tap on a placement or Enter shows its preview. A click on the selected card keeps it.
$('#hand').addEventListener('click', (e) => {
    const input = e.target.closest?.('input');
    if (!input || input.disabled) return;
    selectCard(handInputs().indexOf(input));
});
// Tab into the hand from the placement buttons goes back to choosing a card.
$('#hand').addEventListener('focusin', () => {
    if (!focusingHand && lastKey === 'Tab' && placing() && state.selected >= 0) leavePlacements(false);
});

// The last ways of input: the controls follow the last press, not the screen width. A tap previews a placement
// and waits for «Поставить», a mouse hovers and places with a click, the keyboard walks the radio groups.
document.addEventListener(
    'pointerdown',
    (e) => {
        lastKey = '';
        touchInput = e.pointerType === 'touch';
    },
    true
);
document.addEventListener(
    'keydown',
    (e) => {
        lastKey = e.key;
        if (!['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) touchInput = false;
    },
    true
);
// The last position of a hovering pointer on the screen: confirming a card from the keyboard previews the placement
// under it. Touch does not hover.
let cursor = null;
document.addEventListener(
    'pointermove',
    (e) => {
        cursor = e.pointerType === 'touch' ? null : { x: e.clientX, y: e.clientY };
    },
    true
);
// A cursor that left the window is not over the board any more.
document.addEventListener('pointerout', (e) => !e.relatedTarget && (cursor = null), true);

// Placements of the selected card drawn by the last render(): card box and pin centre in px of the board.
let boardTargets = [];
export function setChallengeEditorMode(enabled, selectedPiece = -1) {
    challengeEditorMode = Boolean(enabled);
    challengeEditorSelectedPiece = challengeEditorMode ? selectedPiece : -1;
    if (!challengeEditorMode) boardTargets = [];
}
// The placement under a point of the screen: any point of a possible card counts, and where the cards of several
// placements overlap, the one with the pin nearest to the point wins. The point must be on the board itself,
// not under a button or the edge of the camera.
function targetAt(point) {
    if (!point || !boardTargets.length || !document.elementFromPoint(point.x, point.y)?.closest('#board')) return null;
    const box = $('#board').getBoundingClientRect(),
        x = point.x - box.left,
        y = point.y - box.top;
    let best = null,
        bestDistance = Infinity;
    for (const t of boardTargets) {
        if (x < t.left || x >= t.left + t.w || y < t.top || y >= t.top + t.h) continue;
        const distance = Math.hypot(x - t.px, y - t.py);
        if (distance < bestDistance) [best, bestDistance] = [t, distance];
    }
    return best;
}
function targetFor({ x, y, r }) {
    return boardTargets.find((t) => t.x === x && t.y === y && t.r === r);
}
const isPreviewed = (t) => {
    const p = state.placementPreview;
    return !!p && t.x === p.x && t.y === p.y && t.r === p.r;
};
export function shouldClearPlacementPreview(event, target) {
    return event.pointerType === 'mouse' && event.buttons === 0 && !target;
}

// Shows a placement of the selected card: its ghost and its pin enlarged. Only the board pieces change, so a hover
// does not re-render the board. A picked preview (the keyboard, a tap) also checks its radio and shows
// the «Отмена» / «Поставить» buttons; a hovered one does not: the mouse places the card with a click.
function setPreview(target, picked = false) {
    const { x, y, r } = target;
    state.rotation = r;
    state.placementPreview = { x, y, r };
    previewPicked = picked;
    for (const t of boardTargets) t.pin.classList.toggle('board__pin--preview', t === target);
    target.show();
    checkPlacementOption();
    // A hover moves focus from the hand to its placement unchecked, so the native arrows step from it.
    const active = document.activeElement;
    if (!picked && (active === document.body || active?.closest('#hand, #placementOptions'))) focusPlacements();
    showPlacementPanel();
    selectionStatus();
}
function clearPlacementPreview() {
    if (!state.placementPreview) return;
    state.placementPreview = null;
    previewPicked = false;
    for (const t of boardTargets) t.pin.classList.remove('board__pin--preview');
    $('#board [data-ghost]')?.classList.add('hidden');
    checkPlacementOption();
    showPlacementPanel();
    // No preview: the arrows choose a card again.
    if (placementFocused()) focusHand();
    if (state.selected >= 0) selectionStatus();
}
// The placement buttons show with a picked preview. A hidden panel drops its focus: it goes back to the placements.
function showPlacementPanel() {
    const panel = $('#placementPreview'),
        shown = !!state.placementPreview && previewPicked,
        focused = panel.contains(document.activeElement);
    panel.classList.toggle('hidden', !shown);
    if (!shown && focused) focusPlacements();
}
// The placements of the selected card as a hidden native radio group, in the order of the circle. While placing,
// focus stays in it: the arrows check the next placement natively (with nothing checked, the one after the focused
// radio), and Tab enters and leaves the group at once. The group is rebuilt only when the placements change,
// so focus survives a zoom.
function syncPlacementOptions() {
    const group = $('#placementOptions'),
        cycle = challengeEditorMode ? [] : placementCycle().filter((p) => targetFor(p)),
        keys = cycle.map(({ x, y, r }) => x + ',' + y + ',' + r).join(' ');
    if (group.dataset.keys !== keys) {
        const focused = group.contains(document.activeElement);
        group.replaceChildren(
            ...cycle.map(({ x, y, r }, i) => {
                const input = document.createElement('input');
                input.type = 'radio';
                input.name = 'placement';
                input.dataset.spot = x + ',' + y + ',' + r;
                input.setAttribute('aria-label', 'Положение ' + (i + 1) + ' из ' + cycle.length);
                return input;
            })
        );
        group.dataset.keys = keys;
        if (focused) focusPlacements();
    }
    checkPlacementOption();
}
function checkPlacementOption() {
    const spot = previewPicked ? previewSpot() : '';
    for (const input of $('#placementOptions').children) input.checked = input.dataset.spot === spot;
}
function previewSpot() {
    const p = state.placementPreview;
    return p ? p.x + ',' + p.y + ',' + p.r : '';
}
const placementFocused = () => $('#placementOptions').contains(document.activeElement);
// Focus goes to the checked placement, else to the hovered one, else to the first; with no placements, to the hand.
function focusPlacements() {
    const spot = previewSpot(),
        inputs = [...$('#placementOptions').children],
        input = inputs.find((i) => i.checked) || inputs.find((i) => i.dataset.spot === spot) || inputs[0];
    if (placing() && input) input.focus({ preventScroll: true });
    else focusHand();
}
// The arrows check the next placement natively: it is picked.
$('#placementOptions').addEventListener('change', (e) => {
    const [x, y, r] = e.target.dataset.spot.split(',').map(Number),
        target = targetFor({ x, y, r });
    if (!target) return;
    setPreview(target, true);
    revealPreview();
});
const boardEl = $('#board');
let boardPointer = '';
// A hovering pointer moves the preview to the placement under it, as the arrows do; the buttons of a picked preview
// hide. Moving off the placements clears a hovered preview and keeps a picked one.
boardEl.addEventListener('pointermove', (e) => {
    // A move with a button pressed is a drag of the camera or a touch, not a hover.
    const target = e.buttons ? null : targetAt({ x: e.clientX, y: e.clientY }),
        position = e.screenX + ',' + e.screenY,
        // Chrome repeats a pointermove without a move after a render: a resting cursor does not take the preview
        // back from the arrows.
        moved = position !== boardPointer;
    boardPointer = position;
    boardEl.classList.toggle('board--pointing', !!target);
    if (target && moved && !isPreviewed(target)) setPreview(target);
    else if (!previewPicked && shouldClearPlacementPreview(e, target)) clearPlacementPreview();
});
boardEl.addEventListener('pointerleave', (e) => {
    boardEl.classList.remove('board--pointing');
    if (e.pointerType === 'mouse' && !previewPicked) clearPlacementPreview();
});
// A press on a placement must not take focus from the hand or the placement buttons.
boardEl.addEventListener('mousedown', (e) => {
    if (targetAt({ x: e.clientX, y: e.clientY })) e.preventDefault();
});
// The kind of pointer that pressed the board last: the click after it does not tell it everywhere.
let pressType = '';
boardEl.addEventListener('pointerdown', (e) => {
    pressType = e.pointerType;
});
// A click on the shown placement places the card, on another one shows it. A hovering mouse has already shown
// the placement under it, so one click places the card. A tap (a finger or a stylus) picks the placement and focuses
// «Поставить»: the card is placed with the button, so a stray second tap does not place it. A click or a tap
// on an empty spot of the board drops the selection.
boardEl.addEventListener('click', (e) => {
    if (panDragged) return;
    if (challengeEditorMode) {
        const piece = e.target.closest('[data-editor-piece-index]');
        if (piece) {
            window.dispatchEvent(
                new CustomEvent('bandito:editor-select-piece', {
                    detail: { index: Number(piece.dataset.editorPieceIndex) },
                })
            );
            return;
        }
        const editorTarget = targetAt({ x: e.clientX, y: e.clientY });
        if (editorTarget) {
            window.dispatchEvent(
                new CustomEvent('bandito:editor-placement', {
                    detail: { x: editorTarget.x, y: editorTarget.y, r: editorTarget.r, m: clone(editorTarget.m) },
                })
            );
        }
        return;
    }
    const target = targetAt({ x: e.clientX, y: e.clientY });
    if (!target) {
        if (state.selected >= 0) clearSelection();
    } else if (pressType !== 'mouse') {
        setPreview(target, true);
        $('#placementConfirm').focus({ preventScroll: true });
    } else if (isPreviewed(target)) play(target.x, target.y, target.m);
    else setPreview(target);
});
boardEl.addEventListener('keydown', (e) => {
    if (!challengeEditorMode || (e.key !== 'Enter' && e.key !== ' ')) return;
    const piece = e.target.closest('[data-editor-piece-index]');
    if (!piece) return;
    e.preventDefault();
    window.dispatchEvent(
        new CustomEvent('bandito:editor-select-piece', {
            detail: { index: Number(piece.dataset.editorPieceIndex) },
        })
    );
});

// A pin stands at the centre of its future card. Rotations that share a centre are spread, in px of the current zoom.
// A pair goes along the long axis of its card, ±pairSpread cells from the centre. Cards lie on a 3-cell grid,
// so the closest pins of other spots are another pair 3 cells away along the axis or a card of the other
// orientation 1.5 cells away on both axes. The distances 2d, 3 − 2d and √2·(1.5 − d) are balanced at d ≈ 0.62:
// all of them are about 1.24 cells.
// 3 pins go along the long axis of the first rotation's card at quarters of its length;
// 4 pins form a rhombus: the pair in that card's orientation along its long axis, the other pair along the short
// one, at a quarter of the side — the gaps edge, pin, centre line, pin, edge are equal on both axes.
const pairSpread = 0.62;
function pinOffsetsFor(options) {
    const centre = (x, y, w, h) => x * 2 + w + ',' + (y * 2 + h),
        groups = new Map();
    options.forEach(({ w, h, spots }, r) => {
        for (const [x, y] of spots) {
            const key = centre(x, y, w, h);
            groups.set(key, [...(groups.get(key) || []), r]);
        }
    });
    return (r, x, y) => {
        const { w, h } = options[r],
            group = groups.get(centre(x, y, w, h)),
            n = group.length,
            i = group.indexOf(r);
        if (n === 1) return [0, 0];
        const first = options[group[0]],
            horizontal = first.w >= first.h,
            long = Math.max(first.w, first.h) * cellSize,
            short = Math.min(first.w, first.h) * cellSize,
            along = (axisHorizontal, shift) => (axisHorizontal ? [shift, 0] : [0, shift]);
        if (n === 2) return along(horizontal, (i ? 1 : -1) * pairSpread * cellSize);
        if (n === 3) return along(horizontal, long * ((i + 1) / 4 - 1 / 2));
        const sameOrientation = w >= h === horizontal,
            pair = group.filter((q) => options[q].w >= options[q].h === w >= h),
            sign = pair.indexOf(r) ? 1 : -1;
        return sameOrientation ? along(horizontal, (sign * long) / 4) : along(!horizontal, (sign * short) / 4);
    };
}

// Legal spots of the selected card for every rotation.
// A symmetric card looks the same in several rotations (a straight line at 0° and 180°):
// such a repeated rotation gets no spots, so each distinct placement has a single pin.
function placementOptions() {
    if (state.selected < 0 || !state.hand[state.selected]) return [];
    const options = [],
        seen = new Set();
    for (let r = 0; r < 4; r++) {
        const m = rotated(state.hand[state.selected].m, r),
            [w, h] = dims(m),
            key = JSON.stringify(m),
            spots = seen.has(key) ? [] : legalSpots(m);
        seen.add(key);
        options.push({ m, w, h, spots });
    }
    return options;
}

// All placements of the selected card in one circle, clockwise from 12 o'clock around the centre of the cards
// already on the board. Placements are grouped by the card position: groups go by the angle of the card centre
// (the nearer one first on the same line), and the pins of a group by their own angle around the same centre.
function placementCycle() {
    const minX = Math.min(...state.placed.map((p) => p.x)),
        minY = Math.min(...state.placed.map((p) => p.y)),
        maxX = Math.max(...state.placed.map((p) => p.x + dims(p.m)[0])),
        maxY = Math.max(...state.placed.map((p) => p.y + dims(p.m)[1])),
        cx = (minX + maxX) / 2,
        cy = (minY + maxY) / 2,
        clockwise = (dx, dy) => (Math.atan2(dx, -dy) + 2 * Math.PI) % (2 * Math.PI);
    const cycle = [],
        options = placementOptions(),
        pinOffset = pinOffsetsFor(options);
    options.forEach(({ w, h, spots }, r) => {
        for (const [x, y] of spots) {
            const [ox, oy] = pinOffset(r, x, y),
                dx = x + w / 2 - cx,
                dy = y + h / 2 - cy,
                angle = clockwise(dx, dy),
                pinAngle = clockwise(dx + ox / cellSize, dy + oy / cellSize);
            // Pin angle relative to its group, in (-π, π], so a group at 12 o'clock does not split across 0°.
            const pinTurn = ((pinAngle - angle + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
            cycle.push({ x, y, r, angle, distance: Math.hypot(dx, dy), pinTurn });
        }
    });
    return cycle.sort((a, b) => a.angle - b.angle || a.distance - b.distance || a.pinTurn - b.pinTurn);
}

// Scrolls the camera so the previewed card is fully visible. Runs after render() restores the scroll.
function revealPreview() {
    requestAnimationFrame(() => {
        const camera = $('#camera'),
            ghost = $('#board [data-ghost]');
        if (!camera || !ghost) return;
        const view = camera.getBoundingClientRect(),
            box = ghost.getBoundingClientRect(),
            margin = 24;
        if (box.left < view.left + margin) camera.scrollLeft -= view.left + margin - box.left;
        else if (box.right > view.right - margin)
            camera.scrollLeft += Math.min(box.right - view.right + margin, box.left - view.left - margin);
        if (box.top < view.top + margin) camera.scrollTop -= view.top + margin - box.top;
        else if (box.bottom > view.bottom - margin)
            camera.scrollTop += Math.min(box.bottom - view.bottom + margin, box.top - view.top - margin);
    });
}

// Selects card i: it lifts, its pins show and the preview of another card goes, so the arrows keep choosing a card.
function selectCard(i) {
    if (i !== state.selected) {
        state.selected = i;
        state.placementPreview = null;
        previewPicked = false;
    }
    render();
    selectionStatus();
}

// Enter or Space on the selected card, or the keys 1/2/3: the card goes to placing. The preview is picked under
// the resting mouse cursor if it is over a placement, so a later move of the mouse does not throw it across
// the board, else at the first position of the circle.
function confirmCard(i) {
    if (!handInputs()[i] || handInputs()[i].disabled) return;
    if (i !== state.selected) selectCard(i);
    if (!boardTargets.length) return;
    if (placing()) return focusPlacements();
    setPreview(targetAt(cursor) || targetFor(placementCycle()[0]), true);
    focusPlacements();
    revealPreview();
}

// Esc or «Отмена» while placing, or Tab back into the hand: back to choosing a card. The pins stay, the preview goes
// and the arrows choose a card again.
function leavePlacements(focus = true) {
    clearPlacementPreview();
    selectionStatus();
    if (focus) focusCard(state.selected);
}

// After a move the played card's slot (the drawn card, or the card that moved into it) stays selected without
// a preview: a hover, Enter or a click shows it again.
export function selectPlayedSlot(slot) {
    state.selected = slot;
    state.placementPreview = null;
    previewPicked = false;
}

// The hand is fixed to the bottom on phones: scrolling it into view would scroll the page under it.
// Focus moved by the game is not a Tab into the hand.
let focusingHand = false;
function focusCard(i) {
    focusingHand = true;
    handInputs()[i]?.focus({ preventScroll: true });
    focusingHand = false;
}

// A game starts with nothing selected and focus on the first card, which is pointed at (lit) as if Tab moved to it,
// whether the game was started with the mouse or the keyboard. On another player's turn the cards are disabled and
// get nothing. On touch nothing is pointed at: the player picks a card with a tap.
export function startHand() {
    const first = handInputs()[0];
    if (!first || first.disabled || touchInput) return;
    focusCard(0);
    pointCard(state.hand[0].id);
}

// Focus goes to card i, by default to the selected card, else to the first one.
export function focusHand(i = Math.max(state.selected, 0)) {
    focusCard(i);
}

// Esc while choosing a card, a click on an empty spot of the board: nothing is selected, the pins go.
function clearSelection() {
    state.selected = -1;
    state.rotation = 0;
    state.placementPreview = null;
    previewPicked = false;
    status(chooseCardMessage, '', chooseCardTouchMessage);
    render();
}

// Focus leaving the hand and the placement controls from the keyboard (Tab to the zoom buttons) drops the selection:
// the bar, the spots and the preview disappear. The help button lies between the placement buttons and the hand.
// A mouse click outside keeps it: the card waits for a click on the board. A render and a blur of the window have
// no next element and keep the selection.
function dropSelectionOnFocusLeave(e) {
    const next = e.relatedTarget;
    if (
        state.selected < 0 ||
        !next ||
        next.closest('#hand, #placementOptions, #placementPreview, #gameHelpToggle, #gameHelpModal')
    )
        return;
    // The next element is focused after this event; a keyboard move gives it :focus-visible, a mouse click does not.
    setTimeout(() => {
        if (document.activeElement !== next || !next.matches(':focus-visible') || state.selected < 0) return;
        clearSelection();
    });
}
$('#hand').addEventListener('focusout', dropSelectionOnFocusLeave);
$('#placementOptions').addEventListener('focusout', dropSelectionOnFocusLeave);
$('#placementPreview').addEventListener('focusout', dropSelectionOnFocusLeave);
$('#gameHelpToggle').addEventListener('focusout', dropSelectionOnFocusLeave);

$('#placementConfirm').onclick = (e) => {
    if (!state.placementPreview || state.selected < 0 || !state.hand[state.selected]) return;
    const { x, y, r } = state.placementPreview;
    // Enter or Space (a click with detail 0) places the card from the keyboard: focus goes to the slot.
    play(x, y, rotated(state.hand[state.selected].m, r), e.detail === 0);
};
$('#placementCancel').onclick = () => leavePlacements();
const gameHelpModal = $('#gameHelpModal');
$('#gameHelpToggle').onclick = () => {
    // The help describes the current input only: touch, or a mouse with the keyboard.
    gameHelpModal
        .querySelectorAll('[data-help-input]')
        .forEach((el) => el.classList.toggle('hidden', (el.dataset.helpInput === 'touch') !== touchInput));
    openModal(gameHelpModal, $('#gameHelpToggle'), $('#closeGameHelp'));
};
$('#closeGameHelp').onclick = () => closeModal(gameHelpModal);
gameHelpModal.addEventListener('click', (e) => {
    if (e.target === gameHelpModal) closeModal(gameHelpModal);
});
// 100% is a 24px cell, on narrow screens 18px; a game starts at 100%. The zoom changes the cell by 2px
// from about 50% to about 150%: 12–36px on the desktop, 8–28px (44–156%) on narrow screens.
const narrowScreen = () => window.matchMedia('(max-width:760px)').matches;
const baseCellSize = () => (narrowScreen() ? 18 : 24);
// The 100% cell the current zoom is measured against. Keep the chosen percentage across reloads and new games.
let zoomBase = baseCellSize();
const clampCell = (value) => Math.max(Math.floor(zoomBase / 4) * 2, Math.min(Math.ceil((zoomBase * 3) / 4) * 2, value));
let savedZoom = 100;
try {
    const storedZoom = Number(localStorage.getItem('banditoZoom'));
    if (Number.isFinite(storedZoom) && storedZoom > 0) savedZoom = storedZoom;
} catch {}
let cellSize = clampCell(Math.round((zoomBase * savedZoom) / 200) * 2);
// render() keeps the cell in the middle of the camera, so the zoom goes around the centre of the view.
function setZoom(next) {
    const value = clampCell(next);
    if (value === cellSize) return;
    cellSize = value;
    try {
        localStorage.setItem('banditoZoom', String(Math.round((cellSize / zoomBase) * 100)));
    } catch {}
    render({ hand: false });
}
$('#zoomOut').onclick = () => setZoom(cellSize - 2);
$('#zoomIn').onclick = () => setZoom(cellSize + 2);
const cameraEl = $('#camera');
let panState = null,
    // A drag of the camera ends with a click, which must not place a card.
    panDragged = false;
cameraEl.addEventListener('pointerdown', (e) => {
    // Touchscreens use native overflow scrolling for smooth, momentum-based panning.
    if (e.pointerType !== 'mouse' || e.button !== 0 || e.target.closest('button')) return;
    panDragged = false;
    panState = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        left: cameraEl.scrollLeft,
        top: cameraEl.scrollTop,
        moved: false,
    };
});
cameraEl.addEventListener('pointermove', (e) => {
    if (!panState || panState.id !== e.pointerId) return;
    const dx = e.clientX - panState.x,
        dy = e.clientY - panState.y;
    if (!panState.moved && Math.hypot(dx, dy) > 5) {
        panState.moved = true;
        cameraEl.classList.add('game__camera--dragging');
        cameraEl.setPointerCapture(e.pointerId);
    }
    if (panState.moved) {
        cameraEl.scrollLeft = panState.left - dx;
        cameraEl.scrollTop = panState.top - dy;
    }
});
function endPan(e) {
    if (!panState || panState.id !== e.pointerId) return;
    panDragged = panState.moved;
    cameraEl.classList.remove('game__camera--dragging');
    panState = null;
}
cameraEl.addEventListener('pointerup', endPan);
cameraEl.addEventListener('pointercancel', endPan);
cameraEl.addEventListener(
    'wheel',
    (e) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        setZoom(cellSize + (e.deltaY < 0 ? 2 : -2));
    },
    { passive: false }
);
document.addEventListener('keydown', (e) => {
    if (challengeEditorMode || $('#play').classList.contains('hidden') || e.altKey || e.ctrlKey || e.metaKey) return;
    if (isModalOpen(settingsModal) || isModalOpen(gameHelpModal)) return;
    // Text fields keep their keys; the hand and the placements are radios and are handled here.
    if (e.target.closest?.('input:not([type="radio"]),textarea,select,[contenteditable="true"]')) return;
    // The arrows are native: they check the next card or placement.
    const press = e.key === 'Enter' || e.key === ' ',
        handIndex = e.target.closest?.('#hand') ? handInputs().indexOf(e.target) : -1,
        onPlacement = !!e.target.closest?.('#placementOptions');
    if (e.code === 'Equal' || e.code === 'NumpadAdd') {
        setZoom(cellSize + 2);
    } else if (e.code === 'Minus' || e.code === 'NumpadSubtract') {
        setZoom(cellSize - 2);
    } else if (press && handIndex >= 0) {
        // Enter or Space on a card selects it, on the selected card goes on to its placements.
        e.preventDefault();
        if (handIndex === state.selected) confirmCard(handIndex);
        else if (!e.target.disabled) {
            selectCard(handIndex);
            focusCard(handIndex);
        }
    } else if (press && onPlacement) {
        // Enter or Space on the shown placement (picked or hovered) places the card, on another one shows it.
        e.preventDefault();
        if (e.target.dataset.spot === previewSpot()) $('#placementConfirm').click();
        else e.target.click();
    } else if (['1', '2', '3'].includes(e.key)) {
        // A card and its placements at once.
        confirmCard(Number(e.key) - 1);
    } else if (e.key === 'Escape' && state.selected >= 0) {
        // One step back: from the placements to the cards, from a selected card to none.
        if (placing()) leavePlacements();
        else clearSelection();
    }
});
let endScreenDismissed = false;
// «Посмотреть поле» and «Вернуться к результату» open each other, so each one gets the focus back.
function showBoardFromEndScreen(layer) {
    endScreenDismissed = true;
    rememberOpener(layer, () => document.querySelector('[data-end-return]'));
    returnFocus(layer);
    layer.classList.add('hidden');
    document.querySelectorAll('[data-end-return]').forEach((el) => el.remove());
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'btn btn--sm game__return';
    back.dataset.endReturn = '';
    back.textContent = 'Вернуться к результату';
    back.setAttribute('aria-label', 'Вернуться к меню результата игры');
    back.onclick = () => {
        back.remove();
        layer.classList.remove('hidden');
        endScreenDismissed = false;
        layer.querySelector('[data-end="view"]').focus({ preventScroll: true });
    };
    $('.game__subtitle-row').append(back);
}
export function resetEndScreen() {
    endScreenDismissed = false;
    document.querySelectorAll('[data-end-screen], [data-end-return]').forEach((el) => el.remove());
}
export function showEndScreen(won) {
    if (endScreenDismissed || document.querySelector('[data-end-screen]')) return;
    const layer = document.createElement('div');
    layer.className = 'end-screen' + (state.tutorial ? ' end-screen--tutorial' : '') + (won ? '' : ' end-screen--lose');
    layer.dataset.endScreen = '';
    if (state.tutorial) {
        const level = state.tutorial.level;
        const lastLevel = level === tutorialLevels.length;
        const title = won ? (lastLevel ? 'Обучение завершено!' : 'Уровень пройден!') : 'Уровень не пройден';
        const subtitle = won
            ? lastLevel
                ? 'Ты освоил основы BANDITO. Теперь можно начинать обычные партии.'
                : 'Отлично! Все выходы закрыты. Переходим к следующему заданию.'
            : 'Карты закончились, а выходы ещё остались. Попробуй пройти уровень ещё раз.';
        const primary = won
            ? lastLevel
                ? '<button class="btn btn--lg btn--primary end-screen__action" data-end="tutorial-menu">В меню</button>'
                : '<button class="btn btn--lg btn--primary end-screen__action" data-end="tutorial-next">Далее</button>'
            : '<button class="btn btn--lg btn--primary end-screen__action" data-end="tutorial-retry">Повторить уровень</button>';
        layer.innerHTML =
            '<div class="end-screen__card"><div class="end-screen__mark">' +
            (won ? '✓' : '↻') +
            '</div><h2 class="end-screen__title">' +
            title +
            '</h2><p class="end-screen__subtitle">' +
            subtitle +
            '</p><div class="end-screen__actions">' +
            primary +
            '<button class="btn btn--lg end-screen__action" data-end="view">Посмотреть поле</button>' +
            '</div></div>';
        document.body.append(layer);
        layer.querySelector('button[data-end]').focus({ preventScroll: true });
        const next = layer.querySelector('[data-end="tutorial-next"]');
        if (next)
            next.onclick = () => {
                layer.classList.add('is-closing');
                window.setTimeout(() => startTutorial(level + 1), 140);
            };
        const retry = layer.querySelector('[data-end="tutorial-retry"]');
        if (retry)
            retry.onclick = () => {
                layer.classList.add('is-closing');
                window.setTimeout(() => startTutorial(level), 140);
            };
        const menu = layer.querySelector('[data-end="tutorial-menu"]');
        if (menu)
            menu.onclick = () => {
                state.tutorial = null;
                layer.classList.add('is-closing');
                window.setTimeout(() => {
                    resetEndScreen();
                    gameMenu.hide();
                    $('#play').classList.add('hidden');
                    document
                        .querySelectorAll('.game__subtitle')
                        .forEach((el) => el.classList.remove('game__subtitle--tutorial'));
                    $('#menu').classList.remove('hidden');
                }, 140);
            };
        const view = layer.querySelector('[data-end="view"]');
        if (view) view.onclick = () => showBoardFromEndScreen(layer);
        return;
    }
    const multi = !!mpRoomCode,
        custom = !multi && !!state.challenge,
        host = multi && mpRoomData?.owner === mpUid;
    const difficulty = mpRoomData?.game?.exits || 6;
    layer.innerHTML =
        '<div class="end-screen__card"><div class="end-screen__mark">' +
        (won ? '✓' : '×') +
        '</div><h2 class="end-screen__title">' +
        (won ? 'Победа!' : 'Поражение') +
        '</h2><p class="end-screen__subtitle">' +
        (won ? 'Все туннели закрыты. Бандито пойман!' : 'Карты закончились, но выходы ещё остались.') +
        '</p>' +
        (multi
            ? host
                ? '<label class="end-screen__rematch">Сложность реванша <select class="select" data-end="difficulty"><option value="2">2 выхода</option><option value="5">5 выходов</option><option value="6">6 выходов</option></select></label>'
                : '<p class="end-screen__subtitle">Ожидаем, пока создатель комнаты начнёт реванш.</p>'
            : '') +
        '<div class="end-screen__actions">' +
        (multi
            ? host
                ? '<button class="btn btn--lg btn--primary end-screen__action" data-end="rematch">Реванш</button>'
                : '<button class="btn btn--lg btn--primary end-screen__action" disabled>Ждём реванша…</button>'
            : custom
              ? '<button class="btn btn--lg btn--primary end-screen__action" data-end="retry">Повторить испытание</button>' +
                '<button class="btn btn--lg end-screen__action" data-end="menu">В меню</button>'
              : '<button class="btn btn--lg btn--primary end-screen__action" data-end="menu">В меню</button>') +
        '<button class="btn btn--lg end-screen__action" data-end="view">Посмотреть поле</button>' +
        (multi ? '<button class="btn btn--lg end-screen__action" data-end="leave">Выйти из комнаты</button>' : '') +
        '</div></div>';
    document.body.append(layer);
    // The result is a dialog: focus goes to its first action.
    layer.querySelector('button[data-end]').focus({ preventScroll: true });
    const select = layer.querySelector('[data-end="difficulty"]');
    if (select) select.value = String(difficulty);
    const rematch = layer.querySelector('[data-end="rematch"]');
    if (rematch)
        rematch.onclick = () => {
            const choice = select.value;
            layer.remove();
            mpStart(choice);
        };
    const retry = layer.querySelector('[data-end="retry"]');
    if (retry)
        retry.onclick = () => {
            const challenge = state.challenge;
            layer.remove();
            beginChallenge(challenge);
        };
    const menu = layer.querySelector('[data-end="menu"]');
    if (menu)
        menu.onclick = () => {
            state.tutorial = null;
            resetEndScreen();
            $('#play').classList.add('hidden');
            $('#mpLobby').classList.add('hidden');
            $('#menu').classList.remove('hidden');
        };
    const view = layer.querySelector('[data-end="view"]');
    if (view) view.onclick = () => showBoardFromEndScreen(layer);
    const leave = layer.querySelector('[data-end="leave"]');
    if (leave) leave.onclick = () => leaveMultiplayer();
}
export function celebrate() {
    const layer = document.createElement('div');
    layer.className = 'confetti';
    layer.setAttribute('aria-hidden', 'true');
    for (const cls of ['confetti__ring', 'confetti__ring confetti__ring--second']) {
        const ring = document.createElement('i');
        ring.className = cls;
        layer.append(ring);
    }
    const colors = ['#e6b85c', '#718568', '#d98272', '#8b83b7', '#6b9caf', '#e8d9a8', '#f08a5d'];
    for (let burst = 0; burst < 3; burst++) {
        const group = document.createElement('div');
        group.className = 'confetti__burst';
        group.style.transform = 'translate(' + (burst - 1) * 2 + 'px,' + (burst - 1) * -9 + 'px)';
        for (let i = 0; i < 85; i++) {
            const bit = document.createElement('i'),
                angle = Math.random() * Math.PI * 2,
                speed = 100 + Math.random() * 260;
            bit.className =
                'confetti__bit' +
                (i % 5 === 0 ? ' confetti__bit--circle' : i % 7 === 0 ? ' confetti__bit--ribbon' : '');
            bit.style.background = colors[Math.floor(Math.random() * colors.length)];
            bit.style.setProperty('--dx', Math.cos(angle) * speed + 'px');
            bit.style.setProperty('--dy', Math.sin(angle) * speed + 'px');
            bit.style.setProperty('--duration', 0.65 + Math.random() * 0.45 + 's');
            bit.style.setProperty('--delay', burst * 0.18 + Math.random() * 0.12 + 's');
            bit.style.setProperty('--turn', Math.random() * 1100 - 550 + 'deg');
            group.append(bit);
        }
        layer.append(group);
    }
    document.body.append(layer);
    setTimeout(() => layer.remove(), 1800);
}
// byKeyboard: the move was made from the keyboard, the slot gets focus and waits for Enter (see selectPlayedSlot()).
function play(x, y, m, byKeyboard = false) {
    if (mpRoomCode) {
        mpPlay(x, y, m, byKeyboard);
        return;
    }
    if (state.finished || state.selected < 0 || !valid(m, x, y)) return;
    const index = state.selected,
        card = state.hand[index];
    // Keep the played card's slot stable, then top the hand back up to three cards when possible.
    if (state.deck.length) state.hand[index] = state.deck.pop();
    else state.hand.splice(index, 1);
    draw();
    const newPiece = { id: card.id, x, y, m };
    state.placed.push(newPiece);
    state.lastPlaced = newPiece;
    state.animateLastPlacement = true;
    state.turnCount++;
    state.selected = -1;
    state.rotation = 0;
    state.placementPreview = null;
    let n = opens();
    if (n === 0) {
        finishGame(true);
        status('Победа! Все туннели закрыты.', 'win');
        showEndScreen(true);
        celebrate();
    } else if (!state.deck.length && !state.hand.length) {
        finishGame(false);
        status('Поражение. Карты закончились, выходы остались.', 'lose');
        showEndScreen(false);
    }
    // The played card's slot: the drawn card, or, when the deck is empty and the hand closed up to the left,
    // the card that moved into it (the last card if the slot is gone).
    const slot = state.finished ? -1 : Math.min(index, state.hand.length - 1);
    selectPlayedSlot(slot);
    render();
    // The next step of the selected slot.
    if (!state.finished) selectionStatus();
    if (byKeyboard && slot >= 0) focusHand(slot);
}
$('#exchange').onclick = () => {
    if (mpRoomCode) {
        mpExchange();
        return;
    }
    if (state.finished || !state.hand.length) return;
    if (canPlayAny()) {
        snackbar('Сброс карт возможен только если нет доступных ходов', 'error');
        return;
    }
    const count = state.hand.length;
    state.hand.forEach((c) => state.deck.unshift(c));
    state.hand = [];
    draw();
    state.selected = -1;
    state.rotation = 0;
    state.placementPreview = null;
    snackbar('Сброс карт: ' + count + ' карт возвращены под низ колоды, взяты новые');
    status(chooseCardMessage, '', chooseCardTouchMessage);
    render();
    // The button may hide: focus goes to the new cards.
    if ($('#exchange').disabled) startHand();
};
$('#newgame').onclick = async () => {
    gameMenu.hide();
    state.placementPreview = null;
    if (mpRoomCode) {
        if (mpRoomData?.owner !== mpUid) {
            snackbar('Начать новую партию может только создатель комнаты', 'error');
            return;
        }
        await mpStart();
        return;
    }
    if (state.challenge) await beginChallenge(state.challenge);
    else await begin(state.exits);
};
$('#leaveLobby').onclick = async () => {
    state.tutorial = null;
    state.challenge = null;
    gameMenu.hide();
    state.placementPreview = null;
    if (mpRoomCode) {
        await leaveMultiplayer();
        return;
    }
    $('#play').classList.add('hidden');
    document.querySelectorAll('.game__subtitle').forEach((el) => el.classList.remove('game__subtitle--tutorial'));
    $('#menu').classList.remove('hidden');
};
document.querySelectorAll('[data-start]').forEach((b) => (b.onclick = () => begin(+b.dataset.start)));
updateStats();
function rememberWelcomeChoice() {
    try {
        localStorage.setItem('banditoWelcomeSeen', '1');
    } catch {}
}

function showWelcomePrompt() {
    try {
        if (localStorage.getItem('banditoWelcomeSeen') === '1') return;
    } catch {}
    openModal(welcomeModal, document.activeElement, $('#closeWelcome'));
}

function closeWelcomePrompt() {
    if (!isModalOpen(welcomeModal)) return;
    rememberWelcomeChoice();
    closeModal(welcomeModal);
}

fetch('./resources/bandido-matrices/cards.json')
    .then((r) => {
        if (!r.ok) throw Error('Ошибка загрузки колоды');
        return r.json();
    })
    .then((d) => {
        state.all = d.cards.filter((c) => c.matrix);
        window.dispatchEvent?.(new Event('bandito:cards-ready'));
        document.querySelectorAll('[data-start]').forEach((b) => (b.disabled = false));
        $('#loadstate').classList.remove('hidden');
        $('#loadstate').textContent = 'Колода загружена. Можно начинать.';
        showWelcomePrompt();
    })
    .catch((e) => {
        $('#loadstate').classList.remove('hidden');
        $('#loadstate').textContent = 'Не удалось загрузить колоду: ' + e.message + '. Обнови страницу.';
        document.querySelectorAll('[data-start]').forEach((b) => (b.disabled = true));
    });

const settingsModal = $('#settingsModal');
const welcomeModal = $('#welcomeModal');
const closeSettings = () => closeModal(settingsModal);

$('#openSettings').onclick = (event) => {
    event.stopPropagation();
    openModal(settingsModal, $('#openSettings'), $('#closeSettings'));
};
$('#openTutorial').onclick = () => startTutorial(1);
$('#welcomeAlreadyPlayed').onclick = closeWelcomePrompt;
$('#closeWelcome').onclick = closeWelcomePrompt;
$('#welcomeNewPlayer').onclick = () => {
    closeWelcomePrompt();
    window.setTimeout(() => startTutorial(1), 140);
};
welcomeModal.addEventListener('click', (event) => {
    if (event.target === welcomeModal) closeWelcomePrompt();
});
$('#closeSettings').onclick = closeSettings;
settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) closeSettings();
});
$('#reduceMotion').addEventListener('change', saveSettings);
$('#darkTheme').addEventListener('change', saveSettings);
$('#resetSettings').onclick = () => {
    localStorage.removeItem('banditoSettings');
    applySettings();
};
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    closeSettings();
    closeModal(gameHelpModal);
});
