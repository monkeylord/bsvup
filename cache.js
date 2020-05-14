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
  if (!fs.existsSync('./.bsv/unbroadcasted')) {
    fs.mkdirSync('./.bsv/unbroadcasted')
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

function loadTXList (subdir = 'tx') {
  if (!fs.existsSync(`./.bsv/${subdir}`)) {
    return []
  }
  let identifiers = fs.readdirSync(`./.bsv/${subdir}/`).filter(identifer => identifer.length === 64)
  // return transaction ids in order of creation
  identifiers = identifiers.map(identifier => ({
    identifier: identifier,
    time: fs.statSync(`./.bsv/${subdir}/${identifier}`).birthtimeMs
  }))
  identifiers.sort((a,b) => a.time - b.time)
  return identifiers.map(identifier => identifier.identifier)
}

function saveTX (tx, subdir = 'tx') {
  if (!tx.id) { throw 'cannot save a tx id: need a full tx' }
  if (!fs.existsSync(`./.bsv/${subdir}`)) {
    fs.mkdirSync(`./.bsv/${subdir}`)
  }
  fs.writeFileSync(`./.bsv/${subdir}/${tx.id}`, tx.toString())
}

function loadTX (txid, subdir = 'tx') {
  try {
    return bsv.Transaction(fs.readFileSync(`./.bsv/${subdir}/${txid}`).toString())
  } catch (err) {
    return null
  }
}

function wipeTX (txid, subdir = 'tx') {
  try {
    fs.unlinkSync(`./.bsv/${subdir}/${txid}`)
  } catch (err) { }
}

function saveUnbroadcast (unBroadcast) {
  if (unBroadcast.length > 0) {
    for (let transaction of unBroadcast) {
      saveTX(transaction, 'unbroadcasted')
    }
    return unBroadcast
  } else {
    wipeUnbroadcast()
    return []
  }
}

function haveUnbroadcast () {
  if (fs.existsSync('./.bsv/unbroadcasted.tx.json')) {
    // convert legacy json file
    for (let transaction of JSON.parse(fs.readFileSync('./.bsv/unbroadcasted.tx.json'))) {
      saveTX(bsv.Transaction(transaction), 'unbroadcasted')
    }
    fs.unlinkSync('./.bsv/unbroadcasted.tx.json')
    return true
  }
  if (loadTXList('unbroadcasted').length > 0) {
    return true
  }
}

function loadUnbroadcast () {
  // function has been changed to handle very large transaction sets using an iterable
  // proposal: migrating away from it, instead using loadTXList directly
  if (haveUnbroadcast()) {
    const transactions = loadTXList('unbroadcasted')
    const iterable = { }

    // emulates some behavior of an array
    iterable.length = transactions.length
    iterable.push = function (transaction) {
      saveTX(transaction, 'unbroadcasted')
      transactions.push(transaction.id)
      iterable.length = transactions.length
    }

    let index = 0
    // provides support for for..of
    iterable[Symbol.iterator] = function () {
      return {
        next: function() {
          const iteration = {}
          //console.log(`nextUnbroadcast: ${index} / ${transactions.length}`)
          if (index < transactions.length) {
            //console.log(`  hash: ${transactions[index]}`)
            iteration.index = index
            iteration.value = loadTX(transactions[index ++], 'unbroadcasted')
            iteration.done = false
          } else {
            iteration.done = true
          }
          return iteration
        }
      }
    }
    return iterable
  } else {
    return []
  }
}

function wipeUnbroadcast () {
  if (haveUnbroadcast()) {
    for (let transaction of loadUnbroadcast()) {
      wipeTX(transaction, 'unbroadcasted')
    }
  }
}

function abandonUnbroadcast () {
  if (haveUnbroadcast()) {
    for (let transaction of loadUnbroadcast()) {
      saveTX(`transactions-abandoned-${Date.now()}`)
      wipeTX(transaction.id)
    }
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
