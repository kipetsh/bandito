/* Seats in a room: leaving it and coming back to the running game. Pure changes of the room data,
   applied inside Firebase transactions. */

// The room after the player leaves it, or null when nobody stays. Undefined leaves the room as is.
export function leaveRoom(room, uid, now = Date.now()) {
    if (!room || !room.players || !room.players[uid]) return;
    delete room.players[uid];
    const remaining = Object.keys(room.players);
    if (!remaining.length) return null;
    if (room.owner === uid) room.owner = remaining[0];
    const game = room.game;
    // The hand of a player who leaves a running game goes under the deck, so its cards stay in the game,
    // and the room remembers the player with their cards: coming back by the code returns the same cards.
    if (game?.started && !game.finished) {
        const hand = game.hands?.[uid] || [];
        game.deck = [...hand, ...(game.deck || [])];
        game.left = { ...game.left, [uid]: { cards: hand.map((card) => card.id), at: now } };
    }
    if (game?.hands) delete game.hands[uid];
    if (game?.started && !game.finished) {
        if (game.turnUid === uid) {
            game.turnUid = remaining[0];
            game.turnStartedAt = now;
        }
        // Cards are drawn only after a turn: when nobody has a card, the deck (even with the returned hand)
        // stays untouched and the game ends.
        const noHands = Object.values(game.hands || {}).every((cards) => !cards.length);
        if (noHands) {
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
}

// The game with the player's hand back, or undefined when the player was not in it. Their cards still
// in the deck come back, the cards the others drew meanwhile are replaced from the top of the deck: leaving
// and coming back does not change the hand at will. With no cards for them the player stays marked as left,
// watches the game and can come back again after a reload.
export function returnToGame(game, uid) {
    const left = game.left?.[uid];
    if (!game.started || game.finished || !left) return;
    const deck = game.deck || [];
    const own = left.cards || [];
    const hand = [];
    for (const id of own) {
        const index = deck.findIndex((card) => card.id === id);
        if (index >= 0) hand.push(...deck.splice(index, 1));
    }
    while (hand.length < own.length && deck.length) hand.push(deck.pop());
    if (!hand.length) return game;
    game.deck = deck;
    game.hands = { ...game.hands, [uid]: hand };
    delete game.left[uid];
    return game;
}
