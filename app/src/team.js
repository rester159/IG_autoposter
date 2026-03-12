/**
 * Team/Influencer module — delegates to SQLite via models.
 *
 * Same exported API as the original JSON-based version.
 */

const infModel = require('./models/influencer');

function loadTeam() {
  return infModel.list();
}

function saveTeam() {
  // No-op: SQLite writes are immediate. Kept for backward compat.
}

function getInfluencer(id) {
  return infModel.get(id);
}

function addInfluencer(data) {
  return infModel.add(data);
}

function updateInfluencer(id, data) {
  return infModel.update(id, data);
}

function deleteInfluencer(id) {
  return infModel.del(id);
}

function addPhoto(id, filename) {
  return infModel.addPhoto(id, filename);
}

function removePhoto(id, filename) {
  return infModel.removePhoto(id, filename);
}

function getPhotoDir(id) {
  return infModel.getPhotoDir(id);
}

module.exports = {
  loadTeam,
  saveTeam,
  getInfluencer,
  addInfluencer,
  updateInfluencer,
  deleteInfluencer,
  addPhoto,
  removePhoto,
  getPhotoDir,
};
