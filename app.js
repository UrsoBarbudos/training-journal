(function () {
  "use strict";

  const db = window.TrainingJournalDB;
  const TIMER_STORAGE_KEY = "training-journal-timer-end";
  const state = {
    workouts: [],
    month: startOfMonth(new Date()),
    selectedDate: toISODate(new Date()),
    current: null,
    menuExerciseId: null,
    undo: null,
    pendingInputUndo: null,
    autosaveTimer: null,
    timerEnd: Number(localStorage.getItem(TIMER_STORAGE_KEY)) || null,
    timerNotified: false,
    cancelArmed: false,
    cancelArmTimer: null,
    drag: null,
  };

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    bindStaticActions();
    bindSecurity();
    try {
      await db.open();
      await showSecurityGate();
      await refreshWorkouts();
      renderCalendar();
    } catch (error) {
      console.error(error);
      document.querySelector("#calendar").innerHTML = '<p class="form-error">Не удалось открыть локальный журнал. Обновите страницу.</p>';
    }
    updateTimer();
    window.setInterval(updateTimer, 250);
    document.addEventListener("visibilitychange", updateTimer);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(console.error);
  }

  function bindStaticActions() {
    document.querySelector("#new-workout").addEventListener("click", () => openImport(state.selectedDate));
    document.querySelector("#import-form").addEventListener("submit", importPlan);
    document.querySelector("#workout-form").addEventListener("submit", openPostWorkout);
    document.querySelector("#post-form").addEventListener("submit", finishWorkout);
    document.querySelector("#copy-summary").addEventListener("click", copySummary);
    document.querySelector("#add-first-exercise").addEventListener("click", () => addExerciseAfter(null));
    document.querySelector("#undo-action").addEventListener("click", undoLastAction);
    document.querySelectorAll("[data-timer-seconds]").forEach((button) => button.addEventListener("click", () => startTimer(Number(button.dataset.timerSeconds))));
    document.querySelector("#custom-timer-open").addEventListener("click", openCustomTimer);
    document.querySelector("#custom-timer-form").addEventListener("input", validateCustomTimer);
    document.querySelector("#custom-timer-form").addEventListener("submit", startCustomTimer);
    document.querySelector("#timer-cancel").addEventListener("click", handleTimerCancel);
    document.querySelectorAll("[data-exercise-action]").forEach((button) => button.addEventListener("click", () => handleExerciseAction(button.dataset.exerciseAction)));
    document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => closeDialog(button.dataset.close)));
    document.querySelectorAll(".sheet-dialog").forEach((dialog) => dialog.addEventListener("click", (event) => {
      if (event.target === dialog) closeDialog(dialog.id);
    }));
    document.querySelector("#exercise-menu-dialog").addEventListener("click", (event) => {
      if (event.target.id === "exercise-menu-dialog") closeDialog("exercise-menu-dialog");
    });
    ["post-pain", "post-discomfort"].forEach((id) => document.querySelector(`#${id}`).addEventListener("input", updateProblemExerciseVisibility));
    bindExerciseList();
  }

  function bindExerciseList() {
    const list = document.querySelector("#exercise-list");
    list.addEventListener("focusin", (event) => {
      if (!event.target.matches("input, textarea")) return;
      state.pendingInputUndo = { target: event.target, snapshot: snapshotCurrent() };
    });
    list.addEventListener("focusout", (event) => {
      state.pendingInputUndo = null;
      if (event.target.matches("textarea")) requestAnimationFrame(() => resizeTextarea(event.target));
    });
    list.addEventListener("input", handleExerciseInput);
    list.addEventListener("click", handleExerciseClick);
    list.addEventListener("pointerdown", handlePointerDown);
    list.addEventListener("pointermove", handlePointerMove);
    list.addEventListener("pointerup", handlePointerUp);
    list.addEventListener("pointercancel", handlePointerUp);
  }

  function bindSecurity() {
    const dialog = document.querySelector("#lock-dialog");
    dialog.addEventListener("cancel", (event) => event.preventDefault());
    document.querySelector("#lock-form").addEventListener("submit", handleSecuritySubmit);
    document.querySelector("#pin").addEventListener("input", clearSecurityError);
    document.querySelector("#pin-confirm").addEventListener("input", clearSecurityError);
  }

  async function showSecurityGate() {
    const security = await db.get("settings", "security");
    const setup = !security;
    const dialog = document.querySelector("#lock-dialog");
    document.querySelector("#lock-title").textContent = setup ? "Создайте PIN-код" : "Training Journal заблокирован";
    document.querySelector("#lock-description").textContent = setup ? "PIN будет защищать журнал на этом устройстве." : "Введите локальный PIN-код для доступа к журналу.";
    document.querySelector("#lock-submit").textContent = setup ? "Создать PIN" : "Разблокировать";
    document.querySelector("#pin-confirm-label").hidden = !setup;
    document.querySelector("#pin-confirm").required = setup;
    document.querySelector("#lock-form").dataset.mode = setup ? "setup" : "unlock";
    document.querySelector("#lock-form").reset();
    clearSecurityError();
    dialog.showModal();
  }

  async function handleSecuritySubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const pin = document.querySelector("#pin").value;
    const confirm = document.querySelector("#pin-confirm").value;
    const error = document.querySelector("#lock-error");
    const submit = document.querySelector("#lock-submit");
    if (!/^\d{6,}$/.test(pin)) { error.textContent = "Используйте не менее 6 цифр."; return; }
    if (form.dataset.mode === "setup" && pin !== confirm) { error.textContent = "PIN-коды не совпадают."; return; }
    submit.disabled = true;
    try {
      if (form.dataset.mode === "setup") {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const hash = await derivePinHash(pin, salt);
        await db.put("settings", { key: "security", version: 1, algorithm: "PBKDF2-SHA-256", iterations: 150000, salt: bytesToBase64(salt), hash: bytesToBase64(hash), createdAt: new Date().toISOString() });
      } else {
        const security = await db.get("settings", "security");
        const candidate = await derivePinHash(pin, base64ToBytes(security.salt), security.iterations);
        if (!safeEqual(candidate, base64ToBytes(security.hash))) { error.textContent = "Неверный PIN-код."; document.querySelector("#pin").select(); return; }
      }
      document.querySelector("#lock-dialog").close();
    } catch (securityError) {
      console.error(securityError);
      error.textContent = "Не удалось проверить PIN. Попробуйте ещё раз.";
    } finally {
      submit.disabled = false;
    }
  }

  async function derivePinHash(pin, salt, iterations = 150000) {
    const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, material, 256));
  }

  function bytesToBase64(bytes) { return btoa(String.fromCharCode(...bytes)); }
  function base64ToBytes(value) { return Uint8Array.from(atob(value), (character) => character.charCodeAt(0)); }
  function safeEqual(left, right) {
    if (left.length !== right.length) return false;
    let difference = 0;
    for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
    return difference === 0;
  }
  function clearSecurityError() { document.querySelector("#lock-error").textContent = ""; }

  async function refreshWorkouts() {
    state.workouts = (await db.getAll("workouts")).map(normalizeWorkout).sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt));
  }

  function normalizeWorkout(workout) {
    return {
      ...workout,
      title: workout.title || workoutLabel(workout),
      status: workout.status || "active",
      skipped: Array.isArray(workout.skipped) ? workout.skipped : [],
      exercises: (workout.exercises || []).map((exercise) => {
        const oldSets = exercise.actualSets || [];
        const workingSets = exercise.sets || oldSets.filter((set) => set.type !== "warmup");
        const warmupSets = exercise.warmupSets || oldSets.filter((set) => set.type === "warmup");
        const plan = exercise.plan || {};
        const fallbackSets = Array.from({ length: Number(plan.sets) || 0 }, () => ({ weight: displayNumber(plan.weight), reps: displayNumber(plan.reps) }));
        return {
          ...exercise,
          id: exercise.id || crypto.randomUUID(),
          name: exercise.name || "",
          warmupSets: warmupSets.map(normalizeSet),
          sets: (workingSets.length || Object.hasOwn(exercise, "durationMinutes") ? workingSets : fallbackSets).map(normalizeSet),
          rpe: displayNumber(exercise.rpe ?? exercise.feedback?.rpe),
          notes: exercise.notes || "",
          instruction: exercise.instruction || "",
          replacedFrom: exercise.replacedFrom || "",
        };
      }),
      post: {
        pain: displayNumber(workout.post?.pain ?? workout.post?.lowerBack ?? 0),
        discomfort: displayNumber(workout.post?.discomfort ?? 0),
        mobility: workout.post?.mobility || "",
        problemExercise: workout.post?.problemExercise || "",
        notes: workout.post?.notes || "",
      },
      createdAt: workout.createdAt || new Date().toISOString(),
      updatedAt: workout.updatedAt || new Date().toISOString(),
    };
  }

  function normalizeSet(set = {}) {
    return {
      id: set.id || crypto.randomUUID(),
      weight: displayNumber(set.weight),
      reps: displayNumber(set.reps),
      weightHint: set.weightHint || "",
      repsHint: set.repsHint || "",
    };
  }

  function workoutLabel(workout) {
    const type = workout.type || "custom";
    return type === "custom" ? "Своя тренировка" : type === "extra" ? "Внеплановая" : `День ${type}`;
  }

  function renderCalendar() {
    const container = document.querySelector("#calendar");
    const year = state.month.getFullYear();
    const month = state.month.getMonth();
    const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
    const days = new Date(year, month + 1, 0).getDate();
    const workoutDates = new Set(state.workouts.map((workout) => workout.date));
    const today = toISODate(new Date());
    let cells = Array.from({ length: firstWeekday }, () => '<span class="day-spacer"></span>').join("");
    for (let day = 1; day <= days; day += 1) {
      const date = toISODate(new Date(year, month, day));
      cells += `<button class="day${date === today ? " is-today" : ""}${date === state.selectedDate ? " is-selected" : ""}${workoutDates.has(date) ? " has-workout" : ""}" type="button" data-date="${date}" aria-label="${formatLongDate(date)}">${day}</button>`;
    }
    container.innerHTML = `<div class="calendar"><div class="calendar-header"><h2 id="calendar-title" class="calendar-title">${state.month.toLocaleDateString("ru-RU", { month: "long", year: "numeric" })}</h2><div class="calendar-nav"><button class="icon-button" type="button" data-month-step="-1" aria-label="Предыдущий месяц"><i class="ph ph-caret-left" aria-hidden="true"></i></button><button class="icon-button" type="button" data-month-step="1" aria-label="Следующий месяц"><i class="ph ph-caret-right" aria-hidden="true"></i></button></div></div><div class="calendar-grid"><span class="weekday">Пн</span><span class="weekday">Вт</span><span class="weekday">Ср</span><span class="weekday">Чт</span><span class="weekday">Пт</span><span class="weekday">Сб</span><span class="weekday">Вс</span>${cells}</div></div>`;
    container.querySelectorAll("[data-month-step]").forEach((button) => button.addEventListener("click", () => {
      state.month = new Date(year, month + Number(button.dataset.monthStep), 1);
      renderCalendar();
    }));
    container.querySelectorAll("[data-date]").forEach((button) => button.addEventListener("click", () => {
      const date = button.dataset.date;
      state.selectedDate = date;
      const workout = state.workouts.find((item) => item.date === date);
      renderCalendar();
      if (workout) openWorkout(workout); else openImport(date);
    }));
  }

  function openImport(date) {
    state.selectedDate = date;
    document.querySelector("#plan-text").value = "";
    document.querySelector("#import-error").textContent = "";
    document.querySelector("#import-dialog").showModal();
    requestAnimationFrame(() => document.querySelector("#plan-text").focus());
  }

  async function importPlan(event) {
    event.preventDefault();
    const text = document.querySelector("#plan-text").value.trim();
    const error = document.querySelector("#import-error");
    if (!text) { error.textContent = "Вставьте план тренировки."; return; }
    error.textContent = "";
    let parsed;
    try { parsed = parseImportedPlan(text, state.selectedDate); }
    catch (cause) { error.textContent = cause.message; return; }
    if (!parsed.exercises.length) { error.textContent = "Не удалось найти упражнения. Проверьте заголовки вида «## 1. Упражнение»."; return; }
    const now = new Date().toISOString();
    const workout = normalizeWorkout({ id: crypto.randomUUID(), date: parsed.date, title: parsed.title, type: parsed.type, status: "active", exercises: parsed.exercises, skipped: [], post: {}, sourceText: text, createdAt: now, updatedAt: now });
    try { await db.put("workouts", workout); }
    catch (cause) { error.textContent = "Не удалось сохранить тренировку на устройстве. Попробуйте ещё раз."; return; }
    await refreshWorkouts();
    state.selectedDate = workout.date;
    state.month = startOfMonth(fromISODate(workout.date));
    renderCalendar();
    document.querySelector("#import-dialog").close();
    openWorkout(workout);
  }

  function parseImportedPlan(text, fallbackDate) {
    return window.TrainingJournalImport.parseJSONPlan(text) ?? parsePlan(text, fallbackDate);
  }

  function parsePlan(text, fallbackDate) {
    const clean = text.replace(/\\\s*$/gm, "").replace(/\r/g, "");
    const titleMatch = clean.match(/^#\s+(.+)$/m);
    const rawTitle = titleMatch ? titleMatch[1].trim() : "Новая тренировка";
    const title = rawTitle.split(/\s+[—–-]\s+/)[0].trim();
    const typeMatch = rawTitle.match(/День\s+([ABCАВС])/i);
    const typeMap = { A: "A", B: "B", C: "C", "А": "A", "В": "B", "С": "C" };
    const type = typeMatch ? typeMap[typeMatch[1].toUpperCase()] || "custom" : "custom";
    const dateMatch = clean.match(/(?:📅\s*)?(\d{2})\.(\d{2})\.(\d{2,4})/);
    let date = fallbackDate;
    if (dateMatch) {
      const year = dateMatch[3].length === 2 ? `20${dateMatch[3]}` : dateMatch[3];
      date = `${year}-${dateMatch[2]}-${dateMatch[1]}`;
    }
    const matches = [...clean.matchAll(/^##\s+\d+\.\s+(.+)$/gm)];
    const exercises = matches.map((match, index) => {
      const section = clean.slice(match.index + match[0].length, matches[index + 1]?.index ?? clean.length);
      const warmupMatch = section.match(/Разминка:\s*\*\*([^*]+)\*\*/i);
      const workingMatch = section.match(/Рабочие:\s*\*\*([^*]+)\*\*/i);
      const sectionWithoutWarmup = section.replace(/Разминка:\s*\*\*[^*]+\*\*/gi, "");
      const genericMatch = sectionWithoutWarmup.match(/\*\*([^*]+)\*\*/);
      const spec = workingMatch?.[1] || genericMatch?.[1] || "";
      const parsed = parseExerciseSpec(spec);
      const warmup = warmupMatch ? parseBasicSet(warmupMatch[1]) : null;
      return {
        id: crypto.randomUUID(),
        name: match[1].trim(),
        warmupSets: warmup ? [warmup] : [],
        sets: parsed.sets,
        rpe: "",
        notes: "",
        instruction: parsed.instruction,
      };
    });
    return { date, title: title || "Новая тренировка", type, exercises };
  }

  function parseExerciseSpec(spec) {
    const normalized = spec.replaceAll("**", "").replace(/,/g, ".").trim();
    if (/на\s+сторону/i.test(normalized)) {
      const match = normalized.match(/(\d+)\s*[×x]\s*(\d+)/i);
      const count = Number(match?.[1]) || 1;
      const reps = match?.[2] || "";
      return { sets: Array.from({ length: count }, () => normalizeSet({ reps })), instruction: "на сторону" };
    }
    if (normalized.includes("→")) {
      const [firstPart, nextPart] = normalized.split("→").map((part) => part.trim());
      const first = parseBasicSet(firstPart);
      const rangeMatch = nextPart.match(/[×x]\s*(\d+\s*[–-]\s*\d+)\s*[×x]\s*(\d+)/i);
      const exactMatch = nextPart.match(/[×x]\s*(\d+)\s*[×x]\s*(\d+)/i);
      const count = Number(rangeMatch?.[2] || exactMatch?.[2]) || 1;
      const repsHint = rangeMatch ? `цель ${rangeMatch[1].replace(/\s/g, "")}` : "";
      const reps = exactMatch?.[1] || "";
      const following = Array.from({ length: count }, () => normalizeSet({ weightHint: "следующий", reps, repsHint }));
      return { sets: [first, ...following].filter(Boolean), instruction: "" };
    }
    const match = normalized.match(/(\d+(?:\.\d+)?)\s*[×x]\s*(\d+)(?:\s*[×x]\s*(\d+))?/i);
    if (!match) return { sets: [normalizeSet()], instruction: normalized };
    const count = Number(match[3]) || 1;
    return { sets: Array.from({ length: count }, () => normalizeSet({ weight: match[1], reps: match[2] })), instruction: "" };
  }

  function parseBasicSet(value) {
    const match = value.replace(/,/g, ".").match(/(\d+(?:\.\d+)?)\s*[×x]\s*(\d+)/i);
    return match ? normalizeSet({ weight: match[1], reps: match[2] }) : null;
  }

  function openWorkout(workout) {
    state.current = structuredClone(normalizeWorkout(workout));
    state.undo = null;
    updateUndoButton();
    document.querySelector("#workout-title").textContent = state.current.title;
    document.querySelector("#workout-date").textContent = formatCompactDate(state.current.date);
    renderExercises();
    document.querySelector("#save-state").textContent = "Изменения сохраняются автоматически";
    document.querySelector("#workout-dialog").showModal();
  }

  function renderExercises() {
    const list = document.querySelector("#exercise-list");
    list.innerHTML = state.current.exercises.map(renderExercise).join("");
    document.querySelector("#first-exercise-empty").hidden = state.current.exercises.length > 0;
    list.querySelectorAll("textarea").forEach(resizeTextarea);
  }

  function renderExercise(exercise, index) {
    const rows = exercise.sets.map((set, setIndex) => renderSetRow(set, setIndex)).join("");
    const nameReadonly = exercise.name ? " readonly" : "";
    return `<article class="exercise-card" data-exercise-id="${exercise.id}">
      <div class="exercise-header">
        <button class="drag-handle" type="button" aria-label="Изменить порядок упражнения"><i class="ph ph-dots-six-vertical" aria-hidden="true"></i></button>
        <span class="exercise-index">${String(index + 1).padStart(2, "0")}</span>
        <textarea class="exercise-name" data-exercise-field="name" rows="1" placeholder="Название упражнения"${nameReadonly}>${escapeHTML(exercise.name)}</textarea>
        <button class="exercise-menu-button" type="button" data-open-menu aria-label="Меню упражнения"><i class="ph ph-dots-three" aria-hidden="true"></i></button>
      </div>
      <div class="exercise-body">
        <div class="set-head"><span>Подход</span><span>Вес, кг</span><span></span><span>Повторы</span></div>
        <div class="set-list">${rows}</div>
        <button class="add-set" type="button" data-add-set>＋ Добавить подход</button>
        <div class="exercise-meta">
          <label>RPE<input data-exercise-field="rpe" inputmode="decimal" value="${escapeAttribute(exercise.rpe)}" placeholder="—"></label>
          <label>Заметка<textarea data-exercise-field="notes" rows="1" placeholder="Добавить заметку…">${escapeHTML(exercise.notes)}</textarea></label>
        </div>
      </div>
    </article>`;
  }

  function renderSetRow(set, index) {
    return `<div class="set-row-shell" data-set-id="${set.id}">
      <div class="set-swipe-actions"><button class="set-swipe-add" type="button" data-swipe-add>Добавить</button><button class="set-swipe-delete" type="button" data-swipe-delete>Удалить</button></div>
      <div class="set-row-main">
        <span class="set-number">${index + 1}</span>
        <input data-kind="working" data-field="weight" inputmode="decimal" value="${escapeAttribute(set.weight)}" placeholder="${escapeAttribute(set.weightHint)}" aria-label="Вес подхода ${index + 1}">
        <span class="multiply">×</span>
        <input data-kind="working" data-field="reps" inputmode="numeric" value="${escapeAttribute(set.reps)}" placeholder="${escapeAttribute(set.repsHint)}" aria-label="Повторения подхода ${index + 1}">
      </div>
    </div>`;
  }

  function handleExerciseInput(event) {
    if (!state.current) return;
    activateInputUndo(event.target);
    const card = event.target.closest(".exercise-card");
    const exercise = card && findExercise(card.dataset.exerciseId);
    if (!exercise) return;
    if (event.target.dataset.exerciseField) {
      const field = event.target.dataset.exerciseField;
      exercise[field] = field === "durationMinutes" ? normalizeNumericText(event.target.value) : event.target.value;
    } else if (event.target.dataset.setId) {
      const set = exercise.warmupSets.find((item) => item.id === event.target.dataset.setId);
      if (set) set[event.target.dataset.field] = normalizeNumericText(event.target.value);
    } else {
      const shell = event.target.closest(".set-row-shell");
      const set = exercise.sets.find((item) => item.id === shell?.dataset.setId);
      if (set) set[event.target.dataset.field] = normalizeNumericText(event.target.value);
    }
    if (event.target.dataset.field === "weight" || event.target.dataset.field === "reps" || event.target.dataset.exerciseField) resetFinishedTimer();
    if (event.target.matches("textarea")) resizeTextarea(event.target);
    scheduleSave();
  }

  function resizeTextarea(textarea) {
    textarea.style.height = "auto";
    textarea.style.height = `${Math.max(34, textarea.scrollHeight)}px`;
  }

  function handleExerciseClick(event) {
    const card = event.target.closest(".exercise-card");
    if (!card) return;
    const exerciseId = card.dataset.exerciseId;
    const shell = event.target.closest(".set-row-shell");
    if (event.target.closest("[data-open-menu]")) { openExerciseMenu(exerciseId); return; }
    if (event.target.closest("[data-add-set]")) {
      const exercise = findExercise(exerciseId);
      addSetAfter(exerciseId, exercise.sets.at(-1)?.id || null);
      return;
    }
    if (event.target.closest("[data-swipe-add]")) { addSetAfter(exerciseId, shell.dataset.setId); return; }
    if (event.target.closest("[data-swipe-delete]")) { deleteSet(exerciseId, shell.dataset.setId); }
  }

  function activateInputUndo(target) {
    if (!state.pendingInputUndo || state.pendingInputUndo.target !== target) return;
    const snapshot = state.pendingInputUndo.snapshot;
    setUndo("Изменение значения", () => restoreCurrent(snapshot));
    state.pendingInputUndo = null;
  }

  function addSetAfter(exerciseId, setId) {
    const snapshot = snapshotCurrent();
    const exercise = findExercise(exerciseId);
    const index = setId ? exercise.sets.findIndex((set) => set.id === setId) : exercise.sets.length - 1;
    const source = exercise.sets[index] || normalizeSet();
    exercise.sets.splice(index + 1, 0, normalizeSet({ weight: source.weight, reps: source.reps, weightHint: source.weightHint, repsHint: source.repsHint }));
    setUndo("Добавление подхода", () => restoreCurrent(snapshot));
    renderExercises();
    scheduleSave();
  }

  function deleteSet(exerciseId, setId) {
    const snapshot = snapshotCurrent();
    const exercise = findExercise(exerciseId);
    exercise.sets = exercise.sets.filter((set) => set.id !== setId);
    setUndo("Удаление подхода", () => restoreCurrent(snapshot));
    renderExercises();
    scheduleSave();
  }

  function openExerciseMenu(exerciseId) {
    state.menuExerciseId = exerciseId;
    document.querySelector("#exercise-menu-name").textContent = findExercise(exerciseId)?.name || "Новое упражнение";
    document.querySelector("#exercise-menu-dialog").showModal();
  }

  function handleExerciseAction(action) {
    const id = state.menuExerciseId;
    closeDialog("exercise-menu-dialog");
    if (action === "add") addExerciseAfter(id);
    if (action === "replace") replaceExercise(id);
    if (action === "skip") skipExercise(id);
  }

  function blankExercise(replacedFrom = "") {
    return { id: crypto.randomUUID(), name: "", warmupSets: [], sets: [normalizeSet()], rpe: "", notes: "", instruction: "", replacedFrom };
  }

  function addExerciseAfter(exerciseId) {
    const snapshot = snapshotCurrent();
    const index = exerciseId ? state.current.exercises.findIndex((exercise) => exercise.id === exerciseId) + 1 : 0;
    state.current.exercises.splice(index, 0, blankExercise());
    setUndo("Добавление упражнения", () => restoreCurrent(snapshot));
    renderExercises();
    scheduleSave();
    requestAnimationFrame(() => document.querySelector(`[data-exercise-id="${state.current.exercises[index].id}"] .exercise-name`)?.focus());
  }

  function replaceExercise(exerciseId) {
    const snapshot = snapshotCurrent();
    const index = state.current.exercises.findIndex((exercise) => exercise.id === exerciseId);
    const previous = state.current.exercises[index];
    state.current.exercises[index] = blankExercise(previous.replacedFrom || previous.name);
    setUndo("Замена упражнения", () => restoreCurrent(snapshot));
    renderExercises();
    scheduleSave();
    requestAnimationFrame(() => document.querySelector(`[data-exercise-id="${state.current.exercises[index].id}"] .exercise-name`)?.focus());
  }

  function skipExercise(exerciseId) {
    const snapshot = snapshotCurrent();
    const index = state.current.exercises.findIndex((exercise) => exercise.id === exerciseId);
    const [exercise] = state.current.exercises.splice(index, 1);
    if (exercise?.name) state.current.skipped.push(exercise.name);
    setUndo("Пропуск упражнения", () => restoreCurrent(snapshot));
    renderExercises();
    scheduleSave();
  }

  function handlePointerDown(event) {
    const handle = event.target.closest(".drag-handle");
    if (handle) {
      const card = handle.closest(".exercise-card");
      state.drag = { type: "exercise", pointerId: event.pointerId, card, snapshot: snapshotCurrent(), moved: false };
      handle.setPointerCapture(event.pointerId);
      card.classList.add("is-dragging");
      return;
    }
    const shell = event.target.closest(".set-row-shell");
    if (!shell || event.target.matches("input, textarea, button")) return;
    state.drag = { type: "set", pointerId: event.pointerId, shell, startX: event.clientX, dx: 0 };
    shell.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event) {
    if (!state.drag || state.drag.pointerId !== event.pointerId) return;
    if (state.drag.type === "set") {
      state.drag.dx = Math.max(-96, Math.min(96, event.clientX - state.drag.startX));
      state.drag.shell.querySelector(".set-row-main").style.transform = `translateX(${state.drag.dx}px)`;
      return;
    }
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest(".exercise-card");
    if (!target || target === state.drag.card) return;
    const from = state.current.exercises.findIndex((exercise) => exercise.id === state.drag.card.dataset.exerciseId);
    const to = state.current.exercises.findIndex((exercise) => exercise.id === target.dataset.exerciseId);
    const [exercise] = state.current.exercises.splice(from, 1);
    state.current.exercises.splice(to, 0, exercise);
    target.parentElement.insertBefore(state.drag.card, from < to ? target.nextSibling : target);
    state.drag.moved = true;
  }

  function handlePointerUp(event) {
    if (!state.drag || state.drag.pointerId !== event.pointerId) return;
    if (state.drag.type === "set") {
      const target = Math.abs(state.drag.dx) >= 46 ? Math.sign(state.drag.dx) * 88 : 0;
      state.drag.shell.querySelector(".set-row-main").style.transform = `translateX(${target}px)`;
    } else {
      state.drag.card.classList.remove("is-dragging");
      if (state.drag.moved) {
        const snapshot = state.drag.snapshot;
        setUndo("Изменение порядка", () => restoreCurrent(snapshot));
        renderExercises();
        scheduleSave();
      }
    }
    state.drag = null;
  }

  function findExercise(id) { return state.current?.exercises.find((exercise) => exercise.id === id); }

  function snapshotCurrent() { return state.current ? structuredClone(state.current) : null; }
  function restoreCurrent(snapshot) {
    state.current = structuredClone(snapshot);
    renderExercises();
    scheduleSave();
  }

  function setUndo(label, action) {
    state.undo = { label, action };
    updateUndoButton();
  }

  function undoLastAction() {
    if (!state.undo) return;
    const action = state.undo.action;
    state.undo = null;
    updateUndoButton();
    action();
  }

  function updateUndoButton() {
    const button = document.querySelector("#undo-action");
    button.disabled = !state.undo;
    button.title = state.undo ? `Отменить: ${state.undo.label}` : "Нет действий для отмены";
  }

  function scheduleSave() {
    if (!state.current) return;
    document.querySelector("#save-state").textContent = "Сохраняю…";
    window.clearTimeout(state.autosaveTimer);
    state.autosaveTimer = window.setTimeout(persistCurrent, 350);
  }

  async function persistCurrent() {
    if (!state.current) return;
    window.clearTimeout(state.autosaveTimer);
    state.current.updatedAt = new Date().toISOString();
    await db.put("workouts", structuredClone(state.current));
    document.querySelector("#save-state").textContent = "Сохранено локально";
    await refreshWorkouts();
    renderCalendar();
  }

  async function closeDialog(id) {
    const dialog = document.querySelector(`#${id}`);
    if (!dialog?.open) return;
    if (id === "workout-dialog" && state.current) await persistCurrent();
    dialog.close();
  }

  async function openPostWorkout(event) {
    event.preventDefault();
    await persistCurrent();
    const post = state.current.post || {};
    document.querySelector("#post-pain").value = post.pain || 0;
    document.querySelector("#post-discomfort").value = post.discomfort || 0;
    document.querySelector("#post-mobility").value = post.mobility || "";
    document.querySelector("#post-notes").value = post.notes || "";
    const select = document.querySelector("#problem-exercise");
    select.innerHTML = '<option value="">Не выбрано</option>' + state.current.exercises.map((exercise) => `<option value="${escapeAttribute(exercise.name)}">${escapeHTML(exercise.name || "Без названия")}</option>`).join("");
    select.value = post.problemExercise || "";
    updateProblemExerciseVisibility();
    document.querySelector("#post-dialog").showModal();
  }

  function updateProblemExerciseVisibility() {
    const pain = parseLocaleNumber(document.querySelector("#post-pain").value) || 0;
    const discomfort = parseLocaleNumber(document.querySelector("#post-discomfort").value) || 0;
    document.querySelector("#problem-exercise-label").hidden = pain <= 0 && discomfort <= 0;
    if (pain <= 0 && discomfort <= 0) document.querySelector("#problem-exercise").value = "";
  }

  async function finishWorkout(event) {
    event.preventDefault();
    state.current.post = {
      pain: normalizeNumericText(document.querySelector("#post-pain").value || "0"),
      discomfort: normalizeNumericText(document.querySelector("#post-discomfort").value || "0"),
      mobility: document.querySelector("#post-mobility").value,
      problemExercise: document.querySelector("#problem-exercise-label").hidden ? "" : document.querySelector("#problem-exercise").value,
      notes: document.querySelector("#post-notes").value.trim(),
    };
    state.current.status = "completed";
    await persistCurrent();
    document.querySelector("#summary-text").value = buildSummary(state.current);
    document.querySelector("#copy-state").textContent = "";
    document.querySelector("#post-dialog").close();
    document.querySelector("#workout-dialog").close();
    document.querySelector("#summary-dialog").showModal();
  }

  function buildSummary(workout) {
    const lines = [`# ${workout.title}`, ``, `📅 ${formatCompactDate(workout.date)}`, ``];
    const completedExercises = workout.exercises.filter((exercise) => {
      const hasWarmup = exercise.warmupSets.some(hasSetValue);
      const hasWorkingSet = exercise.sets.some(hasSetValue);
      return exercise.name && (hasWarmup || hasWorkingSet || displayNumber(exercise.durationMinutes) !== "" || exercise.rpe !== "" || exercise.notes);
    });
    completedExercises.forEach((exercise, index) => {
      lines.push(`## ${index + 1}. ${exercise.name}`, "");
      exercise.warmupSets.filter(hasSetValue).forEach((set) => lines.push(`Разминка: ${formatSet(set)}`));
      exercise.sets.filter(hasSetValue).forEach((set, setIndex) => lines.push(`${setIndex + 1}. ${formatSet(set)}`));
      if (displayNumber(exercise.durationMinutes) !== "") lines.push(`Длительность: ${displayNumber(exercise.durationMinutes)} мин`);
      if (exercise.instruction) lines.push(`Уточнение: ${exercise.instruction}`);
      if (exercise.rpe !== "") lines.push(`RPE: ${exercise.rpe}`);
      if (exercise.notes) lines.push(`Заметка: ${exercise.notes}`);
      lines.push("");
    });
    lines.push("### Поясница после тренировки", "");
    lines.push(`Боль: ${workout.post.pain || 0}/10`);
    lines.push(`Дискомфорт: ${workout.post.discomfort || 0}/10`);
    if (workout.post.mobility) lines.push(`Мобильность: ${mobilityLabel(workout.post.mobility)}`);
    if (workout.post.problemExercise) lines.push(`Проблемное упражнение: ${workout.post.problemExercise}`);
    const finalNotes = [];
    workout.skipped.forEach((name) => finalNotes.push(`Пропущено: ${name}.`));
    workout.exercises.filter((exercise) => exercise.replacedFrom && exercise.name).forEach((exercise) => finalNotes.push(`${exercise.replacedFrom} заменено на ${exercise.name}.`));
    if (workout.post.notes) finalNotes.push(workout.post.notes);
    if (finalNotes.length) lines.push("", "### Финальные заметки", "", ...finalNotes.map((note) => `- ${note}`));
    return lines.join("\n").trim();
  }

  function formatSet(set) {
    if (set.weight !== "" && set.reps !== "") return `${set.weight} кг × ${set.reps} повторений`;
    if (set.weight !== "") return `${set.weight} кг`;
    return `${set.reps} повторений`;
  }

  function hasSetValue(set) { return set.weight !== "" || set.reps !== ""; }

  function mobilityLabel(value) { return ({ better: "стала лучше", same: "без изменений", worse: "стала хуже" })[value] || value; }

  async function copySummary() {
    const text = document.querySelector("#summary-text").value;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.querySelector("#summary-text");
      area.select();
      document.execCommand("copy");
    }
    document.querySelector("#copy-state").textContent = "Журнал скопирован";
  }

  function openCustomTimer() {
    document.querySelector("#custom-minutes").value = 0;
    document.querySelector("#custom-seconds").value = 0;
    validateCustomTimer();
    document.querySelector("#custom-timer-dialog").showModal();
    requestAnimationFrame(() => document.querySelector("#custom-minutes").select());
  }

  function validateCustomTimer() {
    const minutes = Math.max(0, Number(document.querySelector("#custom-minutes").value) || 0);
    const seconds = Math.max(0, Math.min(59, Number(document.querySelector("#custom-seconds").value) || 0));
    document.querySelector("#custom-timer-start").disabled = minutes * 60 + seconds <= 0;
  }

  function startCustomTimer(event) {
    event.preventDefault();
    const minutes = Math.max(0, Number(document.querySelector("#custom-minutes").value) || 0);
    const secondsInput = document.querySelector("#custom-seconds");
    const seconds = Math.max(0, Math.min(59, Number(secondsInput.value) || 0));
    secondsInput.value = seconds;
    if (minutes * 60 + seconds <= 0) return;
    document.querySelector("#custom-timer-dialog").close();
    startTimer(minutes * 60 + seconds);
  }

  async function startTimer(seconds) {
    const previousEnd = state.timerEnd;
    setUndo("Запуск таймера", () => setTimerEnd(previousEnd));
    state.timerNotified = false;
    setTimerEnd(Date.now() + seconds * 1000);
    if ("Notification" in window && Notification.permission === "default") {
      try { await Notification.requestPermission(); } catch (error) { console.warn("Уведомления недоступны", error); }
    }
  }

  function setTimerEnd(end) {
    state.timerEnd = end || null;
    state.timerNotified = false;
    state.cancelArmed = false;
    window.clearTimeout(state.cancelArmTimer);
    if (state.timerEnd) localStorage.setItem(TIMER_STORAGE_KEY, String(state.timerEnd)); else localStorage.removeItem(TIMER_STORAGE_KEY);
    updateTimer();
  }

  function handleTimerCancel() {
    const button = document.querySelector("#timer-cancel");
    if (!state.cancelArmed) {
      state.cancelArmed = true;
      button.textContent = "Ещё раз";
      window.clearTimeout(state.cancelArmTimer);
      state.cancelArmTimer = window.setTimeout(() => {
        state.cancelArmed = false;
        button.textContent = "Отменить";
      }, 1500);
      return;
    }
    const previousEnd = state.timerEnd;
    setUndo("Отмена таймера", () => setTimerEnd(previousEnd));
    setTimerEnd(null);
  }

  function updateTimer() {
    const panel = document.querySelector("#timer-panel");
    if (!panel) return;
    const idle = document.querySelector("#timer-idle");
    const running = document.querySelector("#timer-running");
    const value = document.querySelector("#timer-value");
    const cancel = document.querySelector("#timer-cancel");
    if (!state.timerEnd) {
      panel.classList.remove("is-active", "is-overtime");
      idle.hidden = false;
      running.hidden = true;
      cancel.textContent = "Отменить";
      return;
    }
    const delta = state.timerEnd - Date.now();
    idle.hidden = true;
    running.hidden = false;
    panel.classList.toggle("is-active", delta > 0);
    panel.classList.toggle("is-overtime", delta <= 0);
    if (delta > 0) {
      value.textContent = formatDuration(Math.ceil(delta / 1000));
    } else {
      value.textContent = `Завершён · +${formatDuration(Math.floor(Math.abs(delta) / 1000))}`;
      if (!state.timerNotified) {
        state.timerNotified = true;
        signalTimerFinished();
      }
    }
  }

  async function signalTimerFinished() {
    if ("Notification" in window && Notification.permission === "granted") {
      const options = { body: "Можно начинать следующий подход.", tag: "training-rest-timer", renotify: true };
      try {
        if ("serviceWorker" in navigator) {
          const registration = await navigator.serviceWorker.ready;
          await registration.showNotification("Отдых завершён", options);
        } else {
          new Notification("Отдых завершён", options);
        }
      } catch (error) { console.warn("Системное уведомление недоступно", error); }
    }
    if (document.visibilityState === "visible") playTimerSound();
  }

  function playTimerSound() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const audio = new AudioContext();
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.frequency.value = 740;
      gain.gain.setValueAtTime(0.08, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.35);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start();
      oscillator.stop(audio.currentTime + 0.35);
    } catch (error) { console.warn("Звуковой сигнал недоступен", error); }
  }

  function resetFinishedTimer() {
    if (state.timerEnd && Date.now() >= state.timerEnd) setTimerEnd(null);
  }

  function formatDuration(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function normalizeNumericText(value) { return String(value).replace(",", ".").trim(); }
  function parseLocaleNumber(value) { return Number(normalizeNumericText(value)); }
  function displayNumber(value) { return value == null ? "" : String(value).replace(",", "."); }
  function startOfMonth(date) { return new Date(date.getFullYear(), date.getMonth(), 1); }
  function toISODate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  function fromISODate(value) { const [year, month, day] = value.split("-").map(Number); return new Date(year, month - 1, day); }
  function formatLongDate(value) { return fromISODate(value).toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" }); }
  function formatCompactDate(value) { return fromISODate(value).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" }); }
  function escapeHTML(value = "") { const div = document.createElement("div"); div.textContent = value; return div.innerHTML; }
  function escapeAttribute(value = "") { return escapeHTML(value).replaceAll('"', "&quot;"); }
})();
