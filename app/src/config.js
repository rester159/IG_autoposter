/**
 * Config & History module — delegates to SQLite via models.
 *
 * Exports the same API as the original JSON-based version so that
 * scheduler.js, caption.js, server.js, etc. keep working unchanged.
 */

const fs = require('fs');
const configModel = require('./models/config');
const historyModel = require('./models/history');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ── Config ────────────────────────────────────────────────────────

function loadConfig() {
  return configModel.getAll();
}

function saveConfig(partial) {
  configModel.setMultiple(partial);
  return configModel.getAll();
}

// ── History ───────────────────────────────────────────────────────

function loadHistory() {
  return historyModel.list(500);
}

function addHistory(entry) {
  historyModel.add(entry);
  return historyModel.list(500);
}

module.exports = {
  loadConfig,
  saveConfig,
  loadHistory,
  addHistory,
  DEFAULT_CONFIG: configModel.DEFAULT_CONFIG,
  ensureDir,
};
