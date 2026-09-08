(function () {
  "use strict";
  const db = window.TrainingJournalDB;
  const CONFIG_KEY = "syncConfig";
  const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000;
  let running = false;
  function emit(detail) { window.dispatchEvent(new CustomEvent("training-journal-sync", { detail })); }
  async function config() { return (await db.get("settings", CONFIG_KEY)) || { key: CONFIG_KEY, apiUrl: "", token: "" }; }
  async function saveConfig(apiUrl, token) { const value = { key: CONFIG_KEY, apiUrl: apiUrl.trim().replace(/\/$/, ""), token: token.trim(), updatedAt: new Date().toISOString() }; await db.put("settings", value); emit({ status: "pending" }); return value; }
  function retryAt(attempts, blocked = false) { const delay = blocked ? MAX_BACKOFF_MS : Math.min(MAX_BACKOFF_MS, 5000 * (2 ** Math.min(attempts, 10))); return new Date(Date.now() + delay).toISOString(); }
  async function requestFor(entry, syncConfig) { return fetch(`${syncConfig.apiUrl}/api/v1/workouts/${encodeURIComponent(entry.entityId)}`, { method: entry.operation === "delete" ? "DELETE" : "PUT", headers: { Authorization: `Bearer ${syncConfig.token}`, "Content-Type": "application/json" }, body: JSON.stringify(entry.payload), cache: "no-store" }); }
  async function queueState() { const entries = await db.getSyncQueue(); if (!entries.length) return emit({ status: "synced", pending: 0 }); const blocked = entries.some((entry) => /^(401|403|409)/.test(String(entry.lastError || ""))); emit({ status: blocked ? "error" : "pending", pending: entries.length }); }
  async function flush() {
    if (running) return; running = true;
    try {
      const syncConfig = await config(); if (!syncConfig.apiUrl || !syncConfig.token) { await queueState(); return; }
      for (const entry of await db.getReadySyncOperations()) {
        try {
          const response = await requestFor(entry, syncConfig);
          if (response.ok || (entry.operation === "delete" && response.status === 404)) { await db.removeSyncOperation(entry.id); continue; }
          let message = `${response.status} ${response.statusText}`; try { const body = await response.json(); message = `${response.status} ${body.message || body.code || response.statusText}`; } catch {}
          const blocked = [401, 403, 409].includes(response.status); await db.updateSyncFailure(entry.id, message, retryAt(entry.attempts, blocked)); if (blocked) break;
        } catch (error) { await db.updateSyncFailure(entry.id, error.message || "Сетевая ошибка", retryAt(entry.attempts)); break; }
      }
      await queueState();
    } finally { running = false; }
  }
  async function testConnection(apiUrl, token) { const response = await fetch(`${apiUrl.trim().replace(/\/$/, "")}/api/v1/workouts?limit=1`, { headers: { Authorization: `Bearer ${token.trim()}` }, cache: "no-store" }); if (!response.ok) throw new Error(`API вернул ${response.status}`); return true; }
  window.addEventListener("online", flush);
  window.TrainingJournalSync = { config, saveConfig, flush, queueState, testConnection };
})();
