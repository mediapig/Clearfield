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
    state.cells.forEach(function (cell, index) {
      if (cell.revealed) return;
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

  function respectsRevealedNumbers(state, mineList) {
    if (mineList.length !== state.mines) return false;
    const mines = new Set(mineList);
    for (let index = 0; index < state.cells.length; index += 1) {
      const cell = state.cells[index];
      if (!cell.revealed) continue;
      if (mines.has(index)) return false;
      let count = 0;
      const neighbors = neighborIndexes(state.cols, state.rows, index);
      for (let i = 0; i < neighbors.length; i += 1) {
        if (mines.has(neighbors[i])) count += 1;
      }
      if (count !== cell.adjacent) return false;
    }
    return true;
  }

  function sampleConsistentMines(state, hidden, before) {
    const frontier = [];
    const interior = [];
    hidden.forEach(function (index) {
      const neighbors = neighborIndexes(state.cols, state.rows, index);
      let touches = false;
      for (let i = 0; i < neighbors.length; i += 1) {
        if (state.cells[neighbors[i]].revealed) {
          touches = true;
          break;
        }
      }
      if (touches) frontier.push(index);
      else interior.push(index);
    });
    shuffleInPlace(frontier, state.rng);

    const constraints = [];
    state.cells.forEach(function (cell, index) {
      if (!cell.revealed) return;
      const unknowns = [];
      neighborIndexes(state.cols, state.rows, index).forEach(function (neighbor) {
        if (!state.cells[neighbor].revealed) unknowns.push(neighbor);
      });
      if (unknowns.length > 0) constraints.push({ cells: unknowns, need: cell.adjacent });
    });

    const assign = new Array(state.cells.length);
    let found = null;
    let nodes = 0;

    function undo(forced) {
      for (let i = 0; i < forced.length; i += 1) assign[forced[i]] = undefined;
    }

    function propagate() {
      const forced = [];
      let changed = true;
      while (changed) {
        changed = false;
        for (let c = 0; c < constraints.length; c += 1) {
          const constraint = constraints[c];
          let mines = 0;
          const unknown = [];
          for (let i = 0; i < constraint.cells.length; i += 1) {
            const index = constraint.cells[i];
            const value = assign[index];
            if (value === 1) mines += 1;
            else if (value !== 0) unknown.push(index);
          }
          if (mines > constraint.need || mines + unknown.length < constraint.need) {
            undo(forced);
            return null;
          }
          if (unknown.length === 0) continue;
          const fill = mines === constraint.need ? 0 : mines + unknown.length === constraint.need ? 1 : -1;
          if (fill === -1) continue;
          for (let i = 0; i < unknown.length; i += 1) {
            const index = unknown[i];
            if (assign[index] !== undefined) continue;
            assign[index] = fill;
            forced.push(index);
            changed = true;
          }
        }

        let placed = 0;
        let unknownFrontier = 0;
        for (let i = 0; i < frontier.length; i += 1) {
          const value = assign[frontier[i]];
          if (value === 1) placed += 1;
          else if (value !== 0) unknownFrontier += 1;
        }
        if (state.mines < placed || state.mines > placed + unknownFrontier + interior.length) {
          undo(forced);
          return null;
        }
      }
      return forced;
    }

    function finish() {
      const mines = [];
      for (let i = 0; i < frontier.length; i += 1) {
        if (assign[frontier[i]] === 1) mines.push(frontier[i]);
      }
      const need = state.mines - mines.length;
      if (need < 0 || need > interior.length) return false;
      const attempts = Math.max(1, Math.min(12, interior.length + 1));
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const pool = interior.slice();
        shuffleInPlace(pool, state.rng);
        const chosen = mines.concat(pool.slice(0, need));
        chosen.sort(function (a, b) {
          return a - b;
        });
        if (!sameIndexes(before, chosen) && respectsRevealedNumbers(state, chosen)) {
          found = chosen;
          return true;
        }
      }
      return false;
    }

    function dfs() {
      if (found || nodes > 8000) return Boolean(found);
      nodes += 1;
      const forced = propagate();
      if (!forced) return false;
      let next = -1;
      for (let i = 0; i < frontier.length; i += 1) {
        if (assign[frontier[i]] === undefined) {
          next = frontier[i];
          break;
        }
      }
      if (next === -1) {
        const ok = finish();
        undo(forced);
        return ok;
      }
      const choices = state.rng() < 0.5 ? [1, 0] : [0, 1];
      for (let i = 0; i < choices.length; i += 1) {
        assign[next] = choices[i];
        if (dfs()) {
          undo(forced);
          return true;
        }
        assign[next] = undefined;
      }
      undo(forced);
      return false;
    }

    dfs();
    return found;
  }

  function reshuffle(state) {
    if (!state.shift || !state.placed || state.status !== "playing") return;
    const hidden = [];
    state.cells.forEach(function (cell, index) {
      if (!cell.revealed) hidden.push(index);
    });
    if (hidden.length <= state.mines) return;

    const before = mineIndexes(state);
    const next = sampleConsistentMines(state, hidden, before);
    if (!next) return;
    const revealedNumbers = state.cells.map(function (cell) {
      return cell.revealed ? cell.adjacent : null;
    });
    applyMines(state, next);
    revealedNumbers.forEach(function (number, index) {
      if (number !== null) state.cells[index].adjacent = number;
    });
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
