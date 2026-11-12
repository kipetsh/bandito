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
    // and the room remembers the player: they can come back by the code and draw a new hand.
    if (game?.started && !game.finished) {
        game.deck = [...(game.hands?.[uid] || []), ...(game.deck || [])];
        game.left = { ...game.left, [uid]: { at: now } };
    }
    if (game?.hands) delete game.hands[uid];
    if (game?.started && !game.finished) {
        if (game.turnUid === uid) {
            game.turnUid = remaining[0];
            game.turnStartedAt = now;
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
}

// The game with a new hand drawn for a player who left it, or undefined when the player was not in it.
export function returnToGame(game, uid, handSize = 3) {
    if (!game.started || game.finished || !game.left?.[uid]) return;
    const deck = game.deck || [];
    const hand = [];
    while (hand.length < handSize && deck.length) hand.push(deck.pop());
    game.deck = deck;
    game.hands = { ...game.hands, [uid]: hand };
    delete game.left[uid];
    return game;
}
