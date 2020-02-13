function init () {

}

function isKeyExist () {
  return false
}

function loadKey (password) {
  return null
}
function saveKey (privkey, password) {

}

function saveFileRecord (sha1, records) {

}

function loadFileRecord (sha1) {
  return []
}

function saveTX (tx) {

}

function loadTX (txid) {
  return null
}

function saveUnbroadcast (unBroadcast) {
  return []
}

function loadUnbroadcast () {
  return []
}

module.exports = {
  initCache: init,
  isKeyExist: isKeyExist,
  loadKey: loadKey,
  saveKey: saveKey,
  saveFileRecord: saveFileRecord,
  loadFileRecord: loadFileRecord,
  saveTX: saveTX,
  loadTX: loadTX,
  saveUnbroadcast: saveUnbroadcast,
  loadUnbroadcast: loadUnbroadcast
}
