(function () {
  "use strict";
  const DB_NAME = "training-journal";
  const DB_VERSION = 2;
  const STORES = ["workouts", "exercises", "settings", "syncQueue"];
  const MIGRATION_KEY = "syncMigrationV1Completed";
  let connection;
  function requestPromise(request) { return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
  function transactionDone(transaction) { return new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error || new Error("Транзакция IndexedDB отменена")); }); }
  function open() {
    if (connection) return connection;
    connection = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains("workouts")) { const workouts = database.createObjectStore("workouts", { keyPath: "id" }); workouts.createIndex("date", "date"); workouts.createIndex("status", "status"); }
        if (!database.objectStoreNames.contains("exercises")) database.createObjectStore("exercises", { keyPath: "id" });
        if (!database.objectStoreNames.contains("settings")) database.createObjectStore("settings", { keyPath: "key" });
        if (!database.objectStoreNames.contains("syncQueue")) { const queue = database.createObjectStore("syncQueue", { keyPath: "id" }); queue.createIndex("entityId", "entityId"); queue.createIndex("nextAttemptAt", "nextAttemptAt"); }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { connection = null; reject(request.error); };
      request.onblocked = () => { connection = null; reject(new Error("Обновление базы заблокировано другой вкладкой")); };
    });
    return connection;
  }
  async function store(name, mode = "readonly") { if (!STORES.includes(name)) throw new Error(`Неизвестное хранилище: ${name}`); return (await open()).transaction(name, mode).objectStore(name); }
  async function getAll(name) { return requestPromise((await store(name)).getAll()); }
  async function get(name, key) { return requestPromise((await store(name)).get(key)); }
  async function put(name, value) { return requestPromise((await store(name, "readwrite")).put(value)); }
  async function remove(name, key) { return requestPromise((await store(name, "readwrite")).delete(key)); }
  function queueId(entityId) { return `workout:${entityId}`; }
  function makeQueueEntry(workout, operation = "upsert") { const now = new Date().toISOString(); return { id: queueId(workout.id), entityType: "workout", entityId: workout.id, operation, payload: operation === "upsert" ? structuredClone(workout) : { clientUpdatedAt: workout.updatedAt || now }, createdAt: now, attempts: 0, nextAttemptAt: now, lastError: null }; }
  function belongsToWorkout(value, workoutId) { return value?.workoutId === workoutId || value?.workout?.id === workoutId; }
  async function saveWorkoutAndQueue(workout) { const database = await open(); const tx = database.transaction(["workouts", "syncQueue"], "readwrite"); tx.objectStore("workouts").put(structuredClone(workout)); tx.objectStore("syncQueue").put(makeQueueEntry(workout)); await transactionDone(tx); return workout.id; }
  async function deleteWorkout(workout) {
    const database = await open();
    const tx = database.transaction(["workouts", "exercises", "syncQueue"], "readwrite");
    tx.objectStore("syncQueue").put(makeQueueEntry(workout, "delete"));
    tx.objectStore("workouts").delete(workout.id);
    const exerciseStore = tx.objectStore("exercises");
    const cursorRequest = exerciseStore.openCursor();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      const value = cursor.value || {};
      if (belongsToWorkout(value, workout.id)) cursor.delete();
      cursor.continue();
    };
    await transactionDone(tx);
  }
  const deleteWorkoutAndQueue = deleteWorkout;
  async function migrateExistingWorkoutsToQueue() {
    const database = await open(); const tx = database.transaction(["workouts", "settings", "syncQueue"], "readwrite"); const settings = tx.objectStore("settings");
    const marker = await requestPromise(settings.get(MIGRATION_KEY));
    if (marker?.value === true) { tx.abort(); return false; }
    const workouts = await requestPromise(tx.objectStore("workouts").getAll()); const queue = tx.objectStore("syncQueue"); workouts.forEach((workout) => queue.put(makeQueueEntry(workout)));
    settings.put({ key: MIGRATION_KEY, value: true, completedAt: new Date().toISOString(), workoutCount: workouts.length }); await transactionDone(tx); return true;
  }
  async function getReadySyncOperations(now = new Date().toISOString(), limit = 20) { const database = await open(); const index = database.transaction("syncQueue").objectStore("syncQueue").index("nextAttemptAt"); const entries = await requestPromise(index.getAll(IDBKeyRange.upperBound(now), limit)); return entries.sort((a, b) => a.createdAt.localeCompare(b.createdAt)); }
  async function updateSyncFailure(id, errorMessage, nextAttemptAt) { const database = await open(); const tx = database.transaction("syncQueue", "readwrite"); const queue = tx.objectStore("syncQueue"); const entry = await requestPromise(queue.get(id)); if (entry) { entry.attempts = Number(entry.attempts || 0) + 1; entry.lastError = String(errorMessage).slice(0, 500); entry.nextAttemptAt = nextAttemptAt; queue.put(entry); } await transactionDone(tx); }
  async function removeSyncOperation(id) { return remove("syncQueue", id); }
  async function getSyncQueue() { return getAll("syncQueue"); }
  window.TrainingJournalDB = { open, getAll, get, put, remove, saveWorkoutAndQueue, deleteWorkout, deleteWorkoutAndQueue, migrateExistingWorkoutsToQueue, getReadySyncOperations, updateSyncFailure, removeSyncOperation, getSyncQueue, belongsToWorkout };
})();
