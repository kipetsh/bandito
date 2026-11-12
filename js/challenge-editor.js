import {
    beginChallenge,
    centerCamera,
    clone,
    normalizeChallengeArray,
    render as renderGameBoard,
    rotateMatrix,
    setChallengeEditorMode,
    state,
    validOnBoard,
} from '#js/game.js';
import { rememberOpener, returnFocus } from '#js/focus-return.js';
import { hideMenus } from '#js/menu.js';
import {
    deletePublicChallenge,
    loadPublicChallenges,
    mpLeaveForSolo,
    ownsPublicChallenge,
    savePublicChallenge,
    updatePublicChallenge,
} from '#js/multiplayer.js';
import { snackbar } from '#js/snackbar.js';

const START_CARDS = { 2: 75, 5: 72, 6: 71 };
const BOARD_COLUMNS = 100;
const BOARD_ROWS = 60;
const BOARD_OFFSET_X = 48;
const BOARD_OFFSET_Y = 28;

let root = null;
let launchButton = null;
let libraryButton = null;
let editorHeaderActions = null;
let editorMetadata = null;
let editorPanel = null;
let hiddenGameElements = [];
let gameSnapshot = null;
let editorMode = false;
let returnToLibrary = false;
let draft = null;
let pickerMode = null;
let pickerSlot = 0;
let library = [];
let libraryStatus = 'idle';
let libraryError = '';
let libraryLoading = false;

function cardById(id) {
    return state.all.find((card) => card.id === Number(id));
}

function tunnelCards() {
    return state.all.filter((card) => card.kind === 'tunnel');
}

function createDraft() {
    const start = cardById(START_CARDS[5]);
    if (!start) return null;
    return {
        challengeId: null,
        title: '',
        description: '',
        exits: 5,
        board: [{ id: start.id, x: 0, y: 0, rotation: 0, m: clone(start.matrix) }],
        hand: [null, null, null],
        deck: new Set(tunnelCards().map((card) => card.id)),
        pendingCard: null,
        selectedPiece: null,
        activeHandSlot: 0,
    };
}

function initChallengeEditor() {
    const menu = document.querySelector('#menu');
    const play = document.querySelector('#play');
    if (!menu || !play) return;

    const launchGroup = document.createElement('div');
    launchGroup.className = 'challenge-editor-launches';

    launchButton = document.createElement('button');
    launchButton.type = 'button';
    launchButton.className = 'btn btn--soft challenge-editor-launch';
    launchButton.innerHTML = '<span class="icon icon--plus" aria-hidden="true"></span>Создать испытание';
    launchButton.disabled = true;
    launchButton.addEventListener('click', openEditor);

    libraryButton = document.createElement('button');
    libraryButton.type = 'button';
    libraryButton.className = 'btn challenge-editor-launch';
    libraryButton.textContent = 'Библиотека испытаний';
    libraryButton.disabled = true;
    libraryButton.addEventListener('click', openLibrary);

    launchGroup.append(launchButton, libraryButton);
    const menuGrid = menu.querySelector('.home__grid');
    if (menuGrid) menuGrid.after(launchGroup);
    else menu.append(launchGroup);

    root = document.createElement('div');
    root.className = 'challenge-editor hidden';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML =
        '<div class="challenge-editor__backdrop"></div>' +
        '<section class="challenge-editor__dialog" role="dialog" aria-modal="true" aria-labelledby="challengeLibraryTitle">' +
        '<header class="challenge-editor__header">' +
        '<div><p class="caption challenge-editor__eyebrow">Bandito · Сообщество</p>' +
        '<h2 id="challengeLibraryTitle">Библиотека испытаний</h2></div>' +
        '<button class="btn btn--icon btn--close-icon" type="button" data-editor-close aria-label="Закрыть"></button>' +
        '</header>' +
        '<div class="challenge-editor__content">' +
        '<section class="challenge-editor__library-screen" data-library-screen>' +
        '<div class="challenge-editor__section-head">' +
        '<div class="challenge-editor__library-actions">' +
        '<button class="btn btn--primary" type="button" data-new-challenge><span class="icon icon--plus" aria-hidden="true"></span>Новое испытание</button>' +
        '<button class="btn" type="button" data-library-refresh>Обновить</button></div></div>' +
        '<div class="challenge-editor__library-list" data-library-list></div></section>' +
        '</div></section>' +
        '<section class="challenge-editor__picker hidden" data-picker role="dialog" aria-modal="true" aria-label="Каталог карт">' +
        '<header class="challenge-editor__picker-head"><h3 data-picker-title>Выбери карту</h3>' +
        '<button class="btn btn--icon btn--close-icon" type="button" data-picker-close aria-label="Закрыть каталог"></button></header>' +
        '<div class="challenge-editor__picker-grid" data-picker-grid></div>' +
        '<footer class="challenge-editor__picker-footer" data-picker-footer>' +
        '<button class="btn btn--sm" type="button" data-picker-close>Готово</button>' +
        '<button class="btn btn--sm challenge-editor__picker-clear" type="button" data-deck-clear>Очистить колоду</button></footer></section>';
    document.body.append(root);

    root.addEventListener('click', handleRootClick);
    play.addEventListener('click', handleRootClick);
    play.addEventListener('input', handleRootInput);
    window.addEventListener('keydown', handleEditorKeydown);
    window.addEventListener('resize', () => {
        if (editorMode && !window.matchMedia('(min-width: 761px)').matches) closeEditor();
    });
    window.addEventListener('bandito:cards-ready', updateAvailability);
    window.addEventListener('bandito:editor-placement', handleEditorPlacement);
    window.addEventListener('bandito:editor-select-piece', handleEditorSelectPiece);
    updateAvailability();
}

function updateAvailability() {
    if (launchButton) launchButton.disabled = !state.all.length;
    if (libraryButton) libraryButton.disabled = !state.all.length;
}

function hideGameElement(element) {
    if (!element) return;
    hiddenGameElements.push({ element, wasHidden: element.classList.contains('hidden') });
    element.classList.add('hidden');
}

function createEditorChrome() {
    const play = document.querySelector('#play');
    const head = play.querySelector('.game__head');
    const side = play.querySelector('.game__side');
    const menu = head.querySelector('.game__menu');
    document.querySelector('.page').classList.add('challenge-editor__page');
    play.querySelector('.game__layout').classList.add('challenge-editor__layout');
    play.querySelector('.game__boardbox').classList.add('challenge-editor__boardbox');
    side.classList.add('challenge-editor__side');

    hideGameElement(menu);
    hideGameElement(play.querySelector('.game__subtitle'));
    hideGameElement(side.querySelector('.game__metrics'));
    hideGameElement(side.querySelector('.game__hand-section'));
    hideGameElement(side.querySelector('.game__actions'));
    hideGameElement(side.querySelector('#mpTimer'));
    hideGameElement(side.querySelector('#tutorialGoal'));
    hideGameElement(side.querySelector('#status'));
    const placementPreview = play.querySelector('#placementPreview');
    placementPreview.classList.add('challenge-editor__placement-preview');
    hideGameElement(placementPreview);

    editorHeaderActions = document.createElement('div');
    editorHeaderActions.className = 'challenge-editor__header-actions';
    editorHeaderActions.innerHTML =
        '<button class="btn btn--soft" type="button" data-editor-cancel>Отмена</button>' +
        '<button class="btn btn--primary" type="button" data-save>Сохранить</button>';
    head.append(editorHeaderActions);

    editorPanel = document.createElement('section');
    editorPanel.className = 'challenge-editor__tools';
    editorPanel.innerHTML =
        '<section class="challenge-editor__tool-group">' +
        '<h3>Инструменты</h3>' +
        '<div class="challenge-editor__tool-grid">' +
        '<button class="challenge-editor__tool" type="button" data-picker-open="board">' +
        '<span class="icon icon--plus challenge-editor__tool-icon" aria-hidden="true"></span><span class="challenge-editor__tool-label">Добавить</span></button>' +
        '<button class="challenge-editor__tool" type="button" data-tool="delete" disabled>' +
        '<span class="icon icon--backspace challenge-editor__tool-icon" aria-hidden="true"></span><span class="challenge-editor__tool-label">Удалить</span></button>' +
        '</div></section>' +
        '<section class="challenge-editor__tool-group">' +
        '<div class="challenge-editor__tools-heading"><h3>Карты</h3></div>' +
        '<div class="challenge-editor__selected-card hidden" data-selected-card></div>' +
        '</section>' +
        '<section class="challenge-editor__tool-group">' +
        '<div class="challenge-editor__tools-heading"><h3>Стартовая рука</h3></div>' +
        '<div class="challenge-editor__hand-slots" data-hand-slots></div>' +
        '</section>' +
        '<section class="challenge-editor__tool-group">' +
        '<div class="challenge-editor__tools-heading"><h3>Колода</h3>' +
        '<button class="btn btn--sm" type="button" data-picker-open="deck">Изменить</button></div>' +
        '<div class="challenge-editor__deck-summary"><div data-deck-preview></div>' +
        '<p class="challenge-editor__deck-count" data-deck-count>В колоде: 0 карт</p></div>' +
        '</section>' +
        '<button class="btn challenge-editor__clear-board" type="button" data-clear-board><span class="icon icon--eraser" aria-hidden="true"></span>Очистить поле</button>' +
        '<p class="notice" data-editor-status>Укажи название испытания, чтобы сохранить его.</p>';
    side.append(editorPanel);

    editorMetadata = document.createElement('section');
    editorMetadata.className = 'challenge-editor__metadata-bar';
    editorMetadata.innerHTML =
        '<label class="challenge-editor__field"><span class="caption">Название испытания</span>' +
        '<input class="input" type="text" maxlength="60" placeholder="Например, узкий тоннель" data-field="title"></label>' +
        '<label class="challenge-editor__field"><span class="caption">Описание</span>' +
        '<input class="input" type="text" maxlength="240" placeholder="Кратко опиши задачу" data-field="description"></label>' +
        '<div class="challenge-editor__difficulty-wrap"><span class="caption">Сложность</span>' +
        '<div class="segmented" role="radiogroup" aria-label="Сложность испытания">' +
        '<span class="segmented__bubble" aria-hidden="true"></span>' +
        '<label class="segmented__option"><input class="visually-hidden" type="radio" name="editorExits" value="2" data-editor-exits>Лёгкая</label>' +
        '<label class="segmented__option"><input class="visually-hidden" type="radio" name="editorExits" value="5" data-editor-exits>Стандартная</label>' +
        '<label class="segmented__option"><input class="visually-hidden" type="radio" name="editorExits" value="6" data-editor-exits>Сложная</label>' +
        '</div></div>';
    play.insertBefore(editorMetadata, play.querySelector('.game__layout'));
}

async function showEditor() {
    // A room, even one still loading from the link, would take the screen back and leave the board without
    // placements, since the board waits for the room's turn.
    await mpLeaveForSolo();
    editorMode = true;
    gameSnapshot = { ...state };
    root.classList.add('hidden');
    root.classList.remove('challenge-editor--picker-layer');
    root.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('challenge-editor-open');

    document.querySelector('#menu').classList.add('hidden');
    document.querySelector('#mpLobby').classList.add('hidden');
    const play = document.querySelector('#play');
    play.classList.remove('hidden');
    document.body.classList.add('challenge-editor-mode');
    createEditorChrome();

    document.querySelector('#heading').textContent = 'Bandito · редактор испытаний';
    hideMenus();

    renderEditor();
    window.requestAnimationFrame(() => centerCamera());
}

function openEditor() {
    if (!window.matchMedia('(min-width: 761px)').matches) return;
    if (!state.all.length) {
        snackbar('Колода ещё загружается. Попробуй через несколько секунд.');
        return;
    }
    draft = createDraft();
    if (!draft) return;
    returnToLibrary = false;
    showEditor();
}

function showLibraryScreen() {
    root.querySelector('[data-library-screen]').classList.remove('hidden');
    root.querySelector('#challengeLibraryTitle').textContent = 'Библиотека испытаний';
    renderLibrary();
}

function openLibrary() {
    if (!window.matchMedia('(min-width: 761px)').matches || editorMode) return;
    rememberOpener(root, libraryButton);
    root.classList.remove('hidden');
    root.classList.remove('challenge-editor--picker-layer');
    root.setAttribute('aria-hidden', 'false');
    document.body.classList.add('challenge-editor-open');
    showLibraryScreen();
    if (libraryStatus === 'idle') libraryStatus = 'loading';
    renderLibrary();
    loadLibrary();
}

function restoreGameChrome() {
    document.querySelector('.page').classList.remove('challenge-editor__page');
    const play = document.querySelector('#play');
    play.querySelector('.game__layout').classList.remove('challenge-editor__layout');
    play.querySelector('.game__boardbox').classList.remove('challenge-editor__boardbox');
    play.querySelector('.game__side').classList.remove('challenge-editor__side');
    play.querySelector('#placementPreview').classList.remove('challenge-editor__placement-preview');
    for (const { element, wasHidden } of hiddenGameElements) {
        element.classList.toggle('hidden', wasHidden);
    }
    hiddenGameElements = [];
    editorHeaderActions?.remove();
    editorMetadata?.remove();
    editorPanel?.remove();
    editorHeaderActions = null;
    editorMetadata = null;
    editorPanel = null;
}

function exitEditorScreen(showLibrary = false) {
    if (!editorMode) return;
    setChallengeEditorMode(false);
    if (gameSnapshot) Object.assign(state, gameSnapshot);
    gameSnapshot = null;
    editorMode = false;

    restoreGameChrome();
    document.querySelector('#play').classList.add('hidden');
    document.querySelector('#menu').classList.remove('hidden');
    document.body.classList.remove('challenge-editor-mode');
    draft = null;
    pickerMode = null;
    root.querySelector('[data-picker]').classList.add('hidden');
    root.classList.remove('challenge-editor--picker-layer');

    if (showLibrary) {
        root.classList.remove('hidden');
        root.setAttribute('aria-hidden', 'false');
        document.body.classList.add('challenge-editor-open');
        showLibraryScreen();
    } else {
        root.classList.add('hidden');
        root.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('challenge-editor-open');
    }
    returnToLibrary = false;
}

function closeEditor() {
    if (editorMode) {
        exitEditorScreen(returnToLibrary);
        return;
    }
    if (!root || root.classList.contains('hidden')) return;
    returnFocus(root);
    root.classList.add('hidden');
    root.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('challenge-editor-open');
    closePicker();
}

function handleEditorKeydown(event) {
    if (event.key !== 'Escape') return;
    if (editorMode) {
        if (pickerMode) closePicker();
        else closeEditor();
        event.preventDefault();
        return;
    }
    if (!root || root.classList.contains('hidden')) return;
    if (pickerMode) closePicker();
    else closeEditor();
    event.preventDefault();
}

function handleRootInput(event) {
    if (!editorMode || !draft) return;
    if (event.target.matches?.('[data-editor-exits]')) {
        changeDifficulty(Number(event.target.value));
        return;
    }
    const field = event.target.dataset.field;
    if (field === 'title') draft.title = event.target.value.slice(0, 60);
    if (field === 'description') draft.description = event.target.value.slice(0, 240);
    updateSaveButton();
}

function handleRootClick(event) {
    const target = event.target;
    if (target === root || target.classList?.contains('challenge-editor__backdrop')) {
        if (editorMode && pickerMode) closePicker();
        else closeEditor();
        return;
    }
    if (target.closest?.('[data-editor-close]') || target.closest?.('[data-editor-cancel]')) {
        closeEditor();
        return;
    }
    if (target.closest?.('[data-save]')) {
        saveChallenge();
        return;
    }
    const pickerOpen = target.closest?.('[data-picker-open]');
    if (pickerOpen) {
        const mode = pickerOpen.dataset.pickerOpen;
        openPicker(mode, () => root.querySelector(`[data-picker-open="${mode}"]`));
        return;
    }
    if (target.closest?.('[data-picker-close]')) {
        closePicker();
        return;
    }
    const tool = target.closest?.('[data-tool]');
    if (tool) {
        if (tool.dataset.tool === 'delete') removeSelectedPiece();
        return;
    }
    const handSlot = target.closest?.('[data-hand-slot]');
    if (handSlot) {
        const slot = handSlot.dataset.handSlot;
        draft.activeHandSlot = Number(slot);
        openPicker('hand', () => root.querySelector(`[data-hand-slot="${slot}"]`));
        return;
    }
    const handClear = target.closest?.('[data-hand-clear]');
    if (handClear) {
        clearHandSlot(Number(handClear.dataset.handClear));
        return;
    }
    // The cards in the game hand carry the same data attribute: they are not catalog cards.
    const catalogCard = !target.closest?.('#hand') && target.closest?.('[data-card-id]');
    if (catalogCard) {
        chooseCatalogCard(Number(catalogCard.dataset.cardId));
        return;
    }
    if (target.closest?.('[data-clear-board]')) {
        clearBoard();
        return;
    }
    if (target.closest?.('[data-library-refresh]')) {
        loadLibrary(true);
        return;
    }
    if (target.closest?.('[data-new-challenge]')) {
        draft = createDraft();
        returnToLibrary = true;
        closePicker();
        showEditor();
        return;
    }
    const edit = target.closest?.('[data-edit-challenge]');
    if (edit) {
        editChallenge(edit.dataset.editChallenge);
        return;
    }
    const removeChallenge = target.closest?.('[data-delete-challenge]');
    if (removeChallenge) {
        deleteChallenge(removeChallenge.dataset.deleteChallenge);
        return;
    }
    const play = target.closest?.('[data-play-challenge]');
    if (play) {
        playChallenge(play.dataset.playChallenge);
        return;
    }
    if (target.closest?.('[data-deck-clear]')) clearDeck();
}

function changeDifficulty(exits) {
    if (!START_CARDS[exits] || exits === draft.exits) return;
    const start = cardById(START_CARDS[exits]);
    if (!start) return;
    draft.board.slice(1).forEach((piece) => draft.deck.add(piece.id));
    draft.exits = exits;
    draft.board = [{ id: start.id, x: 0, y: 0, rotation: 0, m: clone(start.matrix) }];
    draft.pendingCard = null;
    draft.selectedPiece = null;
    snackbar('Смена сложности сбросила раскладку поля');
    renderEditor();
}

function isBoardValid(board = draft.board) {
    if (!board.length || board.length > 73) return false;
    const expectedStart = START_CARDS[draft.exits];
    if (board[0].id !== expectedStart || board[0].x !== 0 || board[0].y !== 0 || board[0].rotation !== 0) {
        return false;
    }
    const placed = [];
    for (let index = 0; index < board.length; index++) {
        const piece = board[index];
        if (
            !piece ||
            !Number.isInteger(piece.id) ||
            !Number.isInteger(piece.x) ||
            !Number.isInteger(piece.y) ||
            !Number.isInteger(piece.rotation)
        ) {
            return false;
        }
        const card = cardById(piece.id);
        if (!card || (index === 0 ? card.kind !== 'start' : card.kind !== 'tunnel')) return false;
        const matrix = rotateMatrix(card.matrix, piece.rotation);
        if (
            piece.x < -BOARD_OFFSET_X ||
            piece.y < -BOARD_OFFSET_Y ||
            piece.x + matrix[0].length > BOARD_COLUMNS - BOARD_OFFSET_X ||
            piece.y + matrix.length > BOARD_ROWS - BOARD_OFFSET_Y ||
            (index > 0 && placed.some((placedPiece) => placedPiece.id === card.id)) ||
            (index > 0 && !validOnBoard(placed, matrix, piece.x, piece.y))
        ) {
            return false;
        }
        placed.push({ id: card.id, x: piece.x, y: piece.y, m: matrix });
    }
    return true;
}

function renderEditor() {
    if (!editorMode || !draft) return;
    syncEditorGameState();
    const title = document.querySelector('#play [data-field="title"]');
    const description = document.querySelector('#play [data-field="description"]');
    if (document.activeElement !== title) title.value = draft.title;
    if (document.activeElement !== description) description.value = draft.description;
    document.querySelectorAll('#play [data-editor-exits]').forEach((input) => {
        input.checked = Number(input.value) === draft.exits;
    });
    renderBoardControls();
    renderHandSlots();
    renderDeck();
    updateSaveButton();
}

function syncEditorGameState() {
    state.placed = draft.board.map((piece) => ({
        id: piece.id,
        x: piece.x,
        y: piece.y,
        m: clone(piece.m),
    }));
    state.deck = [...draft.deck]
        .filter((id) => id !== draft.pendingCard)
        .map((id) => cardById(id))
        .filter(Boolean)
        .map((card) => ({ id: card.id, m: clone(card.matrix) }));
    state.hand =
        draft.pendingCard === null ? [] : [{ id: draft.pendingCard, m: clone(cardById(draft.pendingCard).matrix) }];
    state.selected = draft.pendingCard === null ? -1 : 0;
    state.rotation = 0;
    state.finished = false;
    state.exits = draft.exits;
    state.turnCount = draft.board.length - 1;
    state.placementPreview = null;
    state.lastPlaced = null;
    state.animateLastPlacement = false;
    state.challenge = null;
    setChallengeEditorMode(true, draft.selectedPiece === null ? -1 : draft.selectedPiece);
    renderGameBoard({ hand: false });
}

function createCardPreview(matrix, className = '', cellSize = 6) {
    const preview = document.createElement('span');
    preview.className = 'challenge-editor__preview ' + className;
    preview.style.gridTemplateColumns = 'repeat(' + matrix[0].length + ', ' + cellSize + 'px)';
    preview.style.gridTemplateRows = 'repeat(' + matrix.length + ', ' + cellSize + 'px)';
    matrix.flat().forEach((value) => {
        const cell = document.createElement('i');
        cell.className = value ? 'challenge-editor__preview-cell' : 'challenge-editor__preview-cell is-wall';
        preview.append(cell);
    });
    return preview;
}

function renderBoardControls() {
    const selected = draft.selectedPiece === null ? null : draft.board[draft.selectedPiece];
    const pending = draft.pendingCard === null ? null : cardById(draft.pendingCard);
    const card = pending || (selected ? cardById(selected.id) : null);
    const preview = document.querySelector('#play [data-selected-card]');
    const remove = document.querySelector('#play [data-tool="delete"]');
    preview.replaceChildren();
    preview.classList.toggle('hidden', !card);
    if (card) {
        const matrix = pending ? card.matrix : rotateMatrix(card.matrix, selected.rotation);
        preview.append(createCardPreview(matrix));
    }
    const canDelete = Boolean(selected && draft.selectedPiece > 0 && !pending);
    remove.disabled = !canDelete;
}

function confirmPendingPlacement(option) {
    if (draft.pendingCard === null || !option) return;
    if (!validOnBoard(draft.board, option.m, option.x, option.y)) {
        snackbar('Это положение больше недоступно. Выбери другую точку.', 'error');
        renderEditor();
        return;
    }
    const id = draft.pendingCard;
    draft.board.push({
        id,
        x: option.x,
        y: option.y,
        rotation: option.r,
        m: clone(option.m),
    });
    draft.deck.delete(id);
    draft.pendingCard = null;
    draft.selectedPiece = draft.board.length - 1;
    renderEditor();
}

function handleEditorPlacement(event) {
    if (!editorMode || !draft) return;
    confirmPendingPlacement(event.detail);
}

function handleEditorSelectPiece(event) {
    if (!editorMode || !draft) return;
    selectPiece(Number(event.detail?.index));
}

function selectPiece(index) {
    if (index === 0 || !draft.board[index]) return;
    draft.selectedPiece = index;
    draft.pendingCard = null;
    renderEditor();
}

function removeSelectedPiece() {
    if (draft.selectedPiece === null || draft.selectedPiece === 0) return;
    const index = draft.selectedPiece;
    const piece = draft.board[index];
    const nextBoard = draft.board.filter((_, itemIndex) => itemIndex !== index);
    if (!isBoardValid(nextBoard)) {
        snackbar('Сначала удали карты, которые опираются на эту раскладку.', 'error');
        return;
    }
    draft.board = nextBoard;
    draft.deck.add(piece.id);
    draft.selectedPiece = null;
    renderEditor();
}

function clearBoard() {
    if (draft.board.length <= 1) return;
    draft.board.slice(1).forEach((piece) => draft.deck.add(piece.id));
    draft.board = [draft.board[0]];
    draft.pendingCard = null;
    draft.selectedPiece = null;
    renderEditor();
}

function openPicker(mode, opener) {
    pickerMode = mode;
    rememberOpener(root.querySelector('[data-picker]'), opener);
    if (mode === 'hand') {
        const current = draft.hand[draft.activeHandSlot];
        if (current !== null) pickerSlot = draft.activeHandSlot;
        else {
            const empty = draft.hand.findIndex((id) => id === null);
            pickerSlot = empty >= 0 ? empty : draft.activeHandSlot;
            draft.activeHandSlot = pickerSlot;
        }
    }
    const picker = root.querySelector('[data-picker]');
    // Only the deck takes several cards at once: a card for the board or the hand closes the picker by itself.
    root.querySelector('[data-picker-footer]').classList.toggle('hidden', mode !== 'deck');
    const pickerTitles = {
        board: 'Добавить карту на поле',
        hand: 'Выбрать карту в руку',
        deck: 'Колода',
    };
    root.querySelector('[data-picker-title]').textContent = pickerTitles[mode];
    picker.classList.remove('hidden');
    if (editorMode) {
        root.classList.add('challenge-editor--picker-layer');
        root.classList.remove('hidden');
        root.setAttribute('aria-hidden', 'false');
    }
    renderPicker();
}

function closePicker() {
    if (!root) return;
    returnFocus(root.querySelector('[data-picker]'));
    root.querySelector('[data-picker]').classList.add('hidden');
    root.classList.remove('challenge-editor--picker-layer');
    pickerMode = null;
    if (editorMode) {
        root.classList.add('hidden');
        root.setAttribute('aria-hidden', 'true');
    }
}

function renderPicker() {
    const grid = root.querySelector('[data-picker-grid]');
    grid.replaceChildren();
    const boardIds = new Set(draft.board.map((piece) => piece.id));
    const handIds = new Set(
        draft.hand.filter((id, index) => id !== null && (pickerMode !== 'hand' || index !== pickerSlot))
    );
    tunnelCards().forEach((card) => {
        if (boardIds.has(card.id) || handIds.has(card.id)) return;
        const selected = draft.deck.has(card.id);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'challenge-editor__catalog-card' + (pickerMode === 'deck' && selected ? ' is-selected' : '');
        button.dataset.cardId = String(card.id);
        button.append(createCardPreview(card.matrix, 'challenge-editor__catalog-preview', 20));
        button.setAttribute('aria-label', pickerMode === 'deck' ? 'Изменить состав колоды' : 'Добавить карту');
        if (pickerMode === 'deck') {
            const mark = document.createElement('span');
            mark.className =
                'icon challenge-editor__catalog-mark' + (selected ? ' challenge-editor__catalog-mark--selected' : '');
            mark.setAttribute('aria-hidden', 'true');
            button.append(mark);
        }
        grid.append(button);
    });
}

function chooseCatalogCard(id) {
    if (!cardById(id)) return;
    if (pickerMode === 'deck') {
        if (draft.deck.has(id)) draft.deck.delete(id);
        else draft.deck.add(id);
        renderPicker();
        renderDeck();
        updateSaveButton();
        return;
    }
    if (pickerMode === 'hand') {
        const previous = draft.hand[pickerSlot];
        if (previous !== null) draft.deck.add(previous);
        draft.hand[pickerSlot] = id;
        draft.deck.delete(id);
        draft.activeHandSlot = draft.hand.findIndex((cardId) => cardId === null);
        if (draft.activeHandSlot < 0) draft.activeHandSlot = pickerSlot;
        closePicker();
        renderEditor();
        return;
    }
    draft.pendingCard = id;
    draft.selectedPiece = null;
    closePicker();
    renderEditor();
}

function clearHandSlot(index) {
    const previous = draft.hand[index];
    if (previous !== null) draft.deck.add(previous);
    draft.hand[index] = null;
    draft.activeHandSlot = index;
    renderEditor();
}

function renderHandSlots() {
    const container = document.querySelector('#play [data-hand-slots]');
    container.replaceChildren();
    draft.hand.forEach((id, index) => {
        const slot = document.createElement('div');
        slot.className = 'challenge-editor__hand-slot-wrap';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'challenge-editor__hand-slot' + (draft.activeHandSlot === index ? ' is-active' : '');
        button.dataset.handSlot = String(index);
        button.setAttribute(
            'aria-label',
            id === null ? 'Добавить карту в слот ' + (index + 1) : 'Изменить карту в слоте ' + (index + 1)
        );
        if (id === null) {
            button.innerHTML = '<span class="icon icon--plus challenge-editor__hand-plus" aria-hidden="true"></span>';
        } else {
            const card = cardById(id);
            button.append(createCardPreview(card.matrix));
        }
        slot.append(button);
        if (id !== null) {
            const clear = document.createElement('button');
            clear.type = 'button';
            clear.className = 'challenge-editor__remove';
            clear.dataset.handClear = String(index);
            clear.innerHTML = '<span class="icon" aria-hidden="true"></span>';
            clear.setAttribute('aria-label', 'Убрать карту из слота ' + (index + 1));
            slot.append(clear);
        }
        container.append(slot);
    });
}

function renderDeck() {
    const preview = document.querySelector('#play [data-deck-preview]');
    const count = document.querySelector('#play [data-deck-count]');
    const ids = [...draft.deck].sort((a, b) => a - b);
    preview.replaceChildren();
    const word = ids.length === 1 ? 'карта' : ids.length >= 2 && ids.length <= 4 ? 'карты' : 'карт';
    count.textContent = ids.length + ' ' + word;
    const clearButton = root.querySelector('[data-deck-clear]');
    clearButton.disabled = ids.length === 0;
    if (!ids.length) return;
    const card = cardById(ids[0]);
    preview.append(createCardPreview(card.matrix, 'challenge-editor__preview--deck', 14));
}

function challengeValidationIssues() {
    const issues = [];
    if (!draft.title.trim()) issues.push('добавь название');
    if (draft.pendingCard !== null) issues.push('заверши размещение выбранной карты');
    return issues;
}

function updateSaveButton() {
    if (!draft || !editorMode) return;
    const issues = challengeValidationIssues();
    const button = document.querySelector('#play [data-save]');
    const status = document.querySelector('#play [data-editor-status]');
    if (!button || !status) return;
    button.disabled = issues.length > 0;
    button.textContent = 'Сохранить';
    status.hidden = issues.length === 0;
    if (issues.length) {
        status.textContent =
            draft.pendingCard !== null
                ? 'Выбери положение карты на поле.'
                : 'Добавь название испытания в панели под заголовком.';
    }
}

function challengeAccessError(error) {
    const message = String(error?.message || error || 'Неизвестная ошибка');
    if (/permission_denied|permission denied/i.test(message)) {
        return 'Firebase запретил операцию. Проверь правила /challenges в Realtime Database Rules.';
    }
    return message;
}

function clearDeck() {
    if (!draft.deck.size) return;
    draft.deck.clear();
    renderDeck();
    if (pickerMode === 'deck') renderPicker();
    updateSaveButton();
}

async function saveChallenge() {
    if (!draft || !editorMode) return;
    const button = document.querySelector('#play [data-save]');
    const issues = challengeValidationIssues();
    if (issues.length) {
        snackbar('Перед сохранением: ' + issues.join('; ') + '.', 'error');
        updateSaveButton();
        return;
    }
    const editing = Boolean(draft.challengeId);
    button.disabled = true;
    button.textContent = 'Сохраняю…';
    const hand = draft.hand.filter((id) => id !== null);
    const challenge = {
        title: draft.title.trim(),
        description: draft.description.trim(),
        exits: draft.exits,
        board: draft.board.map(({ id, x, y, rotation }) => ({ id, x, y, rotation })),
        hand,
        deck: [...draft.deck].filter((id) => !hand.includes(id)),
    };
    try {
        const saved = editing
            ? await updatePublicChallenge(draft.challengeId, challenge)
            : await savePublicChallenge(challenge);
        library = [saved, ...library.filter((item) => item.id !== saved.id)];
        libraryStatus = 'ready';
        snackbar(editing ? 'Изменения сохранены.' : 'Испытание опубликовано в общей библиотеке.');
        exitEditorScreen(true);
    } catch (error) {
        snackbar('Не удалось сохранить испытание: ' + challengeAccessError(error), 'error');
        updateSaveButton();
    }
}

async function loadLibrary(force = false) {
    if (libraryLoading || (libraryStatus === 'ready' && !force)) return;
    libraryLoading = true;
    libraryStatus = 'loading';
    libraryError = '';
    renderLibrary();
    try {
        library = await loadPublicChallenges();
        libraryStatus = 'ready';
    } catch (error) {
        libraryStatus = 'error';
        libraryError = challengeAccessError(error);
    } finally {
        libraryLoading = false;
        renderLibrary();
    }
}

function renderLibrary() {
    const list = root.querySelector('[data-library-list]');
    if (!list) return;
    list.replaceChildren();
    if (libraryStatus === 'loading' || libraryLoading) {
        const message = document.createElement('p');
        message.className = 'note';
        message.textContent = 'Загружаю общую библиотеку испытаний…';
        list.append(message);
        return;
    }
    if (libraryStatus === 'error') {
        const message = document.createElement('p');
        message.className = 'note';
        message.textContent = 'Не удалось загрузить библиотеку: ' + libraryError;
        list.append(message);
        return;
    }
    if (!library.length) {
        const message = document.createElement('p');
        message.className = 'note';
        message.textContent = 'Пока нет опубликованных испытаний. Создай первое.';
        list.append(message);
        return;
    }
    library.forEach((challenge) => {
        const card = document.createElement('article');
        card.className = 'challenge-editor__library-card';
        const title = document.createElement('h4');
        title.textContent = String(challenge.title || 'Без названия');
        const description = document.createElement('p');
        description.textContent = String(challenge.description || 'Без описания');
        const meta = document.createElement('p');
        meta.className = 'caption';
        meta.textContent =
            Number(challenge.exits || 5) +
            ' выходов · ' +
            normalizeChallengeArray(challenge.board).length +
            ' карт на поле · ' +
            String(challenge.authorName || 'Игрок');
        const play = document.createElement('button');
        play.type = 'button';
        play.className = 'btn btn--primary';
        play.dataset.playChallenge = String(challenge.id);
        play.textContent = 'Играть';
        card.append(title, description, meta, play);
        if (ownsPublicChallenge(challenge)) {
            const actions = document.createElement('div');
            actions.className = 'challenge-editor__library-actions';
            const edit = document.createElement('button');
            edit.type = 'button';
            edit.className = 'btn';
            edit.dataset.editChallenge = String(challenge.id);
            edit.textContent = 'Редактировать';
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'btn';
            remove.dataset.deleteChallenge = String(challenge.id);
            remove.textContent = 'Удалить';
            actions.append(edit, remove);
            card.append(actions);
        }
        list.append(card);
    });
}

function editChallenge(id) {
    const challenge = library.find((item) => item.id === id);
    if (!challenge || !ownsPublicChallenge(challenge)) return;
    const exits = START_CARDS[Number(challenge.exits)] ? Number(challenge.exits) : 5;
    const boardData = normalizeChallengeArray(challenge.board);
    const handData = normalizeChallengeArray(challenge.hand);
    const deckData = normalizeChallengeArray(challenge.deck);
    if (!boardData.length) {
        snackbar('Не удалось открыть испытание: поле пустое или повреждено.', 'error');
        return;
    }

    const startCard = cardById(START_CARDS[exits]);
    const tunnelIds = new Set(tunnelCards().map((card) => card.id));
    const pieces = boardData
        .map((piece) => {
            const card = cardById(piece?.id);
            if (!card || (card.kind !== 'start' && !tunnelIds.has(card.id))) return null;
            const x = Number(piece.x);
            const y = Number(piece.y);
            if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
            const rawRotation = Number(piece.rotation || 0);
            const rotation = Number.isFinite(rawRotation) ? ((Math.trunc(rawRotation) % 4) + 4) % 4 : 0;
            return {
                id: card.id,
                x: Math.round(x),
                y: Math.round(y),
                rotation,
                m: rotateMatrix(card.matrix, rotation),
            };
        })
        .filter(Boolean);
    const startIndex = pieces.findIndex((piece) => piece.id === startCard.id);
    const board =
        startIndex >= 0
            ? [
                  pieces[startIndex],
                  ...pieces.filter((_, index) => index !== startIndex && pieces[index].id !== startCard.id),
              ]
            : [
                  { id: startCard.id, x: 0, y: 0, rotation: 0, m: clone(startCard.matrix) },
                  ...pieces.filter((piece) => piece.id !== startCard.id),
              ];

    const hand = [...new Set(handData.map(Number).filter((id) => tunnelIds.has(id)))].slice(0, 3);
    const usedIds = new Set([...board.map((piece) => piece.id), ...hand]);
    const deck = [...new Set(deckData.map(Number).filter((id) => tunnelIds.has(id) && !usedIds.has(id)))];
    draft = createDraft();
    draft.challengeId = challenge.id;
    draft.title = String(challenge.title || '').slice(0, 60);
    draft.description = String(challenge.description || '').slice(0, 240);
    draft.exits = exits;
    draft.board = board;
    draft.hand = Array.from({ length: 3 }, (_, index) => hand[index] ?? null);
    draft.deck = new Set(deck);
    draft.pendingCard = null;
    draft.selectedPiece = null;
    returnToLibrary = true;
    closePicker();
    showEditor();
}

async function deleteChallenge(id) {
    const challenge = library.find((item) => item.id === id);
    if (!challenge || !ownsPublicChallenge(challenge)) return;
    if (!window.confirm('Удалить испытание «' + String(challenge.title || 'Без названия') + '»?')) return;
    try {
        await deletePublicChallenge(id);
        library = library.filter((item) => item.id !== id);
        renderLibrary();
        snackbar('Испытание удалено.');
    } catch (error) {
        snackbar('Не удалось удалить испытание: ' + challengeAccessError(error), 'error');
    }
}

async function playChallenge(id) {
    const challenge = library.find((item) => item.id === id);
    if (!challenge) return;
    if (await beginChallenge(challenge)) closeEditor();
}

initChallengeEditor();
