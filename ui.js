(function () {
  const PRESETS = {
    beginner: { label: "初级", cols: 9, rows: 9, mines: 10 },
    intermediate: { label: "中级", cols: 16, rows: 16, mines: 40 },
    expert: { label: "高级", cols: 30, rows: 16, mines: 99 },
  };

  const board = document.querySelector("#board");
  const statusEl = document.querySelector("#status");
  const bestEl = document.querySelector("#best");
  const mineEl = document.querySelector("#mine-count");
  const timerEl = document.querySelector("#timer");
  const resetBtn = document.querySelector("#reset");
  const colsInput = document.querySelector("#cols");
  const rowsInput = document.querySelector("#rows");
  const minesInput = document.querySelector("#mines");

  let currentName = "beginner";
  let currentConfig = PRESETS.beginner;
  let game = null;
  let buttons = [];
  let inputMode = "reveal";
  let startedAt = null;
  let clockId = null;
  let frozen = 0;
  let settled = false;
  let newRecord = false;
  let faceDown = false;
  let holdTimer = null;
  let suppressIndex = -1;
  let openClickTimer = null;
  let focusIndex = 0;

  function pad(value) {
    const clamped = Math.max(-99, Math.min(999, value));
    const text = String(Math.abs(clamped)).padStart(3, "0");
    return clamped < 0 ? "-" + text.slice(1) : text;
  }

  function secondsNow() {
    if (startedAt === null) return frozen;
    return Math.min(999, Math.floor((Date.now() - startedAt) / 1000));
  }

  function storageGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (error) {
      return;
    }
  }

  function bestKey() {
    return currentName === "custom" ? null : "clearfield.best." + currentName;
  }

  function readBest() {
    const key = bestKey();
    if (!key) return null;
    const raw = storageGet(key);
    if (raw === null || raw === "") return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }

  function writeBest(seconds) {
    const key = bestKey();
    if (!key) return false;
    const prev = readBest();
    if (prev !== null && seconds >= prev) return false;
    storageSet(key, String(seconds));
    return true;
  }

  function clearHold() {
    clearTimeout(holdTimer);
    holdTimer = null;
  }

  function freezeClock() {
    if (clockId === null && startedAt === null) return;
    frozen = secondsNow();
    clearInterval(clockId);
    clockId = null;
    startedAt = null;
  }

  function resetClock() {
    clearInterval(clockId);
    clockId = null;
    startedAt = null;
    frozen = 0;
    settled = false;
    newRecord = false;
    faceDown = false;
  }

  function classFor(cell) {
    if (cell.exploded) return "exploded";
    if (cell.revealed && cell.mine) return "mine";
    if (cell.wrong) return "wrong";
    if (cell.revealed) return cell.adjacent ? "open n" + cell.adjacent : "open";
    if (cell.flagged) return "flag";
    return "hidden";
  }

  function markupFor(cell) {
    if (cell.wrong) return "×";
    if (cell.revealed && cell.mine) return '<span class="mine"></span>';
    if (cell.revealed && cell.adjacent > 0) return String(cell.adjacent);
    if (!cell.revealed && cell.flagged) return '<span class="flag"></span>';
    return "";
  }

  function labelFor(cell, index) {
    const col = (index % game.state.cols) + 1;
    const row = Math.floor(index / game.state.cols) + 1;
    const where = row + "行" + col + "列";
    if (cell.exploded) return where + "，踩中的雷";
    if (cell.wrong) return where + "，旗标错误";
    if (cell.revealed && cell.mine) return where + "，雷";
    if (cell.revealed && cell.adjacent > 0) return where + "，数字 " + cell.adjacent;
    if (cell.revealed) return where + "，空地";
    if (cell.flagged) return where + "，已插旗";
    return where + "，未翻开";
  }

  function faceGlyph() {
    if (game.state.status === "won") return "◠";
    if (game.state.status === "lost") return "×";
    if (faceDown) return "○";
    return "◡";
  }

  function statusText() {
    const state = game.state;
    if (state.status === "ready") {
      return state.flags
        ? "已插 " + state.flags + " 面旗。点一格开始。"
        : "点一格开始。第一下会打开一块空地。之后没翻开的雷会在不改数字的前提下移动。";
    }
    if (state.status === "playing") {
      const left = state.cells.length - state.mines - state.revealedSafe;
      return "还剩 " + left + " 个安全格。已翻开的数字不变。";
    }
    if (state.status === "won") {
      const record = newRecord ? "新纪录。" : "";
      return "这块地清完了，用时 " + frozen + " 秒。" + record;
    }
    const wrong = state.cells.some((cell) => cell.wrong);
    return wrong ? "踩到雷了。插错的旗打了叉。" : "踩到雷了。";
  }

  function bestText() {
    if (currentName === "custom") return "自定义棋盘不记纪录";
    const best = readBest();
    if (best === null) return PRESETS[currentName].label + " · 还没有纪录";
    return PRESETS[currentName].label + " · 纪录 " + best + " 秒";
  }

  function paintHud() {
    mineEl.textContent = pad(game.state.mines - game.state.flags);
    timerEl.textContent = pad(secondsNow());
    resetBtn.textContent = faceGlyph();
    resetBtn.classList.toggle("is-won", game.state.status === "won");
    resetBtn.classList.toggle("is-lost", game.state.status === "lost");
    statusEl.textContent = statusText();
    bestEl.textContent = bestText();
  }

  function paint() {
    game.state.cells.forEach((cell, index) => {
      const button = buttons[index];
      const view = classFor(cell) + markupFor(cell);
      const previous = button.dataset.view;
      button.className = "cell " + classFor(cell);
      button.setAttribute("aria-label", labelFor(cell, index));
      if (previous && previous !== view && cell.revealed) {
        button.classList.add("shifted");
      }
      if (previous !== view) {
        button.dataset.view = view;
        button.innerHTML = markupFor(cell);
      }
    });
    paintHud();
  }

  function syncClock() {
    const status = game.state.status;
    if (status === "playing" && startedAt === null && clockId === null) {
      startedAt = Date.now();
      frozen = 0;
      clockId = setInterval(paintHud, 200);
    }
    if ((status === "won" || status === "lost") && !settled) {
      freezeClock();
      settled = true;
      if (status === "won") newRecord = writeBest(frozen);
    }
  }

  function afterMove() {
    syncClock();
    paint();
  }

  function renderBoard() {
    clearHold();
    board.style.setProperty("--cols", String(game.state.cols));
    board.style.setProperty("--rows", String(game.state.rows));
    board.replaceChildren();
    buttons = game.state.cells.map((_, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cell hidden";
      button.dataset.index = String(index);
      button.dataset.view = "";
      button.tabIndex = index === focusIndex ? 0 : -1;
      board.appendChild(button);
      return button;
    });
  }

  function focusCell(index) {
    if (!buttons[index]) return;
    focusIndex = index;
    buttons.forEach((button, buttonIndex) => {
      button.tabIndex = buttonIndex === index ? 0 : -1;
    });
    buttons[index].focus();
  }

  function cancelOpenClick() {
    clearTimeout(openClickTimer);
    openClickTimer = null;
  }

  function start() {
    cancelOpenClick();
    resetClock();
    focusIndex = 0;
    game = Clearfield.createGame({
      cols: currentConfig.cols,
      rows: currentConfig.rows,
      mines: currentConfig.mines,
    });
    renderBoard();
    paint();
  }

  function markPreset(name) {
    document.querySelectorAll(".diff").forEach((button) => {
      button.classList.toggle("is-on", button.dataset.diff === name);
    });
  }

  function setMode(mode) {
    inputMode = mode;
    document.querySelector("#mode-reveal").classList.toggle("is-on", mode === "reveal");
    document.querySelector("#mode-flag").classList.toggle("is-on", mode === "flag");
    document.querySelector("#mode-reveal").setAttribute("aria-pressed", mode === "reveal");
    document.querySelector("#mode-flag").setAttribute("aria-pressed", mode === "flag");
  }

  function cellIndex(target) {
    const button = target.closest(".cell");
    if (!button || !board.contains(button)) return -1;
    return Number(button.dataset.index);
  }

  document.querySelectorAll(".diff").forEach((button) => {
    button.addEventListener("click", () => {
      currentName = button.dataset.diff;
      currentConfig = PRESETS[currentName];
      colsInput.value = String(currentConfig.cols);
      rowsInput.value = String(currentConfig.rows);
      minesInput.value = String(currentConfig.mines);
      markPreset(currentName);
      start();
    });
  });

  document.querySelector("#custom").addEventListener("submit", (event) => {
    event.preventDefault();
    const cols = Number(colsInput.value);
    const rows = Number(rowsInput.value);
    const mines = Number(minesInput.value);
    try {
      Clearfield.createGame({ cols: cols, rows: rows, mines: mines });
    } catch (error) {
      statusEl.textContent = "列 2–60，行 2–40，雷至少 1 颗，并且至少留出一格空地。";
      return;
    }
    currentName = "custom";
    currentConfig = { cols: cols, rows: rows, mines: mines };
    markPreset("");
    start();
  });

  resetBtn.addEventListener("click", start);

  document.querySelector("#mode-reveal").addEventListener("click", () => setMode("reveal"));
  document.querySelector("#mode-flag").addEventListener("click", () => setMode("flag"));

  board.addEventListener("pointerdown", (event) => {
    const index = cellIndex(event.target);
    if (index < 0 || event.button !== 0) return;
    if (inputMode === "reveal" && game.state.status !== "won" && game.state.status !== "lost") {
      faceDown = true;
      paintHud();
    }
    if (event.pointerType !== "touch") return;
    clearHold();
    holdTimer = setTimeout(() => {
      suppressIndex = index;
      game.toggleFlag(index);
      afterMove();
    }, 420);
  });

  board.addEventListener("pointerup", clearHold);
  board.addEventListener("pointerleave", clearHold);
  board.addEventListener("pointercancel", clearHold);
  window.addEventListener("pointerup", () => {
    if (!faceDown) return;
    faceDown = false;
    paintHud();
  });

  board.addEventListener("click", (event) => {
    const index = cellIndex(event.target);
    if (index < 0) return;
    if (suppressIndex === index) {
      suppressIndex = -1;
      return;
    }
    if (inputMode === "flag") {
      cancelOpenClick();
      game.toggleFlag(index);
      afterMove();
      return;
    }
    if (game.state.cells[index].revealed) {
      cancelOpenClick();
      openClickTimer = setTimeout(function () {
        openClickTimer = null;
        game.reveal(index);
        afterMove();
      }, 200);
      return;
    }
    cancelOpenClick();
    game.reveal(index);
    afterMove();
  });

  board.addEventListener("contextmenu", (event) => {
    const index = cellIndex(event.target);
    cancelOpenClick();
    event.preventDefault();
    if (index < 0) return;
    game.toggleFlag(index);
    afterMove();
  });

  board.addEventListener("dblclick", (event) => {
    const index = cellIndex(event.target);
    cancelOpenClick();
    if (index < 0 || !game.state.cells[index].revealed) return;
    game.chord(index);
    afterMove();
  });

  board.addEventListener("auxclick", (event) => {
    const index = cellIndex(event.target);
    cancelOpenClick();
    if (index < 0 || event.button !== 1) return;
    event.preventDefault();
    if (game.state.cells[index].revealed) game.chord(index);
    else game.toggleFlag(index);
    afterMove();
  });

  board.addEventListener("keydown", (event) => {
    const index = cellIndex(document.activeElement);
    if (index < 0) return;
    const cols = game.state.cols;
    const rows = game.state.rows;
    let next = null;
    if (event.key === "ArrowLeft" && index % cols !== 0) next = index - 1;
    if (event.key === "ArrowRight" && index % cols !== cols - 1) next = index + 1;
    if (event.key === "ArrowUp" && index - cols >= 0) next = index - cols;
    if (event.key === "ArrowDown" && index + cols < cols * rows) next = index + cols;
    if (next !== null) {
      event.preventDefault();
      focusCell(next);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (inputMode === "flag") game.toggleFlag(index);
      else game.reveal(index);
      afterMove();
    } else if (event.key === "f" || event.key === "F") {
      event.preventDefault();
      game.toggleFlag(index);
      afterMove();
    } else if (event.key === "d" || event.key === "D") {
      event.preventDefault();
      if (game.state.cells[index].revealed) game.chord(index);
      afterMove();
    }
  });

  start();
})();
