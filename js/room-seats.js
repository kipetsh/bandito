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
    // A player who leaves a running game by accident can come back by the code: the hand waits for them.
    if (game?.started && !game.finished && game.hands?.[uid]?.length) {
        game.left = { ...game.left, [uid]: { hand: game.hands[uid], at: now } };
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

// The game with the player's hand back from game.left, or undefined when there is nothing to return.
export function returnToGame(game, uid) {
    const left = game.left?.[uid];
    if (!game.started || game.finished || !left) return;
    game.hands = { ...game.hands, [uid]: left.hand };
    delete game.left[uid];
    return game;
}
