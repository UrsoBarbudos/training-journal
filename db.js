(function () {
  "use strict";

  const DB_NAME = "training-journal";
  const DB_VERSION = 1;
  const STORES = ["workouts", "exercises", "settings"];
  let connection;

  function open() {
    if (connection) return connection;
    connection = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("workouts")) {
          const workouts = db.createObjectStore("workouts", { keyPath: "id" });
          workouts.createIndex("date", "date", { unique: false });
          workouts.createIndex("status", "status", { unique: false });
        }
        if (!db.objectStoreNames.contains("exercises")) {
          db.createObjectStore("exercises", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("settings")) {
          db.createObjectStore("settings", { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Обновление базы заблокировано другой вкладкой"));
    });
    return connection;
  }

  async function store(name, mode = "readonly") {
    if (!STORES.includes(name)) throw new Error(`Неизвестное хранилище: ${name}`);
    const db = await open();
    return db.transaction(name, mode).objectStore(name);
  }

  function asPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function getAll(name) { return asPromise((await store(name)).getAll()); }
  async function get(name, key) { return asPromise((await store(name)).get(key)); }
  async function put(name, value) { return asPromise((await store(name, "readwrite")).put(value)); }
  async function remove(name, key) { return asPromise((await store(name, "readwrite")).delete(key)); }

  window.TrainingJournalDB = { open, getAll, get, put, remove };
})();
