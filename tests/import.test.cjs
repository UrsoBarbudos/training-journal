const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const importer = require('../plan-import.js');
const fixture = require('./fixtures/plan.json');
const fresh = () => structuredClone(fixture);
const parse = (value) => importer.parseJSONPlan(JSON.stringify(value));
const markdown = '# День B — Тренировка\n📅 04.09.26\n## 1. Тяга\nРазминка: **12×15**\nРабочие: **23×15 ×4**';

// Expose closure functions only inside the test VM; production has no test hooks.
const context = vm.createContext({
  window: { TrainingJournalImport: importer }, crypto: webcrypto,
  localStorage: { getItem: () => null }, document: {
    addEventListener() {},
    createElement() { return { _text: '', set textContent(value) { this._text = String(value); }, get innerHTML() { return this._text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'); } }; },
  },
});
vm.runInContext(fs.readFileSync(require.resolve('../app.js'), 'utf8').replace(/\}\)\(\);\s*$/, 'globalThis.testAPI = { parseImportedPlan, normalizeWorkout, normalizeSet, buildSummary, renderExercise }; })();'), context);
const app = context.testAPI;
const plain = (value) => JSON.parse(JSON.stringify(value));

test('чистый JSON и несколько упражнений', () => assert.deepEqual(parse(fixture), fixture));
test('fenced JSON', () => assert.deepEqual(importer.parseJSONPlan('```json\n' + JSON.stringify(fixture) + '\n```'), fixture));
test('полный ответ: JSON имеет приоритет над Markdown', () => {
  const result = app.parseImportedPlan(markdown + '\n```json\n' + JSON.stringify(fixture) + '\n```', '2020-01-01');
  assert.deepEqual(result, fixture);
});
test('CRLF, пробелы и регистр JSON', () => assert.deepEqual(importer.parseJSONPlan('  ```JSON\r\n' + JSON.stringify(fixture) + '\r\n  ```  '), fixture));
test('точное число подходов, отдельная разминка, null и длительность после нормализации', () => {
  const result = app.normalizeWorkout(parse(fixture));
  assert.deepEqual(plain(result.exercises.map(e => e.sets.length)), [4, 4, 0]);
  assert.equal(result.exercises[0].warmupSets.length, 1);
  assert.equal(result.exercises[0].warmupSets[0].weight, '12');
  assert.equal(result.exercises[0].sets[0].weight, '23');
  assert.equal(result.exercises[0].sets[0].reps, '15');
  assert.equal(result.exercises[1].sets[0].weight, '');
  assert.equal(result.exercises[2].durationMinutes, 25);
  assert.deepEqual(plain(app.normalizeWorkout(result)), plain(result));
  assert.match(app.buildSummary(result), /Длительность: 25 мин/);
  const firstHTML = app.renderExercise(result.exercises[0], 0);
  assert.equal((firstHTML.match(/class="set-row-shell"/g) || []).length, 4);
  assert.match(firstHTML, /value="23"/);
  assert.match(firstHTML, /value="15"/);
  const trxHTML = app.renderExercise(result.exercises[1], 1);
  assert.match(trxHTML, /data-field="weight"[^>]*value=""/);
  assert.match(trxHTML, /data-field="reps"[^>]*value="15"/);
  assert.match(app.renderExercise(result.exercises[2], 2), /data-exercise-field="durationMinutes"[^>]*value="25"/);
});
test('reps=null, дробный вес, RPE и заметки', () => {
  const value = fresh();
  Object.assign(value.exercises[0], { rpe: 7.5, notes: 'Без рывков <&>' });
  value.exercises[0].sets = [{ weight: 12.5, reps: null }];
  const exercise = app.normalizeWorkout(parse(value)).exercises[0];
  assert.equal(exercise.sets[0].weight, '12.5');
  assert.equal(exercise.sets[0].reps, '');
  assert.equal(exercise.rpe, '7.5');
  assert.equal(exercise.notes, value.exercises[0].notes);
});
test('durationMinutes позволяет отсутствие sets и null', () => {
  const value = fresh(); delete value.exercises[2].sets; value.exercises[2].durationMinutes = null;
  assert.deepEqual(parse(value).exercises[2].sets, []);
  assert.equal(app.normalizeWorkout(parse(value)).exercises[2].durationMinutes, null);
});
test('malformed JSON не запускает Markdown', () => {
  for (const text of ['{"version":', markdown + '\n```json\n{broken}\n```', markdown + '\n```json\n{}']) {
    assert.throws(() => app.parseImportedPlan(text, fixture.date), /Не удалось прочитать JSON/);
  }
});
for (const [name, mutate, error] of [
  ['нет exercises', p => delete p.exercises, /exercises/],
  ['пустой exercises', p => p.exercises = [], /exercises/],
  ['нет name', p => delete p.exercises[2].name, /№3/],
  ['пустой name', p => p.exercises[0].name = ' ', /№1/],
  ['нет sets', p => delete p.exercises[1].sets, /TRX Row.*отсутствует поле sets/],
  ['пустой sets', p => p.exercises[0].sets = [], /рабочий подход/],
  ['неверная дата', p => p.date = '2026-02-30', /Некорректная дата/],
  ['формат даты', p => p.date = '04.09.2026', /Некорректная дата/],
  ['версия', p => p.version = 2, /версия/],
  ['тип', p => p.type = 'D', /тип/],
  ['название', p => p.title = '', /название/],
  ['нет warmupSets', p => delete p.exercises[0].warmupSets, /warmupSets/],
  ['строковый вес', p => p.exercises[0].sets[0].weight = '23', /weight/],
  ['нет reps', p => delete p.exercises[0].sets[0].reps, /reps/],
  ['неверный RPE', p => p.exercises[0].rpe = '7', /rpe/],
  ['неверные notes', p => p.exercises[0].notes = null, /notes/],
  ['неверная длительность', p => p.exercises[2].durationMinutes = '25', /durationMinutes/],
]) test(name, () => { const p = fresh(); mutate(p); assert.throws(() => parse(p), error); });
test('неизвестная структура', () => {
  for (const value of [{}, [], null, true, 123, 'text']) assert.throws(() => parse(value));
});
test('несколько блоков не импортируются неоднозначно', () => assert.throws(() => importer.parseJSONPlan('```json\n{}\n```\n```json\n{}\n```'), /несколько/));
test('старый Markdown сохраняет поведение', () => {
  assert.equal(importer.parseJSONPlan(markdown), null);
  assert.equal(importer.parseJSONPlan('04.09.2026\n' + markdown), null);
  const result = app.parseImportedPlan(markdown, '2020-01-01');
  assert.equal(result.type, 'B'); assert.equal(result.date, fixture.date);
  assert.equal(result.exercises[0].sets.length, 4);
  assert.equal(result.exercises[0].warmupSets[0].weight, '12');
});
test('сохранённые тренировки: actualSets, plan, feedback, неизвестные данные; исходник не изменяется', () => {
  const legacy = { id: 'old', date: '2025-01-01', status: 'completed', post: { lowerBack: 3 }, exercises: [
    { id: 'e', name: 'Тяга', actualSets: [{ type: 'warmup', weight: 10, reps: 8 }, { weight: 30, reps: 12 }], feedback: { rpe: 8 }, notes: 'История', customMetric: 123 },
    { name: 'Жим', plan: { sets: 3, weight: 40, reps: 10 } },
  ] };
  const before = structuredClone(legacy);
  const result = app.normalizeWorkout(legacy);
  assert.deepEqual(legacy, before);
  assert.equal(result.id, 'old'); assert.equal(result.status, 'completed');
  assert.equal(result.exercises[0].warmupSets[0].weight, '10');
  assert.equal(result.exercises[0].sets[0].weight, '30');
  assert.equal(result.exercises[0].rpe, '8');
  assert.equal(result.exercises[0].customMetric, 123);
  assert.equal(result.exercises[1].sets.length, 3);
  assert.equal(result.post.pain, '3');
  assert.deepEqual(plain(app.normalizeWorkout(result)), plain(result));
});
