/*
    This module handle local cache
    - TX cache
    - D record cache (TODO, but actually it's meaningless to cache D, because you still need to acquire latest D records every time)
    - B/Bcat/BcatPart record cache
    - PrivateKey cache
    - Unbroadcast TXs
*/
const bsv = require('bsv')
const fs = require('fs')
const crypto = require('crypto')

function init () {
  if (!fs.existsSync('./.bsv')) {
    fs.mkdirSync('./.bsv')
  }
  // 初始化objects结构
  if (!fs.existsSync('./.bsv/objects')) {
    fs.mkdirSync('./.bsv/objects')
  }
  // 初始化D镜像目录
  if (!fs.existsSync('./.bsv/tx')) {
    fs.mkdirSync('./.bsv/tx')
  }
  // 初始化D树文件
  if (!fs.existsSync('./.bsv/info')) {
    fs.mkdirSync('./.bsv/info')
  }
}

function isKeyExist () {
  return fs.existsSync('./.bsv/key')
}

function loadKey (password) {
  var buf = fs.readFileSync('./.bsv/key').toString()
  var decBuf = decrypt(buf, password)
  return bsv.PrivateKey(decBuf.toString())
}
function saveKey (privkey, password) {
  var buf = Buffer.from(privkey.toString())
  var encBuf = encrypt(buf, password)
  fs.writeFileSync('./.bsv/key', encBuf)
}

function encrypt (plaintext, password) {
  var cipher = crypto.createCipher('aes-128-ecb', password)
  return cipher.update(plaintext, 'utf8', 'hex') + cipher.final('hex')
}
function decrypt (ciphertext, password) {
  var cipher = crypto.createDecipher('aes-128-ecb', password)
  return cipher.update(ciphertext, 'hex', 'utf8') + cipher.final('utf8')
}

function saveFileRecord (sha1, records) {
  fs.writeFileSync(`./.bsv/objects/${sha1}`, JSON.stringify(records))
}

function loadFileRecord (sha1) {
  try {
    return JSON.parse(fs.readFileSync(`./.bsv/objects/${sha1}`))
  } catch (err) {
    return []
  }
}

function loadTXList () {
  return fs.readdirSync('./.bsv/tx/').filter(identifier => identifier.length === 64)
}

function saveTX (tx) {
  fs.writeFileSync(`./.bsv/tx/${tx.id}`, tx.toString())
}

function loadTX (txid) {
  try {
    return bsv.Transaction(fs.readFileSync(`./.bsv/tx/${txid}`).toString())
  } catch (err) {
    return null
  }
}

function wipeTX (txid) {
  try {
    fs.unlinkFileSync(`./.bsv/tx/${txid}`)
  } catch (err) { }
}

function saveUnbroadcast (unBroadcast) {
  if (unBroadcast.length > 0) {
    const filename = './.bsv/unbroadcasted.tx.json'
    fs.writeFileSync(filename, '[')
    let first = true
    for (let transaction of unBroadcast) {
      if (! first) { fs.appendFileSync(filename, ',') }
      fs.appendFileSync(filename, JSON.stringify(transaction))
      first = false
    }
    fs.appendFileSync(filename, ']')
    return unBroadcast
  } else {
    wipeUnbroadcast()
    return []
  }
}

function haveUnbroadcast () {
  return fs.existsSync('./.bsv/unbroadcasted.tx.json')
}

function loadUnbroadcast () {
  var unBroadcast
  if (haveUnbroadcast()) {
    unBroadcast = JSON.parse(fs.readFileSync('./.bsv/unbroadcasted.tx.json')).map(tx => bsv.Transaction(tx))
  } else {
    unBroadcast = []
  }
  return unBroadcast
}

function wipeUnbroadcast () {
  if (haveUnbroadcast()) {
    fs.unlinkSync('./.bsv/unbroadcasted.tx.json')
  }
}

function abandonUnbroadcast () {
  if (haveUnbroadcast()) {
    for (let transaction of loadUnbroadcast()) {
      try {
        fs.renameSync(`./.bsv/tx/${transaction.id}`, `./.bsv/tx/abandoned-${transaction.id}`)
      } catch (err) { }
    }
    fs.renameSync('./.bsv/unbroadcasted.tx.json', `./.bsv/abandoned-${Date.now()}.tx.json`)
  }
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
  wipeTX: wipeTX,
  loadTXList: loadTXList,
  saveUnbroadcast: saveUnbroadcast,
  haveUnbroadcast: haveUnbroadcast,
  loadUnbroadcast: loadUnbroadcast,
  wipeUnbroadcast: wipeUnbroadcast,
  abandonUnbroadcast: abandonUnbroadcast
}
