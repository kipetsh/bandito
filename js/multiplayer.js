/* Firebase, lobby UI, room presence, and cooperative game flow. */
import { $ } from '#js/dom.js';
import { snackbar } from '#js/snackbar.js';
import { getRoomPath, getRoomUrl } from '#js/room-url.js';
import {
    canPlayAny,
    chooseCardMessage,
    chooseCardTouchMessage,
    celebrate,
    centerCamera,
    clone,
    focusHand,
    startHand,
    opens,
    normalizeChallengeArray,
    render,
    resetEndScreen,
    showEndScreen,
    shuffle,
    state,
    status,
    valid,
} from '#js/game.js';

const firebaseConfig = {
    apiKey: 'AIzaSyDCBEArE3TebFxTiaK-6Q7DxWf8GloOuUg',
    authDomain: 'bandito-83823.firebaseapp.com',
    databaseURL: 'https://bandito-83823-default-rtdb.firebaseio.com/',
    projectId: 'bandito-83823',
    storageBucket: 'bandito-83823.firebasestorage.app',
    messagingSenderId: '434862103332',
    appId: '1:434862103332:web:f470c708e8d88a4f69b1b1',
    measurementId: 'G-TTN8Z732BH',
};
let mpAuth = null,
    mpDb = null,
    mpRoomRef = null,
    mpRoomListener = null,
    mpBusy = false,
    mpCelebrated = false,
    mpTimerInterval = null,
    mpPresenceRef = null,
    mpPresenceHandler = null;
export let mpUid = null,
    mpRoomCode = null,
    mpRoomData = null;
const mpReadyMessage = 'Кооператив готов. Создай комнату или введи код.';
function updateRoomUrl(code = null) {
    if (!['http:', 'https:'].includes(window.location.protocol)) return;
    window.history.replaceState(window.history.state, '', getRoomPath(code, window.location.pathname));
}
function mpMessage(t) {
    const e = $('#mpMessage');
    if (e) {
        e.textContent = t;
    }
}
function mpName() {
    return (localStorage.getItem('banditoPlayerName') || 'Игрок').trim().slice(0, 18) || 'Игрок';
}
function mpCode() {
    return Math.random().toString(36).slice(2, 8).toUpperCase();
}
function mpSyncDifficulty(value, disabled = false) {
    const selected = ['2', '5', '6'].includes(String(value)) ? String(value) : '5';
    const index = { 2: 0, 5: 1, 6: 2 }[selected];
    const group = document.querySelector('.lobby__difficulty');
    const select = $('#mpExits');
    if (select) select.value = selected;
    if (group) group.style.setProperty('--difficulty-index', index);
    document.querySelectorAll('[data-difficulty]').forEach((button) => {
        const active = button.dataset.difficulty === selected;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
        button.disabled = disabled;
    });
}
async function mpSetDifficulty(value) {
    const selected = String(value);
    if (!['2', '5', '6'].includes(selected)) return;
    mpSyncDifficulty(selected, !!mpRoomCode && mpRoomData?.owner !== mpUid);
    if (mpRoomRef && mpRoomData?.owner === mpUid) {
        try {
            await mpRoomRef.child('settings/exits').set(Number(selected));
        } catch (e) {
            snackbar('Не удалось сохранить сложность: ' + e.message, 'error');
        }
    }
}
document.querySelectorAll('[data-difficulty]').forEach((button) => {
    button.addEventListener('click', () => {
        if (!button.disabled) mpSetDifficulty(button.dataset.difficulty);
    });
});
mpSyncDifficulty(5);
const lobbyNameInput = $('#mpName');
if (lobbyNameInput) {
    lobbyNameInput.value = mpName() === 'Игрок' ? '' : mpName();
    lobbyNameInput.addEventListener('change', async () => {
        const value = (lobbyNameInput.value.trim() || 'Игрок').slice(0, 18);
        lobbyNameInput.value = value;
        localStorage.setItem('banditoPlayerName', value);
        if (mpRoomRef && mpUid) {
            try {
                await mpRoomRef.child('players/' + mpUid + '/name').set(value);
            } catch (e) {
                snackbar('Не удалось обновить имя: ' + e.message, 'error');
            }
        }
    });
}
/* Keep both states inside one fixed multiplayer card. */
const coopPanel = $('#coopCard'),
    lobbyPanel = $('#mpLobby');
let coopContent = null;
if (coopPanel && lobbyPanel) {
    coopContent = document.createElement('div');
    coopContent.className = 'coop__content';
    while (coopPanel.firstChild) coopContent.append(coopPanel.firstChild);
    coopPanel.append(coopContent, lobbyPanel);
}
function mpSwapPanel(showLobby) {
    const lobby = $('#mpLobby');
    if (!coopContent || !lobby) return;
    const apply = () => {
        const menu = $('#menu');
        const soloCard = $('.menu__card--solo');
        if (showLobby && menu && soloCard && window.matchMedia('(min-width: 761px)').matches) {
            // Freeze the solo card at its equal-menu height before the lobby grows.
            soloCard.style.height = menu.classList.contains('menu--lobby-open')
                ? soloCard.style.height
                : soloCard.getBoundingClientRect().height + 'px';
            menu.classList.add('menu--lobby-open');
        } else if (!showLobby && menu && soloCard) {
            menu.classList.remove('menu--lobby-open');
            soloCard.style.removeProperty('height');
        }
        coopContent.classList.toggle('hidden', showLobby);
        lobby.classList.toggle('hidden', !showLobby);
    };
    if (document.startViewTransition) document.startViewTransition(apply);
    else apply();
}
function mpShowLobby(room) {
    const chosenDifficulty = room.settings?.exits || $('#mpExits').value || 5;
    mpSyncDifficulty(chosenDifficulty, room.owner !== mpUid);
    $('#menu').classList.remove('hidden');
    $('#play').classList.add('hidden');
    if ($('#mpLobby').classList.contains('hidden')) mpSwapPanel(true);
    $('#mpRoomCode').textContent = mpRoomCode;
    const nameInput = $('#mpName');
    if (nameInput && !nameInput.matches(':focus')) nameInput.value = room.players?.[mpUid]?.name || mpName();
    const players = Object.entries(room.players || {}),
        online = players.filter(([, p]) => p.online !== false).length,
        list = $('#mpPlayers');
    $('#mpLobbyMeta').textContent = online + ' в сети · ' + players.length + '/4 игроков';
    const freeSlots = $('#mpFreeSlots');
    if (freeSlots) freeSlots.textContent = String(Math.max(0, 4 - players.length));
    list.replaceChildren();
    players.forEach(([id, p]) => {
        const row = document.createElement('div');
        row.className = 'card card--raised lobby__player' + (p.online === false ? ' lobby__player--offline' : '');
        const avatar = document.createElement('span');
        avatar.className = 'avatar';
        avatar.textContent = (p.name || 'И').trim().slice(0, 1).toUpperCase() || 'И';
        const copy = document.createElement('span');
        copy.className = 'item lobby__player-info';
        const name = document.createElement('span');
        name.className = 'item__title';
        name.textContent = p.name || 'Игрок';
        const badges = document.createElement('span');
        badges.className = 'lobby__badges';
        if (id === room.owner) {
            const badge = document.createElement('span');
            badge.className = 'badge';
            badge.textContent = 'Создатель';
            badges.append(badge);
        }
        if (id === mpUid) {
            const badge = document.createElement('span');
            badge.className = 'badge';
            badge.textContent = 'Ты';
            badges.append(badge);
        }
        const state = document.createElement('span');
        state.className = 'presence lobby__player-presence' + (p.online === false ? ' presence--offline' : '');
        const dot = document.createElement('span');
        dot.className = 'presence__dot';
        state.append(dot, p.online === false ? 'Не в сети' : 'В сети');
        const head = document.createElement('span');
        head.className = 'lobby__player-head';
        head.append(name, state);
        copy.append(head, badges);
        row.append(avatar, copy);
        list.append(row);
    });
    /* Show connected players only; free slots are summarized in the heading. */
    $('#mpStart').disabled = room.owner !== mpUid || players.length < 1;
    $('#mpLobbyMessage').textContent =
        room.owner === mpUid
            ? 'Ты создатель комнаты. Отправь код друзьям и начинай, когда они подключатся.'
            : 'Ждём, пока создатель начнёт игру. Если связь прервётся, статус обновится автоматически.';
}
function mpAttach(code) {
    mpRoomCode = code;
    updateRoomUrl(code);
    mpRoomRef = mpDb.ref('rooms/' + code);
    if (mpRoomListener) mpRoomRef.off('value', mpRoomListener);
    mpRoomListener = (s) => {
        const room = s.val();
        if (!room) {
            snackbar('Комната больше не существует', 'error');
            leaveMultiplayer(false);
            return;
        }
        const wasMyTurn = mpRoomData?.game?.turnUid === mpUid;
        mpRoomData = room;
        if (!room.game || !room.game.started) {
            mpShowLobby(room);
            return;
        }
        if (!room.game.finished) {
            resetEndScreen();
            mpCelebrated = false;
        }
        // The game screen opening means the game has just started: focus goes to the hand.
        const starting = $('#play').classList.contains('hidden');
        $('#mpLobby').classList.add('hidden');
        $('#menu').classList.add('hidden');
        $('#play').classList.remove('hidden');
        const g = room.game;
        const previouslySelected =
            state.selected >= 0 && state.hand[state.selected] ? state.hand[state.selected].id : null;
        const previousLastKey = state.lastPlaced
            ? state.lastPlaced.id + '@' + state.lastPlaced.x + ',' + state.lastPlaced.y
            : null;
        state.placed = g.board || [];
        state.lastPlaced = state.placed.length ? state.placed[state.placed.length - 1] : null;
        const currentLastKey = state.lastPlaced
            ? state.lastPlaced.id + '@' + state.lastPlaced.x + ',' + state.lastPlaced.y
            : null;
        state.animateLastPlacement =
            !!previousLastKey && !!currentLastKey && previousLastKey !== currentLastKey && (g.turnCount || 0) > 0;
        state.deck = g.deck || [];
        state.hand = (g.hands && g.hands[mpUid]) || [];
        state.turnCount = g.turnCount || 0;
        state.exits = g.exits || 6;
        state.finished = !!g.finished;
        if (state.finished) mpStopTimer();
        else {
            $('#mpTimer').classList.remove('hidden');
            mpStartTimer(g.turnStartedAt || Date.now());
        }
        state.selected = previouslySelected === null ? -1 : state.hand.findIndex((c) => c.id === previouslySelected);
        // As in the solo game, the played card's slot (the drawn card or the card that moved in) stays selected,
        // or after a keyboard turn gets focus.
        let focusSlot = -1;
        if (mpPlayedSlot && state.selected < 0 && previouslySelected !== null) {
            const slot = Math.min(mpPlayedSlot.index, state.hand.length - 1);
            if (mpPlayedSlot.keepSelection) state.selected = slot;
            else focusSlot = slot;
            mpPlayedSlot = null;
        }
        state.rotation = 0;
        $('#heading').textContent = 'Bandito · кооператив · ' + (g.exits || 6) + ' выходов · ' + code;
        render();
        const current = (room.players && room.players[g.turnUid] && room.players[g.turnUid].name) || 'игрок';
        // On the player's turn a selected card keeps the status of its placement, as in the solo game.
        if (state.finished) status(g.won ? 'Победа! Все туннели закрыты.' : 'Поражение. Карты закончились.');
        else if (g.turnUid !== mpUid) status('Ходит ' + current + '. Подожди своей очереди.');
        else if (!canPlayAny()) status('Нет доступных ходов. Нажми «Сбросить карты».');
        else if (state.selected < 0)
            status('Твой ход. ' + chooseCardMessage, '', 'Твой ход. ' + chooseCardTouchMessage);
        if (state.finished) {
            showEndScreen(!!g.won);
            if (g.won && !mpCelebrated) {
                mpCelebrated = true;
                celebrate();
            }
        }
        $('#exchange').disabled = state.finished || g.turnUid !== mpUid || !state.hand.length || canPlayAny();
        if (starting) {
            centerCamera();
            startHand();
        } else if (focusSlot >= 0) {
            focusHand(focusSlot);
        } else if (!wasMyTurn && g.turnUid === mpUid && !state.finished && document.activeElement === document.body) {
            // The hand lost focus when its cards were disabled for the other players' turns: it gets it back.
            focusHand();
        }
    };
    mpRoomRef.on('value', mpRoomListener, (e) => snackbar('Ошибка Firebase: ' + e.message, 'error'));
    mpWatchPresence(code);
}
function mpWatchPresence(code) {
    if (mpPresenceRef && mpPresenceHandler) mpPresenceRef.off('value', mpPresenceHandler);
    mpPresenceRef = mpDb.ref('.info/connected');
    mpPresenceHandler = async (snap) => {
        if (snap.val() !== true || mpRoomCode !== code || !mpUid) return;
        const playerRef = mpDb.ref('rooms/' + code + '/players/' + mpUid);
        try {
            await playerRef.onDisconnect().update({ online: false, lastSeen: firebase.database.ServerValue.TIMESTAMP });
            await playerRef.update({ online: true, lastSeen: firebase.database.ServerValue.TIMESTAMP });
        } catch (e) {
            snackbar('Не удалось обновить статус подключения: ' + e.message, 'error');
        }
    };
    mpPresenceRef.on('value', mpPresenceHandler);
}
async function mpClearPresence(code, uid) {
    if (mpPresenceRef && mpPresenceHandler) mpPresenceRef.off('value', mpPresenceHandler);
    mpPresenceRef = null;
    mpPresenceHandler = null;
    if (code && uid && mpDb) {
        try {
            await mpDb
                .ref('rooms/' + code + '/players/' + uid)
                .onDisconnect()
                .cancel();
        } catch {}
    }
}
export function mpStopTimer() {
    if (mpTimerInterval) {
        clearInterval(mpTimerInterval);
        mpTimerInterval = null;
    }
    $('#mpTimer').classList.add('hidden');
}
async function mpStartTimer(startedAt) {
    if (mpTimerInterval) clearInterval(mpTimerInterval);
    const el = $('#mpTimer');
    if (!el) return;
    const draw = () => {
        const left = Math.max(0, 60 - Math.floor((Date.now() - startedAt) / 1000));
        el.textContent = left ? '⏱ До конца хода: ' + left + ' сек.' : '⏱ Время хода истекло';
        el.classList.toggle('notice--urgent', left <= 10);
        if (left === 0 && !state.finished && !mpBusy) {
            const currentUid = mpRoomData?.game?.turnUid;
            if (currentUid === mpUid) {
                snackbar('Время на ход истекло — ход переходит к следующему игроку');
                mpPassTurn();
            } else if (mpRoomData?.owner === mpUid && currentUid) {
                const player = mpRoomData?.players?.[currentUid];
                if (player?.online === false || Date.now() - startedAt >= 65000) {
                    mpPassTurn(currentUid);
                }
            }
        }
    };
    draw();
    mpTimerInterval = setInterval(draw, 250);
}
async function mpPassTurn(forUid = null) {
    if (!mpRoomCode || state.finished || mpBusy) return;
    const currentUid = mpRoomData?.game?.turnUid;
    const targetUid = forUid || currentUid;
    if (!currentUid || (targetUid !== mpUid && mpRoomData?.owner !== mpUid)) return;
    if (targetUid !== currentUid) return;
    mpBusy = true;
    try {
        await mpRoomRef.child('game').transaction((g) => {
            if (!g || g.finished || g.turnUid !== targetUid) return;
            const ids = Object.keys(g.hands || {});
            const i = ids.indexOf(targetUid);
            g.turnUid = ids[(i + 1) % ids.length];
            g.turnCount = (g.turnCount || 0) + 1;
            g.turnStartedAt = Date.now();
            return g;
        });
    } catch (e) {
        snackbar('Ошибка пропуска хода: ' + e.message, 'error');
    } finally {
        mpBusy = false;
    }
}
async function mpEnsureAuth() {
    if (mpUid) return mpUid;
    if (!mpAuth || !mpDb) throw new Error('Firebase не загрузился. Проверь подключение и обнови страницу.');
    if (mpAuth.currentUser) {
        mpUid = mpAuth.currentUser.uid;
        return mpUid;
    }
    try {
        const cred = await mpAuth.signInAnonymously();
        mpUid = cred.user.uid;
        return mpUid;
    } catch (e) {
        throw new Error(
            e.code === 'auth/operation-not-allowed'
                ? 'В Firebase включи Authentication → Sign-in method → Anonymous.'
                : e.message
        );
    }
}
export async function loadPublicChallenges() {
    await mpEnsureAuth();
    const snapshot = await mpDb.ref('challenges').limitToLast(100).once('value');
    const records = snapshot.val() || {};
    return Object.entries(records)
        .filter(([, challenge]) => challenge && typeof challenge === 'object')
        .map(([id, challenge]) => ({ ...challenge, id }))
        .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
}
function createPublicChallengeRecord(challenge, createdAt = Date.now()) {
    if (!challenge || !Array.isArray(challenge.board) || !Array.isArray(challenge.hand) || !Array.isArray(challenge.deck)) {
        throw new Error('Некорректные данные испытания.');
    }
    const record = {
        schemaVersion: 1,
        title: String(challenge.title || '').trim().slice(0, 60),
        description: String(challenge.description || '').trim().slice(0, 240),
        exits: Number(challenge.exits),
        board: challenge.board.map((piece) => ({
            id: Number(piece.id),
            x: Number(piece.x),
            y: Number(piece.y),
            rotation: Number(piece.rotation || 0),
        })),
        hand: challenge.hand.map(Number),
        deck: challenge.deck.map(Number),
        ownerUid: mpUid,
        authorName: mpName(),
        createdAt,
    };
    if (!record.title || ![2, 5, 6].includes(record.exits) || record.hand.length > 3) {
        throw new Error('Укажи название, сложность и не более трёх карт стартовой руки.');
    }
    return record;
}
export function ownsPublicChallenge(challenge) {
    return Boolean(mpUid && challenge && challenge.ownerUid === mpUid);
}
export async function savePublicChallenge(challenge) {
    await mpEnsureAuth();
    const record = createPublicChallengeRecord(challenge);
    const ref = mpDb.ref('challenges').push();
    await ref.set(record);
    return { ...record, id: ref.key };
}
export async function updatePublicChallenge(id, challenge) {
    await mpEnsureAuth();
    if (!id) throw new Error('Не указан идентификатор испытания.');
    const ref = mpDb.ref('challenges/' + id);
    const snapshot = await ref.once('value');
    const existing = snapshot.val();
    if (!existing || existing.ownerUid !== mpUid) throw new Error('Редактировать можно только собственные испытания.');
    const record = createPublicChallengeRecord(challenge, Number(existing.createdAt) || Date.now());
    record.ownerUid = existing.ownerUid;
    record.authorName = existing.authorName || record.authorName;
    await ref.update(record);
    return { ...record, id: String(id) };
}
export async function deletePublicChallenge(id) {
    await mpEnsureAuth();
    if (!id) throw new Error('Не указан идентификатор испытания.');
    const ref = mpDb.ref('challenges/' + id);
    const snapshot = await ref.once('value');
    const existing = snapshot.val();
    if (!existing || existing.ownerUid !== mpUid) throw new Error('Удалять можно только собственные испытания.');
    await ref.remove();
    return String(id);
}
async function mpCreate() {
    // Prevent an underlying create-room action if a modal is open.
    if (!$('#settingsModal').classList.contains('hidden') || mpBusy) return;
    mpBusy = true;
    mpMessage('Создаю комнату…');
    try {
        await mpEnsureAuth();
        let code = mpCode();
        await mpDb.ref('rooms/' + code).set({
            owner: mpUid,
            players: { [mpUid]: { name: mpName(), online: true, joinedAt: Date.now() } },
            settings: { exits: 5 },
            createdAt: Date.now(),
            game: null,
        });
        mpAttach(code);
        mpMessage('Комната создана. Отправь друзьям код: ' + code);
    } catch (e) {
        mpMessage(mpReadyMessage);
        snackbar('Не получилось создать комнату: ' + e.message, 'error');
    } finally {
        mpBusy = false;
    }
}
export async function mpJoin(codeOverride = null) {
    if (mpBusy) return;
    const code = String(codeOverride ?? $('#mpCode').value).trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) {
        snackbar('Введи шестизначный код комнаты, например 779742', 'error');
        return;
    }
    mpBusy = true;
    mpMessage('Подключаюсь к комнате…');
    let roomRef = null,
        added = false;
    try {
        await mpEnsureAuth();
        roomRef = mpDb.ref('rooms/' + code);
        await roomRef.child('players/' + mpUid).set({ name: mpName(), online: true, joinedAt: Date.now() });
        added = true;
        const snap = await roomRef.once('value');
        const room = snap.val();
        if (!room || !room.owner || !room.players || !room.players[mpUid]) {
            await roomRef.child('players/' + mpUid).remove();
            added = false;
            mpMessage(mpReadyMessage);
            if (codeOverride !== null) updateRoomUrl(null);
            snackbar(
                'Комната ' + code + ' не найдена. Проверь код или попроси создателя прислать его ещё раз',
                'error'
            );
            return;
        }
        const count = Object.keys(room.players).length;
        if (count > 4) {
            await roomRef.child('players/' + mpUid).remove();
            added = false;
            mpMessage(mpReadyMessage);
            if (codeOverride !== null) updateRoomUrl(null);
            snackbar('В комнате уже максимальное количество игроков', 'error');
            return;
        }
        if (room.game?.started && !room.game.finished) {
            await roomRef.child('players/' + mpUid).remove();
            added = false;
            mpMessage(mpReadyMessage);
            if (codeOverride !== null) updateRoomUrl(null);
            snackbar('В этой комнате уже идёт партия. Подключиться можно после её завершения', 'error');
            return;
        }
        mpAttach(code);
        mpMessage('Ты в комнате ' + code);
    } catch (e) {
        if (added && roomRef) {
            try {
                await roomRef.child('players/' + mpUid).remove();
            } catch {}
        }
        mpMessage(mpReadyMessage);
        snackbar('Не удалось войти: ' + e.message, 'error');
    } finally {
        mpBusy = false;
    }
}
export async function mpStart() {
    if (!mpRoomCode || mpRoomData?.owner !== mpUid) return;
    state.challenge = null;
    mpCelebrated = false;
    state.animateLastPlacement = false;
    const chosen = $('#mpExits').value;
    const n = chosen === '2' ? 2 : chosen === '5' ? 5 : 6;
    const startId = { 2: 75, 5: 72, 6: 71 }[n];
    const s = state.all.find((c) => c.id === startId);
    if (!s) {
        snackbar('Стартовая карта не найдена в колоде', 'error');
        return;
    }
    const players = Object.keys(mpRoomData.players || {});
    const cards = shuffle(
        state.all.filter((c) => c.kind === 'tunnel' && c.id !== s.id).map((c) => ({ id: c.id, m: clone(c.matrix) }))
    );
    const hands = {};
    players.forEach((id) => (hands[id] = cards.splice(0, 3)));
    const game = {
        started: true,
        exits: n,
        startCardId: s.id,
        board: [{ id: s.id, x: 0, y: 0, m: clone(s.matrix) }],
        deck: cards,
        hands,
        turnUid: players[0],
        turnCount: 0,
        turnStartedAt: Date.now(),
        finished: false,
        won: false,
    };
    try {
        await mpRoomRef.child('game').set(game);
    } catch (e) {
        snackbar('Не удалось начать: ' + e.message, 'error');
    }
}
// The slot of the card being played, kept selected when the room update brings the new hand.
let mpPlayedSlot = null;
export async function mpPlay(x, y, m, keepSelection = true) {
    if (!mpRoomCode || state.finished || state.selected < 0 || mpBusy) return;
    if (mpRoomData?.game?.turnUid !== mpUid) {
        snackbar('Сейчас ход другого игрока', 'error');
        return;
    }
    mpBusy = true;
    mpPlayedSlot = { index: state.selected, keepSelection };
    try {
        const card = state.hand[state.selected];
        const result = await mpRoomRef.child('game').transaction((g) => {
            if (!g || g.finished || g.turnUid !== mpUid) return;
            const own = (g.hands && g.hands[mpUid]) || [];
            const idx = own.findIndex((c) => c.id === card.id);
            if (idx < 0) return;
            state.placed = g.board || [];
            if (!valid(m, x, y)) return;
            const board = g.board.slice();
            board.push({ id: card.id, x, y, m });
            const pile = g.deck || [];
            // The drawn card takes the place of the played one, so the other cards stay where they were.
            if (pile.length) own[idx] = pile.pop();
            else own.splice(idx, 1);
            g.board = board;
            g.deck = pile;
            g.hands[mpUid] = own;
            g.turnCount = (g.turnCount || 0) + 1;
            g.turnStartedAt = Date.now();
            const oldPlaced = state.placed;
            state.placed = board;
            const open = opens();
            state.placed = oldPlaced;
            if (open === 0) {
                g.finished = true;
                g.won = true;
            } else if (!pile.length && Object.values(g.hands || {}).every((a) => !a.length)) {
                g.finished = true;
                g.won = false;
            } else {
                const ids = Object.keys(g.hands || {});
                const i = ids.indexOf(mpUid);
                g.turnUid = ids[(i + 1) % ids.length];
            }
            return g;
        });
        if (!result.committed) {
            mpPlayedSlot = null;
            snackbar('Ход не принят: возможно, очередь уже перешла другому игроку', 'error');
        }
    } catch (e) {
        mpPlayedSlot = null;
        snackbar('Ошибка хода: ' + e.message, 'error');
    } finally {
        mpBusy = false;
    }
}
export async function mpExchange() {
    if (!mpRoomCode || state.finished || mpBusy || mpRoomData?.game?.turnUid !== mpUid) return;
    if (canPlayAny()) {
        snackbar('Сброс карт возможен только если нет доступных ходов', 'error');
        return;
    }
    mpBusy = true;
    try {
        await mpRoomRef.child('game').transaction((g) => {
            if (!g || g.finished || g.turnUid !== mpUid) return;
            const own = (g.hands && g.hands[mpUid]) || [];
            if (!own.length) return;
            const pile = own.concat(g.deck || []);
            const count = Math.min(own.length, pile.length);
            const newHand = [];
            for (let k = 0; k < count; k++) newHand.push(pile.pop());
            g.hands[mpUid] = newHand;
            g.deck = pile;
            const ids = Object.keys(g.hands || {});
            const i = ids.indexOf(mpUid);
            g.turnUid = ids[(i + 1) % ids.length];
            g.turnCount = (g.turnCount || 0) + 1;
            g.turnStartedAt = Date.now();
            return g;
        });
    } catch (e) {
        snackbar('Ошибка сброса: ' + e.message, 'error');
    } finally {
        mpBusy = false;
    }
}
export async function leaveMultiplayer(showMenu = true) {
    const ref = mpRoomRef,
        uid = mpUid,
        listener = mpRoomListener;
    await mpClearPresence(mpRoomCode, uid);
    mpStopTimer();
    if (ref && listener) ref.off('value', listener);
    if (ref && uid) {
        try {
            await ref.transaction((room) => {
                if (!room || !room.players || !room.players[uid]) return;
                delete room.players[uid];
                const remaining = Object.keys(room.players);
                if (!remaining.length) return null;
                if (room.owner === uid) room.owner = remaining[0];
                const game = room.game;
                if (game?.hands) delete game.hands[uid];
                if (game?.started && !game.finished) {
                    if (game.turnUid === uid) {
                        game.turnUid = remaining[0];
                        game.turnStartedAt = Date.now();
                    }
                    const noDeck = !(game.deck || []).length;
                    const noHands = Object.values(game.hands || {}).every((cards) => !cards.length);
                    if (noDeck && noHands) {
                        let openings = 0;
                        const tileAt = (x, y) => {
                            for (const p of game.board || []) {
                                const w = p.m[0].length,
                                    h = p.m.length;
                                if (x >= p.x && x < p.x + w && y >= p.y && y < p.y + h) return p.m[y - p.y][x - p.x];
                            }
                            return null;
                        };
                        for (const p of game.board || []) {
                            for (let y = 0; y < p.m.length; y++)
                                for (let x = 0; x < p.m[y].length; x++)
                                    if (p.m[y][x] === 1)
                                        for (const [dx, dy] of [
                                            [0, -1],
                                            [0, 1],
                                            [-1, 0],
                                            [1, 0],
                                        ])
                                            if (tileAt(p.x + x + dx, p.y + y + dy) === null) openings++;
                        }
                        game.finished = true;
                        game.won = openings === 0;
                    }
                }
                return room;
            });
        } catch (e) {
            snackbar('Не удалось обновить комнату при выходе: ' + e.message, 'error');
        }
    }
    mpRoomRef = null;
    mpRoomListener = null;
    mpRoomCode = null;
    updateRoomUrl(null);
    mpRoomData = null;
    mpCelebrated = false;
    state.hand = [];
    state.placed = [];
    state.deck = [];
    state.selected = -1;
    state.challenge = null;
    $('#play').classList.add('hidden');
    mpSwapPanel(false);
    if (showMenu) $('#menu').classList.remove('hidden');
    mpMessage(mpReadyMessage);
    if (showMenu) snackbar('Ты вышел из комнаты');
}
$('#mpCreate').onclick = mpCreate;
$('#mpJoin').onclick = () => mpJoin();
$('#mpStart').onclick = mpStart;
$('#mpLeave').onclick = () => leaveMultiplayer();
$('#mpCopyCode').onclick = async () => {
    if (!mpRoomCode) return;
    const inviteUrl = getRoomUrl(mpRoomCode, window.location);
    try {
        await navigator.clipboard.writeText(inviteUrl);
        snackbar('Ссылка на комнату скопирована');
    } catch {
        const field = document.createElement('textarea');
        field.value = inviteUrl;
        field.style.position = 'fixed';
        field.style.opacity = '0';
        document.body.append(field);
        field.select();
        try {
            document.execCommand('copy');
            snackbar('Ссылка на комнату скопирована');
        } catch {
            snackbar('Не удалось скопировать ссылку. Выдели её вручную', 'error');
        }
        field.remove();
    }
};
try {
    firebase.initializeApp(firebaseConfig);
    mpAuth = firebase.auth();
    mpDb = firebase.database();
    mpAuth.onAuthStateChanged((u) => {
        if (u) {
            mpUid = u.uid;
            mpMessage(mpReadyMessage);
        } else mpMessage('Войди анонимно, чтобы играть онлайн.');
    });
} catch (e) {
    mpMessage('Firebase не загрузился: ' + e.message);
}
