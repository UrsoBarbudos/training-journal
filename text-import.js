(function (root) {
  "use strict";

  const EXERCISE_HEADER = /^\s*(\d+)(?:\.\s+|\)\s*)(.+?)\s*$/;
  const WARMUP_HEADER = /^\s*(?:общая\s+)?разминка\s*:?\s*$|^\s*warm[ -]?up\s*:?\s*$/i;
  const WARMUP_SET = /^\s*(?:разминка|разминочный(?:\s+подход)?|warm[ -]?up)\s*:\s*/i;
  const SET = /^\s*(\d+(?:\.\d+)?)\s*(?:кг)?\s*[xх×]\s*(\d+)(?:\s*(?:—|-)?\s*rpe\s*(\d+(?:\.\d+)?))?\s*$/i;
  const DURATION = /^\s*(.+?)\s*[—–-]\s*(\d+(?:\.\d+)?)\s*мин(?:ут(?:ы)?)?\.?\s*$/i;
  const WARMUP_REPS = /^\s*(.+?)\s*[—–-]\s*(\d+)\s*[xх×]\s*(\d+)\s*$/i;

  function localISODate(date = new Date()) {
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function validDate(year, month, day) {
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  }

  function parseDate(line) {
    let match = line.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (match) {
      const [, day, month, year] = match;
      return validDate(Number(year), Number(month), Number(day)) ? `${year}-${month}-${day}` : null;
    }
    match = line.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const [, year, month, day] = match;
    return validDate(Number(year), Number(month), Number(day)) ? `${year}-${month}-${day}` : null;
  }

  function parseWorkoutTitle(lines) {
    const first = lines.find((line) => line.trim());
    if (!first || parseDate(first) || WARMUP_HEADER.test(first) || EXERCISE_HEADER.test(first)) return "Новая тренировка";
    return first.trim().replace(/^#+\s*/, "") || "Новая тренировка";
  }

  function parseExerciseHeader(line) {
    const match = line.match(EXERCISE_HEADER);
    return match ? { number: Number(match[1]), name: match[2].trim() } : null;
  }

  function parseRPE(line) {
    const match = line.match(/(?:^|\s|—|-)RPE\s*:?[ ]*(\d+(?:\.\d+)?)\s*$/i);
    return match ? Number(match[1]) : null;
  }

  function parseSet(line) {
    const match = line.match(SET);
    if (!match) return null;
    return { weight: Number(match[1]), reps: Number(match[2]), rpe: match[3] === undefined ? null : Number(match[3]) };
  }

  function detectWarmupSet(line) { return WARMUP_SET.test(line); }

  function parseGeneralWarmup(line) {
    const duration = line.match(DURATION);
    if (duration) return { name: duration[1].trim(), durationMinutes: Number(duration[2]), notes: "" };
    const reps = line.match(WARMUP_REPS);
    if (reps) return { name: reps[1].trim(), durationMinutes: null, notes: `${reps[2]} x ${reps[3]}` };
    return line.trim() ? { name: line.trim(), durationMinutes: null, notes: line.trim() } : null;
  }

  function parseExerciseNotes(lines) { return lines.map((line) => line.trim()).filter(Boolean).join("\n"); }

  function inferType(title) {
    const match = title.match(/день\s+([ABCАВС])/i);
    return ({ A: "A", B: "B", C: "C", "А": "A", "В": "B", "С": "C" })[match?.[1]?.toUpperCase()] || "custom";
  }

  function parseWorkoutText(text, options = {}) {
    const lines = String(text || "").replace(/\r/g, "").split("\n").map((line) => line.replace(/\\\s*$/, ""));
    const title = parseWorkoutTitle(lines);
    const date = lines.map(parseDate).find(Boolean) || options.fallbackDate || localISODate();
    const generalWarmup = [];
    const workoutNotes = [];
    const exercises = [];
    const unknownLines = [];
    let mode = "header";
    let current = null;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line === title || parseDate(line)) continue;
      if (WARMUP_HEADER.test(line) && !current) { mode = "warmup"; continue; }
      const header = parseExerciseHeader(line.replace(/^##\s*/, ""));
      if (header) {
        current = { name: header.name, warmupSets: [], sets: [], rpe: null, notes: "" };
        exercises.push(current);
        mode = "exercise";
        continue;
      }
      if (mode === "warmup" && !current) {
        const item = parseGeneralWarmup(line);
        if (item) {
          generalWarmup.push(item);
          if (item.durationMinutes === null && !WARMUP_REPS.test(line)) unknownLines.push(line);
        }
        continue;
      }
      if (current) {
        const warmup = detectWarmupSet(line);
        const set = parseSet(warmup ? line.replace(WARMUP_SET, "") : line);
        if (set) {
          const { rpe, ...values } = set;
          (warmup ? current.warmupSets : current.sets).push(values);
          if (rpe !== null) current.rpe = rpe;
          continue;
        }
        const standaloneRPE = parseRPE(line);
        if (standaloneRPE !== null) { current.rpe = standaloneRPE; continue; }
        current.notes = parseExerciseNotes([current.notes, line]);
        unknownLines.push(line);
        continue;
      }
      if (line !== title) { workoutNotes.push(line); unknownLines.push(line); }
    }

    return {
      title, date, type: inferType(title), generalWarmup, workoutNotes: workoutNotes.join("\n"), exercises,
      warnings: unknownLines.length ? ["Часть текста сохранена как заметки. Проверь тренировку после добавления."] : [],
      stats: {
        generalWarmup: generalWarmup.length,
        exercises: exercises.length,
        warmupSets: exercises.reduce((sum, item) => sum + item.warmupSets.length, 0),
        sets: exercises.reduce((sum, item) => sum + item.sets.length, 0),
      },
    };
  }

  const api = { parseWorkoutText, parseWorkoutTitle, parseDate, parseGeneralWarmup, parseExerciseHeader, parseSet, detectWarmupSet, parseRPE, parseExerciseNotes, localISODate };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TrainingJournalTextImport = api;
})(typeof window !== "undefined" ? window : globalThis);
