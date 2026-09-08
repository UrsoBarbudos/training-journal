const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseWorkoutText } = require("../text-import.js");

test("обычная тренировка", () => {
  const result = parseWorkoutText(`День A — Спина\n08.09.2026\n\n1. Верхний блок\n55 кг x 12\n55 кг x 12\n55 кг x 12`);
  assert.equal(result.title, "День A — Спина");
  assert.equal(result.date, "2026-09-08");
  assert.equal(result.exercises.length, 1);
  assert.equal(result.exercises[0].sets.length, 3);
});

test("общая разминка", () => {
  const result = parseWorkoutText(`День A — Спина\n08.09.2026\n\nРазминка\nСтеппер — 10 мин\nМобилизация плеч — 5 мин\n\n1. Верхний блок\n55 кг x 12`);
  assert.equal(result.generalWarmup.length, 2);
  assert.deepEqual(result.generalWarmup.map((item) => item.durationMinutes), [10, 5]);
  assert.equal(result.exercises[0].sets.length, 1);
});

test("разминочные и рабочие подходы", () => {
  const result = parseWorkoutText(`1. Верхний блок\nРазминка: 40 кг x 15\nРазминочный подход: 50 кг × 8\n55 кг X 12\n55 x 12`, { fallbackDate: "2026-09-08" });
  assert.deepEqual(result.exercises[0].warmupSets, [{ weight: 40, reps: 15 }, { weight: 50, reps: 8 }]);
  assert.deepEqual(result.exercises[0].sets, [{ weight: 55, reps: 12 }, { weight: 55, reps: 12 }]);
});

test("RPE, дробный и нулевой вес", () => {
  const result = parseWorkoutText(`1. Тяга блока\n60 кг x 12 — RPE 8\n\n2. Махи\n7.5 кг x 15\n\n3. Упражнение\n0 кг x 15`);
  assert.equal(result.exercises[0].rpe, 8);
  assert.equal(result.exercises[1].sets[0].weight, 7.5);
  assert.equal(result.exercises[2].sets[0].weight, 0);
});

test("заметки и неизвестные строки не теряются", () => {
  const result = parseWorkoutText(`1. Верхний блок\nНейтральный хват\n55 кг x 12\nПоследний подход тяжёлый`);
  assert.match(result.exercises[0].notes, /Нейтральный хват/);
  assert.match(result.exercises[0].notes, /Последний подход тяжёлый/);
  assert.equal(result.warnings.length, 1);
});

test("разминка с повторами сохраняется без потери", () => {
  const result = parseWorkoutText(`День C\nРазминка\nFace Pull — 2 x 20\n\n1) Тяга\n10 x 10`);
  assert.equal(result.generalWarmup[0].name, "Face Pull");
  assert.equal(result.generalWarmup[0].notes, "2 x 20");
});

test("ISO-дата и локальный fallback", () => {
  assert.equal(parseWorkoutText(`Тренировка\n2026-09-08\n1. Тяга\n10 x 10`).date, "2026-09-08");
  assert.equal(parseWorkoutText(`1. Тяга\n10 x 10`, { fallbackDate: "2026-09-07" }).date, "2026-09-07");
});
