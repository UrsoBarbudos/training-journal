(function (root) {
  "use strict";

  // Add optional numeric metrics here without changing extraction or set parsing.
  const METRIC_FIELDS = ["durationMinutes"];
  const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const isNumberOrNull = (value) => value === null || (typeof value === "number" && Number.isFinite(value));

  function validatePlan(plan) {
    if (!isObject(plan)) throw new Error("Неизвестная структура JSON. Нужен объект тренировки Training Journal.");
    if (plan.version !== 1) throw new Error("Неподдерживаемая версия JSON. Укажите version: 1.");
    if (typeof plan.title !== "string" || !plan.title.trim()) throw new Error("Не указано название тренировки.");
    if (typeof plan.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(plan.date) ||
        !Number.isFinite(Date.parse(plan.date)) || new Date(plan.date).toISOString().slice(0, 10) !== plan.date) {
      throw new Error("Некорректная дата тренировки. Используйте YYYY-MM-DD.");
    }
    if (!["A", "B", "C", "extra", "custom"].includes(plan.type)) throw new Error("Некорректный тип тренировки. Используйте A, B, C, extra или custom.");
    if (!Array.isArray(plan.exercises) || !plan.exercises.length) throw new Error("Поле exercises должно содержать хотя бы одно упражнение.");
    plan.exercises.forEach((exercise, index) => {
      if (!isObject(exercise) || typeof exercise.name !== "string" || !exercise.name.trim()) {
        throw new Error(`Не указано название упражнения №${index + 1}.`);
      }
      const label = `В упражнении "${exercise.name}"`;
      for (const field of METRIC_FIELDS) {
        if (Object.hasOwn(exercise, field) && !isNumberOrNull(exercise[field])) throw new Error(`${label} поле ${field} должно быть числом или null.`);
      }
      const timed = Object.hasOwn(exercise, "durationMinutes");
      for (const field of ["warmupSets", "sets"]) {
        if (field === "sets" && timed && !Object.hasOwn(exercise, field)) continue;
        if (!Object.hasOwn(exercise, field)) throw new Error(`${label} отсутствует поле ${field}.`);
        if (!Array.isArray(exercise[field])) throw new Error(`${label} поле ${field} должно быть массивом.`);
        exercise[field].forEach((set, setIndex) => {
          for (const key of ["weight", "reps"]) {
            if (!isObject(set) || !isNumberOrNull(set[key])) throw new Error(`${label}, ${field}, подход №${setIndex + 1}: ${key} должно быть числом или null.`);
          }
        });
      }
      if (!timed && !exercise.sets.length) throw new Error(`${label} нужен хотя бы один рабочий подход в sets.`);
      if (!isNumberOrNull(exercise.rpe)) throw new Error(`${label} поле rpe должно быть числом или null.`);
      if (typeof exercise.notes !== "string") throw new Error(`${label} поле notes должно быть строкой.`);
    });
    // Only contract fields become application data; JSON cannot inject internal IDs/state.
    return {
      version: plan.version, title: plan.title, date: plan.date, type: plan.type,
      exercises: plan.exercises.map((exercise) => ({
        name: exercise.name, warmupSets: exercise.warmupSets.map(copySet),
        sets: (exercise.sets || []).map(copySet), rpe: exercise.rpe, notes: exercise.notes,
        ...Object.fromEntries(METRIC_FIELDS.filter((field) => Object.hasOwn(exercise, field)).map((field) => [field, exercise[field]])),
      })),
    };
  }

  function copySet({ weight, reps }) { return { weight, reps }; }

  // null means no JSON was supplied. Invalid JSON throws and never falls back to Markdown.
  function parseJSONPlan(text) {
    const trimmed = text.trim();
    const blocks = [...trimmed.matchAll(/^\s*(`{3,}|~{3,})json[^\S\r\n]*\r?\n([\s\S]*?)^\s*\1[^\S\r\n]*$/gim)];
    if (blocks.length > 1) throw new Error("Найдено несколько JSON-блоков. Вставьте одну тренировку.");
    let source;
    if (blocks.length) source = blocks[0][2];
    else if (/^\s*(?:`{3,}|~{3,})json\b/im.test(trimmed)) throw new Error("Не удалось прочитать JSON. Проверьте закрывающую границу блока.");
    else if (/^[{\[]/.test(trimmed)) source = trimmed;
    else {
      try { JSON.parse(trimmed); source = trimmed; }
      catch { return null; }
    }
    let plan;
    try { plan = JSON.parse(source); }
    catch { throw new Error("Не удалось прочитать JSON. Проверьте кавычки, запятые и скобки."); }
    return validatePlan(plan);
  }

  const api = { parseJSONPlan, validatePlan, METRIC_FIELDS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TrainingJournalImport = api;
})(typeof window !== "undefined" ? window : globalThis);
