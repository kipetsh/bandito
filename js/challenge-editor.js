import { beginChallenge, clone, normalizeChallengeArray, rotateMatrix, state, validOnBoard } from '#js/game.js';
import {
    deletePublicChallenge,
    loadPublicChallenges,
    ownsPublicChallenge,
    savePublicChallenge,
    updatePublicChallenge,
} from '#js/multiplayer.js';
import { snackbar } from '#js/snackbar.js';

const START_CARDS = { 2: 75, 5: 72, 6: 71 };
const CELL_SIZE = 24;
const BOARD_COLUMNS = 100;
const BOARD_ROWS = 60;
const BOARD_OFFSET_X = 48;
const BOARD_OFFSET_Y = 28;

let root = null;
let launchButton = null;
let libraryButton = null;
let activeView = 'editor';
let draft = null;
let pickerMode = null;
let pickerSlot = 0;
let library = [];
let libraryStatus = 'idle';
let libraryError = '';
let libraryLoading = false;
let boardCentered = false;

function cardById(id) {
    return state.all.find((card) => card.id === Number(id));
}

function tunnelCards() {
    return state.all.filter((card) => card.kind === 'tunnel');
}

function createDraft() {
    const start = cardById(START_CARDS[5]);
    return {
        challengeId: null,
        title: '',
        description: '',
        exits: 5,
        board: [{ id: start.id, x: 0, y: 0, rotation: 0, m: clone(start.matrix) }],
        hand: [null, null, null],
        deck: new Set(tunnelCards().map((card) => card.id)),
        pendingCard: null,
        pendingRotation: 0,
        selectedPiece: null,
        placementPreview: null,
        activeHandSlot: 0,
    };
}

function initChallengeEditor() {
    const menu = document.querySelector('#menu');
    if (!menu) return;

    const launchGroup = document.createElement('div');
    launchGroup.className = 'challenge-editor-launches';

    launchButton = document.createElement('button');
    launchButton.type = 'button';
    launchButton.className = 'btn btn--soft challenge-editor-launch';
    launchButton.textContent = 'Создать испытание';
    launchButton.disabled = true;
    launchButton.addEventListener('click', openEditor);

    libraryButton = document.createElement('button');
    libraryButton.type = 'button';
    libraryButton.className = 'btn challenge-editor-launch';
    libraryButton.textContent = 'Библиотека испытаний';
    libraryButton.disabled = true;
    libraryButton.addEventListener('click', openLibrary);

    launchGroup.append(launchButton, libraryButton);
    const menuGrid = menu.querySelector('.menu__grid');
    if (menuGrid) menuGrid.after(launchGroup);
    else menu.append(launchGroup);

    root = document.createElement('div');
    root.className = 'challenge-editor hidden';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML =
        '<div class="challenge-editor__backdrop"></div>' +
        '<section class="challenge-editor__dialog" role="dialog" aria-modal="true" aria-labelledby="challengeEditorTitle">' +
        '<header class="challenge-editor__header">' +
        '<div><p class="challenge-editor__eyebrow">BANDITO · СООБЩЕСТВО</p>' +
        '<h2 id="challengeEditorTitle" data-dialog-title>Редактор испытаний</h2></div>' +
        '<button class="btn btn--icon btn--close-icon" type="button" data-editor-close aria-label="Закрыть"></button>' +
        '</header>' +
        '<div class="challenge-editor__meta" data-editor-meta>' +
        '<label class="challenge-editor__field"><span>Название испытания</span>' +
        '<input class="input" type="text" maxlength="60" placeholder="Например, Узкий тоннель" data-field="title"></label>' +
        '<label class="challenge-editor__field"><span>Описание</span>' +
        '<textarea class="input challenge-editor__description" maxlength="240" rows="2" placeholder="Кратко опиши задачу" data-field="description"></textarea></label>' +
        '<div class="challenge-editor__difficulty-wrap"><span class="caption">Сложность</span>' +
        '<div class="lobby__difficulty challenge-editor__difficulty" role="group" aria-label="Сложность испытания">' +
        '<span class="lobby__difficulty-bubble" aria-hidden="true"></span>' +
        '<button class="lobby__difficulty-option" type="button" data-editor-exits="2" aria-pressed="false">Лёгкая</button>' +
        '<button class="lobby__difficulty-option is-active" type="button" data-editor-exits="5" aria-pressed="true">Стандартная</button>' +
        '<button class="lobby__difficulty-option" type="button" data-editor-exits="6" aria-pressed="false">Сложная</button>' +
        '</div></div></div>' +
        '<div class="challenge-editor__content">' +
        '<section class="challenge-editor__workspace" data-editor-screen>' +
        '<div class="challenge-editor__viewport" data-board-viewport aria-label="Поле редактора">' +
        '<div class="challenge-editor__canvas" data-board-canvas></div></div>' +
        '<aside class="challenge-editor__tools">' +
        '<section class="challenge-editor__tool-group">' +
        '<h3>Поле</h3>' +
        '<p class="note">Выбери карту в каталоге, затем нажми цветную точку на поле. Карта установится сразу.</p>' +
        '<button class="btn btn--primary" type="button" data-picker-open="board">＋ Добавить карту</button>' +
        '<button class="btn" type="button" data-remove-piece disabled>Удалить выбранную</button>' +
        '<p class="challenge-editor__selection" data-board-selection>Стартовая карта уже на поле.</p>' +
        '</section>' +
        '<section class="challenge-editor__tool-group">' +
        '<div class="challenge-editor__tools-heading"><h3>Стартовая рука</h3><span class="caption">До 3 карт</span></div>' +
        '<div class="challenge-editor__hand-slots" data-hand-slots></div>' +
        '</section>' +
        '<section class="challenge-editor__tool-group">' +
        '<div class="challenge-editor__tools-heading"><h3>Колода добора</h3><button class="btn btn--sm" type="button" data-picker-open="deck">Настроить</button></div>' +
        '<p class="challenge-editor__deck-count" data-deck-count>В колоде: 0 карт</p>' +
        '<div class="challenge-editor__deck-list" data-deck-list></div>' +
        '<button class="btn btn--sm" type="button" data-deck-clear disabled>Очистить колоду</button>' +
        '</section>' +
        '</aside></section>' +
        '<section class="challenge-editor__library-screen" data-library-screen hidden>' +
        '<div class="challenge-editor__section-head"><div><h3>Общая библиотека</h3>' +
        '<p class="note">Играй в испытания других игроков или редактируй свои публикации.</p></div>' +
        '<div class="challenge-editor__library-actions">' +
        '<button class="btn btn--primary" type="button" data-new-challenge>＋ Новое испытание</button>' +
        '<button class="btn" type="button" data-library-refresh>Обновить</button></div></div>' +
        '<div class="challenge-editor__library-list" data-library-list></div></section>' +
        '</div>' +
        '<footer class="challenge-editor__footer" data-editor-footer>' +
        '<p class="note" data-editor-status>Укажи название, собери поле и настрой карты.</p>' +
        '<button class="btn btn--primary" type="button" data-save disabled>Опубликовать испытание</button></footer>' +
        '<section class="challenge-editor__picker hidden" data-picker aria-label="Каталог карт">' +
        '<header class="challenge-editor__picker-head"><div><h3 data-picker-title>Выбери карту</h3>' +
        '<p class="caption" data-picker-hint>Карты показаны по две в ряд.</p></div>' +
        '<button class="btn btn--icon btn--close-icon" type="button" data-picker-close aria-label="Закрыть каталог"></button></header>' +
        '<div class="challenge-editor__picker-grid" data-picker-grid></div>' +
        '<footer class="challenge-editor__picker-footer"><span class="caption">Каталог карт</span>' +
        '<button class="btn btn--sm" type="button" data-picker-close>Готово</button></footer></section>' +
        '</section>';
    document.body.append(root);
    root.addEventListener('click', handleRootClick);
    root.addEventListener('input', handleRootInput);
    window.addEventListener('keydown', handleEditorKeydown);
    window.addEventListener('resize', () => {
        if (!window.matchMedia('(min-width: 761px)').matches) closeEditor();
    });
    window.addEventListener('bandito:cards-ready', updateAvailability);
    updateAvailability();
}

function updateAvailability() {
    if (launchButton) launchButton.disabled = !state.all.length;
    if (libraryButton) libraryButton.disabled = !state.all.length;
}

function showEditor() {
    activeView = 'editor';
    root.classList.remove('hidden');
    root.setAttribute('aria-hidden', 'false');
    document.body.classList.add('challenge-editor-open');
    render();
}

function openEditor() {
    if (!window.matchMedia('(min-width: 761px)').matches) return;
    if (!state.all.length) {
        snackbar('Колода ещё загружается. Попробуй через несколько секунд.');
        return;
    }
    draft = createDraft();
    boardCentered = false;
    showEditor();
}

function openLibrary() {
    if (!window.matchMedia('(min-width: 761px)').matches) return;
    activeView = 'library';
    root.classList.remove('hidden');
    root.setAttribute('aria-hidden', 'false');
    document.body.classList.add('challenge-editor-open');
    render();
    loadLibrary();
}

function closeEditor() {
    if (!root || root.classList.contains('hidden')) return;
    root.classList.add('hidden');
    root.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('challenge-editor-open');
}

function handleEditorKeydown(event) {
    if (!root || root.classList.contains('hidden') || event.key !== 'Escape') return;
    const picker = root.querySelector('[data-picker]');
    if (picker && !picker.classList.contains('hidden')) {
        closePicker();
        event.preventDefault();
    } else closeEditor();
}

function handleRootInput(event) {
    const field = event.target.dataset.field;
    if (field === 'title') draft.title = event.target.value.slice(0, 60);
    if (field === 'description') draft.description = event.target.value.slice(0, 240);
    updateSaveButton();
}

function handleRootClick(event) {
    const target = event.target;
    if (target === root || target.classList?.contains('challenge-editor__backdrop')) {
        closeEditor();
        return;
    }
    if (target.closest?.('[data-editor-close]')) {
        closeEditor();
        return;
    }
    const exits = target.closest?.('[data-editor-exits]');
    if (exits) {
        changeDifficulty(Number(exits.dataset.editorExits));
        return;
    }
    const pickerOpen = target.closest?.('[data-picker-open]');
    if (pickerOpen) {
        openPicker(pickerOpen.dataset.pickerOpen);
        return;
    }
    if (target.closest?.('[data-picker-close]')) {
        closePicker();
        return;
    }
    const pieceRotation = target.closest?.('[data-piece-rotation]');
    if (pieceRotation) {
        rotateSelectedPieceTo(Number(pieceRotation.dataset.pieceRotation));
        return;
    }
    const placement = target.closest?.('[data-placement-index]');
    if (placement) {
        confirmPendingPlacement(Number(placement.dataset.placementIndex));
        return;
    }
    const piece = target.closest?.('[data-piece-index]');
    if (piece) {
        selectPiece(Number(piece.dataset.pieceIndex));
        return;
    }
    const handSlot = target.closest?.('[data-hand-slot]');
    if (handSlot) {
        draft.activeHandSlot = Number(handSlot.dataset.handSlot);
        openPicker('hand');
        return;
    }
    const handClear = target.closest?.('[data-hand-clear]');
    if (handClear) {
        clearHandSlot(Number(handClear.dataset.handClear));
        return;
    }
    const catalogCard = target.closest?.('[data-card-id]');
    if (catalogCard) {
        chooseCatalogCard(Number(catalogCard.dataset.cardId));
        return;
    }
    if (target.closest?.('[data-deck-clear]')) {
        clearDeck();
        return;
    }
    const deckRemove = target.closest?.('[data-deck-remove]');
    if (deckRemove) {
        draft.deck.delete(Number(deckRemove.dataset.deckRemove));
        renderDeck();
        updateSaveButton();
        return;
    }
    if (target.closest?.('[data-remove-piece]')) {
        removeSelectedPiece();
        return;
    }
    if (target.closest?.('[data-library-refresh]')) {
        loadLibrary(true);
        return;
    }
    if (target.closest?.('[data-new-challenge]')) {
        draft = createDraft();
        boardCentered = false;
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
    if (target.closest?.('[data-save]')) saveChallenge();
}

function changeDifficulty(exits) {
    if (!START_CARDS[exits] || exits === draft.exits) return;
    const start = cardById(START_CARDS[exits]);
    if (!start) return;
    draft.board.slice(1).forEach((piece) => draft.deck.add(piece.id));
    draft.exits = exits;
    draft.board = [{ id: start.id, x: 0, y: 0, rotation: 0, m: clone(start.matrix) }];
    draft.pendingCard = null;
    draft.pendingRotation = 0;
    draft.placementPreview = null;
    draft.selectedPiece = null;
    snackbar('Смена сложности сбросила раскладку поля.');
    render();
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

function render() {
    if (!root) return;
    const isEditor = activeView === 'editor';
    root.querySelector('[data-dialog-title]').textContent = isEditor ? 'Редактор испытания' : 'Библиотека испытаний';
    root.querySelector('[data-editor-meta]').hidden = !isEditor;
    root.querySelector('[data-editor-footer]').hidden = !isEditor;
    root.querySelector('[data-editor-screen]').hidden = !isEditor;
    root.querySelector('[data-library-screen]').hidden = isEditor;
    if (!isEditor) {
        renderLibrary();
        return;
    }
    if (!draft) return;
    const title = root.querySelector('[data-field="title"]');
    const description = root.querySelector('[data-field="description"]');
    if (document.activeElement !== title) title.value = draft.title;
    if (document.activeElement !== description) description.value = draft.description;
    const index = { 2: 0, 5: 1, 6: 2 }[draft.exits];
    const difficulty = root.querySelector('.challenge-editor__difficulty');
    difficulty.style.setProperty('--difficulty-index', index);
    root.querySelectorAll('[data-editor-exits]').forEach((button) => {
        const active = Number(button.dataset.editorExits) === draft.exits;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
    });
    renderBoard();
    renderHandSlots();
    renderDeck();
    updateSaveButton();
}

function createCardPreview(matrix, className = '') {
    const preview = document.createElement('span');
    preview.className = 'challenge-editor__preview ' + className;
    preview.style.gridTemplateColumns = 'repeat(' + matrix[0].length + ', 6px)';
    preview.style.gridTemplateRows = 'repeat(' + matrix.length + ', 6px)';
    matrix.flat().forEach((value) => {
        const cell = document.createElement('i');
        cell.className = value ? 'challenge-editor__preview-cell' : 'challenge-editor__preview-cell is-wall';
        preview.append(cell);
    });
    return preview;
}

function editorPlacementOptions() {
    const options = [];
    const seenMatrices = new Set();
    for (let rotation = 0; rotation < 4; rotation++) {
        const matrix = rotateMatrix(cardById(draft.pendingCard).matrix, rotation);
        const matrixKey = JSON.stringify(matrix);
        if (seenMatrices.has(matrixKey)) continue;
        seenMatrices.add(matrixKey);
        const candidates = new Set();
        for (const piece of draft.board) {
            for (let py = 0; py < piece.m.length; py++) {
                for (let px = 0; px < piece.m[py].length; px++) {
                    if (piece.m[py][px] !== 1) continue;
                    for (const [dx, dy] of [
                        [0, -1],
                        [0, 1],
                        [-1, 0],
                        [1, 0],
                    ]) {
                        for (let y = 0; y < matrix.length; y++) {
                            for (let x = 0; x < matrix[y].length; x++) {
                                if (matrix[y][x] === 1) {
                                    candidates.add(piece.x + px + dx - x + ',' + (piece.y + py + dy - y));
                                }
                            }
                        }
                    }
                }
            }
        }
        for (const key of candidates) {
            const [x, y] = key.split(',').map(Number);
            if (
                x < -BOARD_OFFSET_X ||
                y < -BOARD_OFFSET_Y ||
                x + matrix[0].length > BOARD_COLUMNS - BOARD_OFFSET_X ||
                y + matrix.length > BOARD_ROWS - BOARD_OFFSET_Y ||
                !validOnBoard(draft.board, matrix, x, y)
            ) {
                continue;
            }
            options.push({ x, y, rotation, matrix });
        }
    }
    return options;
}

function renderBoard() {
    const viewport = root.querySelector('[data-board-viewport]');
    const canvas = root.querySelector('[data-board-canvas]');
    const scrollLeft = viewport.scrollLeft;
    const scrollTop = viewport.scrollTop;
    canvas.replaceChildren();
    canvas.style.width = BOARD_COLUMNS * CELL_SIZE + 'px';
    canvas.style.height = BOARD_ROWS * CELL_SIZE + 'px';
    draft.board.forEach((piece, index) => {
        const card = cardById(piece.id);
        if (!card) return;
        const matrix = rotateMatrix(card.matrix, piece.rotation);
        const element = document.createElement('button');
        element.type = 'button';
        element.className =
            'board__piece challenge-editor__piece' +
            (draft.selectedPiece === index ? ' challenge-editor__piece--selected' : '');
        element.dataset.pieceIndex = String(index);
        element.setAttribute('aria-label', 'Выбрать карту ' + piece.id + (index === 0 ? ', стартовая' : ''));
        element.style.left = (piece.x + BOARD_OFFSET_X) * CELL_SIZE + 'px';
        element.style.top = (piece.y + BOARD_OFFSET_Y) * CELL_SIZE + 'px';
        element.style.width = matrix[0].length * CELL_SIZE + 'px';
        element.style.height = matrix.length * CELL_SIZE + 'px';
        element.style.gridTemplateColumns = 'repeat(' + matrix[0].length + ',' + CELL_SIZE + 'px)';
        element.style.gridTemplateRows = 'repeat(' + matrix.length + ',' + CELL_SIZE + 'px)';
        matrix.flat().forEach((value) => {
            const cell = document.createElement('i');
            cell.className = 'board__cell' + (value ? '' : ' board__cell--wall');
            element.append(cell);
        });
        canvas.append(element);
    });

    if (draft.pendingCard !== null) {
        const options = editorPlacementOptions();
        options.forEach((option, index) => {
            const pin = document.createElement('button');
            pin.type = 'button';
            pin.className = 'board__pin board__pin--' + option.rotation + ' challenge-editor__pin';
            pin.dataset.placementIndex = String(index);
            pin.setAttribute('aria-label', 'Поворот ' + option.rotation * 90 + ' градусов, позиция ' + (index + 1));
            pin.style.left = (option.x + BOARD_OFFSET_X + option.matrix[0].length / 2) * CELL_SIZE - 20 + 'px';
            pin.style.top = (option.y + BOARD_OFFSET_Y + option.matrix.length / 2) * CELL_SIZE - 20 + 'px';
            canvas.append(pin);
        });
        draft.availablePlacements = options;
    } else {
        draft.availablePlacements = [];
        const selected = draft.selectedPiece === null ? null : draft.board[draft.selectedPiece];
        if (selected && draft.selectedPiece > 0) {
            const card = cardById(selected.id);
            const offsets = [
                [0, -22],
                [22, 0],
                [0, 22],
                [-22, 0],
            ];
            for (let rotation = 0; rotation < 4; rotation++) {
                const matrix = rotateMatrix(card.matrix, rotation);
                const candidate = {
                    ...selected,
                    rotation,
                    m: matrix,
                };
                const nextBoard = draft.board.map((piece, index) =>
                    index === draft.selectedPiece ? candidate : piece
                );
                if (!isBoardValid(nextBoard)) continue;
                const pin = document.createElement('button');
                pin.type = 'button';
                pin.className = 'board__pin board__pin--' + rotation + ' challenge-editor__pin';
                pin.dataset.pieceRotation = String(rotation);
                pin.setAttribute('aria-label', 'Повернуть карту на ' + rotation * 90 + ' градусов');
                pin.style.left =
                    (selected.x + BOARD_OFFSET_X + matrix[0].length / 2) * CELL_SIZE - 20 + offsets[rotation][0] + 'px';
                pin.style.top =
                    (selected.y + BOARD_OFFSET_Y + matrix.length / 2) * CELL_SIZE - 20 + offsets[rotation][1] + 'px';
                canvas.append(pin);
            }
        }
    }

    viewport.scrollLeft = scrollLeft;
    viewport.scrollTop = scrollTop;
    if (!boardCentered) {
        boardCentered = true;
        requestAnimationFrame(() => {
            viewport.scrollLeft = (BOARD_OFFSET_X + 3) * CELL_SIZE - viewport.clientWidth / 2;
            viewport.scrollTop = (BOARD_OFFSET_Y + 1.5) * CELL_SIZE - viewport.clientHeight / 2;
        });
    }
    renderBoardControls();
}

function renderBoardControls() {
    const remove = root.querySelector('[data-remove-piece]');
    const selection = root.querySelector('[data-board-selection]');
    const selected = draft.selectedPiece === null ? null : draft.board[draft.selectedPiece];
    const pending = draft.pendingCard !== null;
    remove.disabled = !selected || draft.selectedPiece === 0 || pending;
    selection.replaceChildren();
    if (pending) {
        const card = cardById(draft.pendingCard);
        selection.append(createCardPreview(rotateMatrix(card.matrix, 0)));
        const label = document.createElement('span');
        label.textContent = 'Нажми цветную точку на поле, чтобы сразу поставить карту.';
        selection.append(label);
    } else if (selected) {
        const card = cardById(selected.id);
        selection.append(createCardPreview(rotateMatrix(card.matrix, selected.rotation)));
        const label = document.createElement('span');
        label.textContent =
            (draft.selectedPiece === 0 ? 'Стартовая карта закреплена' : 'Выбрана карта #' + selected.id) +
            ' · ' +
            selected.rotation * 90 +
            '°';
        selection.append(label);
    } else selection.textContent = 'Выбери карту на поле или добавь новую.';
}

function confirmPendingPlacement(index) {
    if (draft.pendingCard === null) return;
    const option = draft.availablePlacements[index];
    if (!option || !validOnBoard(draft.board, option.matrix, option.x, option.y)) {
        snackbar('Это положение больше недоступно. Выбери другую точку.', 'error');
        renderBoard();
        return;
    }
    const id = draft.pendingCard;
    draft.board.push({
        id,
        x: option.x,
        y: option.y,
        rotation: option.rotation,
        m: clone(option.matrix),
    });
    draft.deck.delete(id);
    draft.pendingCard = null;
    draft.pendingRotation = 0;
    draft.placementPreview = null;
    draft.selectedPiece = draft.board.length - 1;
    renderBoard();
    updateSaveButton();
}

function selectPiece(index) {
    if (!draft.board[index]) return;
    draft.selectedPiece = index;
    draft.pendingCard = null;
    draft.placementPreview = null;
    renderBoard();
}

function rotateSelectedPieceTo(rotation) {
    if (draft.selectedPiece === null || draft.selectedPiece === 0 || rotation < 0 || rotation > 3) return;
    const index = draft.selectedPiece;
    const piece = draft.board[index];
    const card = cardById(piece.id);
    const candidate = {
        ...piece,
        rotation,
        m: rotateMatrix(card.matrix, rotation),
    };
    const nextBoard = draft.board.map((item, itemIndex) => (itemIndex === index ? candidate : item));
    if (!isBoardValid(nextBoard)) {
        snackbar('В этом повороте нарушается соединение с соседними тоннелями.', 'error');
        return;
    }
    draft.board = nextBoard;
    renderBoard();
    updateSaveButton();
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
    renderBoard();
    updateSaveButton();
}

function openPicker(mode) {
    pickerMode = mode;
    if (mode === 'hand' && draft.hand[draft.activeHandSlot] !== null) pickerSlot = draft.activeHandSlot;
    else if (mode === 'hand') {
        const empty = draft.hand.findIndex((id) => id === null);
        pickerSlot = empty >= 0 ? empty : draft.activeHandSlot;
        draft.activeHandSlot = pickerSlot;
    }
    const picker = root.querySelector('[data-picker]');
    picker.classList.remove('hidden');
    const pickerTitles = {
        board: 'Добавить карту на поле',
        hand: 'Выбрать карту в руку',
        deck: 'Настроить колоду добора',
    };
    root.querySelector('[data-picker-title]').textContent = pickerTitles[mode];
    root.querySelector('[data-picker-hint]').textContent =
        mode === 'deck'
            ? 'Нажимай на карты, чтобы добавить их в колоду или убрать из неё.'
            : 'Карты показаны по две в ряд.';
    renderPicker();
}

function closePicker() {
    if (!root) return;
    root.querySelector('[data-picker]').classList.add('hidden');
    pickerMode = null;
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
        button.append(createCardPreview(card.matrix));
        const info = document.createElement('span');
        info.className = 'challenge-editor__catalog-info';
        const title = document.createElement('strong');
        title.textContent = 'Карта #' + card.id;
        const note = document.createElement('small');
        if (pickerMode === 'deck') note.textContent = selected ? 'В колоде добора' : 'Не входит в колоду';
        else note.textContent = 'Выбрать карту';
        info.append(title, note);
        button.append(info);
        if (pickerMode === 'deck') {
            const mark = document.createElement('span');
            mark.className = 'challenge-editor__catalog-mark';
            mark.textContent = selected ? '✓' : '+';
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
        renderHandSlots();
        updateSaveButton();
        return;
    }
    draft.pendingCard = id;
    draft.pendingRotation = 0;
    draft.placementPreview = null;
    draft.selectedPiece = null;
    closePicker();
    renderBoard();
}

function clearHandSlot(index) {
    const previous = draft.hand[index];
    if (previous !== null) draft.deck.add(previous);
    draft.hand[index] = null;
    draft.activeHandSlot = index;
    renderHandSlots();
    updateSaveButton();
}

function renderHandSlots() {
    const container = root.querySelector('[data-hand-slots]');
    container.replaceChildren();
    draft.hand.forEach((id, index) => {
        const slot = document.createElement('div');
        slot.className = 'challenge-editor__hand-slot-wrap';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'challenge-editor__hand-slot' + (draft.activeHandSlot === index ? ' is-active' : '');
        button.dataset.handSlot = String(index);
        if (id === null) {
            button.textContent = '＋ Выбрать карту';
        } else {
            const card = cardById(id);
            button.append(createCardPreview(card.matrix));
            const label = document.createElement('strong');
            label.textContent = 'Карта #' + id;
            button.append(label);
        }
        const number = document.createElement('span');
        number.className = 'challenge-editor__hand-number';
        number.textContent = 'Слот ' + (index + 1);
        slot.append(number, button);
        if (id !== null) {
            const clear = document.createElement('button');
            clear.type = 'button';
            clear.className = 'challenge-editor__remove';
            clear.dataset.handClear = String(index);
            clear.textContent = 'Убрать';
            slot.append(clear);
        }
        container.append(slot);
    });
}

function renderDeck() {
    const list = root.querySelector('[data-deck-list]');
    const count = root.querySelector('[data-deck-count]');
    const clearButton = root.querySelector('[data-deck-clear]');
    const ids = [...draft.deck].sort((a, b) => a - b);
    count.textContent = 'В колоде добора: ' + ids.length + ' карт';
    clearButton.disabled = ids.length === 0;
    list.replaceChildren();
    if (!ids.length) {
        const empty = document.createElement('p');
        empty.className = 'note';
        empty.textContent = 'Колода добора пустая. После стартовой руки новые карты приходить не будут.';
        list.append(empty);
        return;
    }
    ids.forEach((id) => {
        const card = cardById(id);
        if (!card) return;
        const item = document.createElement('div');
        item.className = 'challenge-editor__deck-card';
        item.append(createCardPreview(card.matrix));
        const label = document.createElement('strong');
        label.textContent = 'Карта #' + id;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'challenge-editor__remove';
        remove.dataset.deckRemove = String(id);
        remove.textContent = 'Убрать';
        item.append(label, remove);
        list.append(item);
    });
}

function challengeValidationIssues() {
    return draft.title.trim() ? [] : ['добавь название'];
}

function updateSaveButton() {
    if (!root || !draft) return;
    const issues = challengeValidationIssues();
    const button = root.querySelector('[data-save]');
    button.disabled = false;
    button.textContent = issues.length
        ? 'Укажи название'
        : draft.challengeId
          ? 'Сохранить изменения'
          : 'Опубликовать испытание';
    const status = root.querySelector('[data-editor-status]');
    status.textContent = issues.length
        ? 'Для публикации достаточно указать название.'
        : 'Название задано — испытание можно опубликовать. Поле, стартовую руку и колоду можно настроить отдельно.';
}

function challengeAccessError(error) {
    const message = String(error?.message || error || 'Неизвестная ошибка');
    if (/permission_denied|permission denied/i.test(message)) {
        return 'Firebase запретил доступ к /challenges. Проверь правила чтения и запись владельцем (ownerUid = auth.uid) в Realtime Database Rules.';
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
    if (!draft) return;
    const button = root.querySelector('[data-save]');
    const issues = challengeValidationIssues();
    if (issues.length) {
        snackbar('Перед публикацией: ' + issues.join('; ') + '.', 'error');
        updateSaveButton();
        return;
    }
    const editing = Boolean(draft.challengeId);
    button.disabled = true;
    button.textContent = editing ? 'Сохраняю…' : 'Публикую…';
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
        activeView = 'library';
        closePicker();
        render();
        snackbar(editing ? 'Изменения сохранены.' : 'Испытание опубликовано в общей библиотеке.');
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
            (Array.isArray(challenge.board) ? challenge.board.length : 0) +
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

    // Editing must remain possible even when the published layout violates game rules.
    // Normalize recoverable fields instead of rejecting the entire challenge.
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
            ? [pieces[startIndex], ...pieces.filter((_, index) => index !== startIndex && pieces[index].id !== startCard.id)]
            : [{ id: startCard.id, x: 0, y: 0, rotation: 0, m: clone(startCard.matrix) }, ...pieces.filter((piece) => piece.id !== startCard.id)];

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
    draft.placementPreview = null;
    boardCentered = false;
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
