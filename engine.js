(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.Clearfield = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function createGame(options) {
    const cols = options.cols;
    const rows = options.rows;
    const layout = options.layout || null;
    let mines = options.mines;

    if (!Number.isInteger(cols) || cols < 1 || cols > 60) {
      throw new Error("cols out of range");
    }
    if (!Number.isInteger(rows) || rows < 1 || rows > 40) {
      throw new Error("rows out of range");
    }

    const total = cols * rows;
    if (layout && layout.length !== total) {
      throw new Error("layout length");
    }
    if (layout) {
      mines = layout.reduce(function (count, isMine) {
        return count + (isMine ? 1 : 0);
      }, 0);
    }
    if (!Number.isInteger(mines) || mines < 1 || mines >= total) {
      throw new Error("mines out of range");
    }

    const cells = [];
    for (let index = 0; index < total; index += 1) {
      cells.push({
        mine: false,
        revealed: false,
        flagged: false,
        exploded: false,
        wrong: false,
        adjacent: 0,
      });
    }

    const state = {
      cols: cols,
      rows: rows,
      mines: mines,
      cells: cells,
      status: "ready",
      placed: false,
      revealedSafe: 0,
      flags: 0,
      shift: options.shift !== false,
      shifts: 0,
      rng: typeof options.rng === "function" ? options.rng : Math.random,
    };

    if (layout) {
      layout.forEach(function (isMine, index) {
        state.cells[index].mine = Boolean(isMine);
      });
      countAdjacent(state);
      state.placed = true;
    }

    return {
      state: state,
      reveal: function (index) {
        reveal(state, index);
      },
      toggleFlag: function (index) {
        toggleFlag(state, index);
      },
      chord: function (index) {
        chord(state, index);
      },
    };
  }

  function inRange(state, index) {
    return Number.isInteger(index) && index >= 0 && index < state.cells.length;
  }

  function neighborIndexes(cols, rows, index) {
    const x = index % cols;
    const y = Math.floor(index / cols);
    const found = [];
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        found.push(ny * cols + nx);
      }
    }
    return found;
  }

  function countAdjacent(state) {
    state.cells.forEach(function (cell, index) {
      if (cell.mine) {
        cell.adjacent = 0;
        return;
      }
      let count = 0;
      neighborIndexes(state.cols, state.rows, index).forEach(function (neighbor) {
        if (state.cells[neighbor].mine) count += 1;
      });
      cell.adjacent = count;
    });
  }

  function shuffleInPlace(list, rng) {
    for (let i = list.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      const swap = list[i];
      list[i] = list[j];
      list[j] = swap;
    }
    return list;
  }

  function mineIndexes(state) {
    const found = [];
    state.cells.forEach(function (cell, index) {
      if (cell.mine) found.push(index);
    });
    return found;
  }

  function sameIndexes(left, right) {
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i += 1) {
      if (left[i] !== right[i]) return false;
    }
    return true;
  }

  function applyMines(state, indexes) {
    state.cells.forEach(function (cell) {
      cell.mine = false;
    });
    indexes.forEach(function (index) {
      state.cells[index].mine = true;
    });
    countAdjacent(state);
  }

  function visibleChange(state, mineList, beforeAdjacent) {
    const mines = new Set(mineList);
    let changed = 0;
    state.cells.forEach(function (cell, index) {
      if (!cell.revealed) return;
      let count = 0;
      neighborIndexes(state.cols, state.rows, index).forEach(function (neighbor) {
        if (mines.has(neighbor)) count += 1;
      });
      if (count !== beforeAdjacent[index]) changed += 1;
    });
    return changed;
  }

  function reshuffle(state) {
    if (!state.shift || !state.placed || state.status !== "playing") return;
    const hidden = [];
    state.cells.forEach(function (cell, index) {
      if (!cell.revealed) hidden.push(index);
    });
    if (hidden.length <= state.mines) return;

    const before = mineIndexes(state);
    const beforeAdjacent = state.cells.map(function (cell) {
      return cell.adjacent;
    });
    let best = before;
    let bestRank = -1;
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const pool = hidden.slice();
      shuffleInPlace(pool, state.rng);
      const next = pool.slice(0, state.mines);
      next.sort(function (a, b) {
        return a - b;
      });
      const changed = visibleChange(state, next, beforeAdjacent);
      const different = sameIndexes(before, next) ? 0 : 1;
      const rank = changed * 10 + different;
      if (rank > bestRank) {
        bestRank = rank;
        best = next;
        if (changed > 0 && different === 1) break;
      }
    }
    applyMines(state, best);
    state.shifts += 1;
  }

  function placeMines(state, safeIndex) {
    const total = state.cells.length;
    const zone = new Set([safeIndex]);
    const around = neighborIndexes(state.cols, state.rows, safeIndex);
    if (total - (around.length + 1) >= state.mines) {
      around.forEach(function (index) {
        zone.add(index);
      });
    }

    const pool = [];
    for (let index = 0; index < total; index += 1) {
      if (!zone.has(index)) pool.push(index);
    }

    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(state.rng() * (i + 1));
      const swap = pool[i];
      pool[i] = pool[j];
      pool[j] = swap;
    }

    for (let i = 0; i < state.mines; i += 1) {
      state.cells[pool[i]].mine = true;
    }
    countAdjacent(state);
  }

  function showMines(state) {
    state.cells.forEach(function (cell) {
      if (cell.mine && !cell.flagged) cell.revealed = true;
      if (!cell.mine && cell.flagged) cell.wrong = true;
    });
  }

  function flood(state, index) {
    const cell = state.cells[index];
    if (cell.revealed || cell.flagged || cell.mine) return;
    cell.revealed = true;
    state.revealedSafe += 1;
    if (cell.adjacent !== 0) return;
    neighborIndexes(state.cols, state.rows, index).forEach(function (neighbor) {
      flood(state, neighbor);
    });
  }

  function checkWin(state) {
    const safeTotal = state.cells.length - state.mines;
    if (state.revealedSafe !== safeTotal) return;
    state.cells.forEach(function (cell) {
      if (cell.mine && !cell.flagged) {
        cell.flagged = true;
        state.flags += 1;
      }
    });
    state.status = "won";
  }

  function reveal(state, index) {
    if (!inRange(state, index)) return;
    if (state.status === "won" || state.status === "lost") return;
    const cell = state.cells[index];
    if (cell.revealed || cell.flagged) {
      reshuffle(state);
      return;
    }

    if (!state.placed) {
      placeMines(state, index);
      state.placed = true;
    }
    if (state.status === "ready") state.status = "playing";

    if (cell.mine) {
      cell.exploded = true;
      cell.revealed = true;
      state.status = "lost";
      showMines(state);
      return;
    }

    flood(state, index);
    checkWin(state);
    reshuffle(state);
  }

  function toggleFlag(state, index) {
    if (!inRange(state, index)) return;
    if (state.status === "won" || state.status === "lost") return;
    const cell = state.cells[index];
    if (cell.revealed) {
      reshuffle(state);
      return;
    }
    cell.flagged = !cell.flagged;
    state.flags += cell.flagged ? 1 : -1;
    reshuffle(state);
  }

  function chord(state, index) {
    if (!inRange(state, index)) return;
    if (state.status === "won" || state.status === "lost") return;
    const cell = state.cells[index];
    if (!cell.revealed) return;

    const neighbors = neighborIndexes(state.cols, state.rows, index);
    let flagged = 0;
    neighbors.forEach(function (neighbor) {
      if (state.cells[neighbor].flagged) flagged += 1;
    });
    if (cell.adjacent === 0 || flagged !== cell.adjacent) {
      reshuffle(state);
      return;
    }

    const targets = neighbors.filter(function (neighbor) {
      const other = state.cells[neighbor];
      return !other.flagged && !other.revealed;
    });

    let hit = false;
    targets.forEach(function (neighbor) {
      if (state.cells[neighbor].mine) {
        state.cells[neighbor].exploded = true;
        hit = true;
      }
    });

    if (hit) {
      state.status = "lost";
      showMines(state);
    }

    targets.forEach(function (neighbor) {
      if (!state.cells[neighbor].mine) flood(state, neighbor);
    });

    if (state.status !== "lost") checkWin(state);
    reshuffle(state);
  }

  return { createGame: createGame };
});
