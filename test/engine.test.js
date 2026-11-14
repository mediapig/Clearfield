const assert = require("assert");
const { createGame } = require("../engine");

function mulberry32(seed) {
  let value = seed >>> 0;
  return function () {
    value = (value + 0x6d2b79f5) | 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mineCount(state) {
  return state.cells.filter((cell) => cell.mine).length;
}

function assertAdjacent(state) {
  state.cells.forEach((cell, index) => {
    if (cell.mine) {
      assert.strictEqual(cell.adjacent, 0);
      return;
    }
    const x = index % state.cols;
    const y = Math.floor(index / state.cols);
    let count = 0;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= state.cols || ny >= state.rows) continue;
        if (state.cells[ny * state.cols + nx].mine) count += 1;
      }
    }
    assert.strictEqual(cell.adjacent, count, `adjacent mismatch at ${index}`);
  });
}

function testRejectsBadBoards() {
  assert.throws(() => createGame({ cols: 0, rows: 9, mines: 1 }));
  assert.throws(() => createGame({ cols: 3, rows: 3, mines: 9 }));
  assert.throws(() => createGame({ cols: 3, rows: 3, mines: 0 }));
  assert.throws(() => createGame({ cols: 3, rows: 3, mines: 1, layout: [true] }));
}

function testFlagDoesNotStartOrBlockFirstClick() {
  const game = createGame({ cols: 9, rows: 9, mines: 10, rng: () => 0.25, shift: false });
  game.toggleFlag(0);
  game.reveal(0);
  game.chord(4);
  assert.strictEqual(game.state.placed, false);
  assert.strictEqual(game.state.status, "ready");
  assert.strictEqual(mineCount(game.state), 0);

  game.toggleFlag(0);
  game.reveal(0);
  assert.strictEqual(game.state.placed, true);
  assert.strictEqual(game.state.cells[0].mine, false);
  assert.strictEqual(game.state.cells[0].adjacent, 0);
  assert.ok(game.state.revealedSafe > 1);
  assert.strictEqual(mineCount(game.state), 10);
  assertAdjacent(game.state);
}

function testFirstClickOpensAClearing() {
  for (let seed = 1; seed <= 30; seed += 1) {
    const game = createGame({
      cols: 9,
      rows: 9,
      mines: 10,
      rng: mulberry32(seed),
      shift: false,
    });
    game.reveal(40);
    assert.strictEqual(game.state.cells[40].mine, false);
    assert.strictEqual(game.state.cells[40].adjacent, 0);
    assert.ok(game.state.revealedSafe > 1);
    assert.strictEqual(mineCount(game.state), 10);
    assertAdjacent(game.state);
  }
}

function testDenseBoardStillProtectsTheFirstCell() {
  const game = createGame({ cols: 4, rows: 4, mines: 15, rng: () => 0 });
  game.reveal(5);
  assert.strictEqual(game.state.cells[5].mine, false);
  assert.strictEqual(mineCount(game.state), 15);
  assert.notStrictEqual(game.state.status, "lost");
}

function testFloodWinAndLoss() {
  const layout = [
    false, false, false,
    false, false, false,
    false, false, true,
  ];
  const won = createGame({ cols: 3, rows: 3, layout });
  won.reveal(0);
  assert.strictEqual(won.state.status, "won");
  assert.strictEqual(won.state.revealedSafe, 8);
  assert.strictEqual(won.state.cells[8].flagged, true);
  assert.strictEqual(won.state.flags, 1);
  won.reveal(1);
  assert.strictEqual(won.state.status, "won");

  const lost = createGame({ cols: 3, rows: 3, layout });
  lost.toggleFlag(1);
  lost.reveal(8);
  assert.strictEqual(lost.state.status, "lost");
  assert.strictEqual(lost.state.cells[8].exploded, true);
  assert.strictEqual(lost.state.cells[1].wrong, true);
  assert.strictEqual(lost.state.cells[1].revealed, false);
}

function testChord() {
  const layout = [
    false, false, false,
    false, false, false,
    false, false, true,
  ];
  const opened = createGame({ cols: 3, rows: 3, layout, shift: false });
  opened.reveal(5);
  assert.strictEqual(opened.state.cells[5].adjacent, 1);
  assert.strictEqual(opened.state.revealedSafe, 1);
  opened.chord(5);
  assert.strictEqual(opened.state.revealedSafe, 1);
  assert.strictEqual(opened.state.status, "playing");

  const won = createGame({ cols: 3, rows: 3, layout, shift: false });
  won.reveal(5);
  won.toggleFlag(8);
  won.chord(5);
  assert.strictEqual(won.state.status, "won");

  const lost = createGame({ cols: 3, rows: 3, layout, shift: false });
  lost.reveal(5);
  lost.toggleFlag(4);
  lost.chord(5);
  assert.strictEqual(lost.state.status, "lost");
  assert.strictEqual(lost.state.cells[8].exploded, true);
  assert.strictEqual(lost.state.cells[4].wrong, true);
}

function testSolverAlwaysWins() {
  const sizes = [
    { cols: 9, rows: 9, mines: 10 },
    { cols: 16, rows: 16, mines: 40 },
    { cols: 30, rows: 16, mines: 99 },
  ];
  sizes.forEach((size) => {
    for (let seed = 1; seed <= 5; seed += 1) {
      const game = createGame({
        ...size,
        rng: mulberry32(seed * 17 + size.mines),
        shift: false,
      });
      game.reveal(0);
      assert.notStrictEqual(game.state.status, "lost");
      game.state.cells.forEach((cell, index) => {
        if (!cell.mine) game.reveal(index);
      });
      assert.strictEqual(game.state.status, "won");
      assert.strictEqual(game.state.flags, game.state.mines);
      assert.ok(game.state.cells.every((cell) => !cell.exploded));
    }
  });
}

function testFlagToggle() {
  const game = createGame({
    cols: 3,
    rows: 3,
    layout: [true, false, true, false, false, false, true, false, true],
  });
  game.reveal(4);
  assert.strictEqual(game.state.status, "playing");
  assert.strictEqual(game.state.revealedSafe, 1);
  game.toggleFlag(0);
  game.toggleFlag(0);
  assert.strictEqual(game.state.flags, 0);
  assert.strictEqual(game.state.cells[0].flagged, false);
  game.toggleFlag(0);
  game.reveal(0);
  assert.strictEqual(game.state.cells[0].revealed, false);
  assert.strictEqual(game.state.status, "playing");
}

function mineSignature(state) {
  return state.cells.map((cell) => (cell.mine ? "1" : "0")).join("");
}

function testShiftChangesMinesAndNumbers() {
  for (let seed = 1; seed <= 20; seed += 1) {
    const game = createGame({ cols: 8, rows: 8, mines: 10, rng: mulberry32(seed) });
    game.reveal(27);
    assert.strictEqual(game.state.status, "playing");
    assert.strictEqual(mineCount(game.state), 10);
    assertAdjacent(game.state);
    game.state.cells.forEach((cell) => {
      if (cell.revealed) assert.strictEqual(cell.mine, false);
      if (cell.mine) assert.strictEqual(cell.revealed, false);
    });

    const minesBefore = mineSignature(game.state);
    const numbersBefore = game.state.cells.map((cell) => (cell.revealed ? cell.adjacent : -1));
    game.reveal(27);
    assert.notStrictEqual(mineSignature(game.state), minesBefore);
    const numbersChanged = numbersBefore.some((number, index) => {
      return number !== -1 && number !== game.state.cells[index].adjacent;
    });
    assert.ok(numbersChanged, `revealed numbers stayed put for seed ${seed}`);
    assert.strictEqual(mineCount(game.state), 10);
    assert.strictEqual(game.state.status, "playing");
    assertAdjacent(game.state);
    game.state.cells.forEach((cell) => {
      if (cell.revealed) assert.strictEqual(cell.mine, false);
    });
  }
}

function testFlagAlsoShifts() {
  const game = createGame({ cols: 8, rows: 8, mines: 10, rng: mulberry32(9) });
  game.reveal(20);
  const before = mineSignature(game.state);
  const hidden = game.state.cells.findIndex((cell) => !cell.revealed);
  game.toggleFlag(hidden);
  assert.notStrictEqual(mineSignature(game.state), before);
  assert.strictEqual(game.state.cells[hidden].flagged, true);
  assert.strictEqual(mineCount(game.state), 10);
  assertAdjacent(game.state);
}

function testLostBoardStopsShifting() {
  const game = createGame({ cols: 6, rows: 6, mines: 8, rng: mulberry32(5) });
  game.reveal(0);
  const mineIndex = game.state.cells.findIndex((cell) => cell.mine);
  const layout = mineSignature(game.state);
  game.reveal(mineIndex);
  assert.strictEqual(game.state.status, "lost");
  assert.strictEqual(game.state.cells[mineIndex].exploded, true);
  assert.strictEqual(mineSignature(game.state), layout);
  game.reveal(0);
  game.toggleFlag(1);
  assert.strictEqual(mineSignature(game.state), layout);
}

function testShiftStillReachesAWin() {
  const game = createGame({ cols: 9, rows: 9, mines: 10, rng: mulberry32(4) });
  game.reveal(40);
  let guard = 0;
  while (game.state.status === "playing" && guard < 400) {
    const index = game.state.cells.findIndex((cell) => !cell.mine && !cell.revealed && !cell.flagged);
    assert.ok(index >= 0);
    game.reveal(index);
    guard += 1;
  }
  assert.strictEqual(game.state.status, "won");
  assert.ok(game.state.cells.every((cell) => !cell.exploded));
}

testRejectsBadBoards();
testFlagDoesNotStartOrBlockFirstClick();
testFirstClickOpensAClearing();
testDenseBoardStillProtectsTheFirstCell();
testFloodWinAndLoss();
testChord();
testFlagToggle();
testSolverAlwaysWins();
console.log("engine tests passed");
