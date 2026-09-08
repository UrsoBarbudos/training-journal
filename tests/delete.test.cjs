const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const context = vm.createContext({ window: {}, structuredClone });
vm.runInContext(fs.readFileSync(require.resolve("../db.js"), "utf8"), context);
const db = context.window.TrainingJournalDB;

test("data layer предоставляет одну функцию полного удаления", () => {
  assert.equal(typeof db.deleteWorkout, "function");
  assert.equal(db.deleteWorkoutAndQueue, db.deleteWorkout);
});

test("связанные записи упражнения определяются по workoutId", () => {
  assert.equal(db.belongsToWorkout({ workoutId: "one", sets: [1], notes: "x" }, "one"), true);
});

test("удаление одной тренировки не выбирает данные второй", () => {
  const records = [{ id: "a", workoutId: "one" }, { id: "b", workoutId: "two" }];
  assert.deepEqual(records.filter((item) => db.belongsToWorkout(item, "one")).map((item) => item.id), ["a"]);
});

test("legacy-связь workout.id также попадает в каскад", () => {
  assert.equal(db.belongsToWorkout({ workout: { id: "legacy" }, actualSets: [1], notes: "x" }, "legacy"), true);
  assert.equal(db.belongsToWorkout({ workout: { id: "other" } }, "legacy"), false);
});
