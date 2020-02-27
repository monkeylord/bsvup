const bsv = require('bsv')
const BitDB = require('./bitdb.js')
/*
var bitindex = require('bitindex-sdk').instance({
  api_key: '4ZiBSwCzjgkCzDbX9vVV2TGqe951CBrwZytbbWiGqDuzkDETEkLJ9DDXuNMLsr8Bpj'
})
*/
var mattercloud = require('mattercloudjs').instance({
  api_key: '4ZiBSwCzjgkCzDbX9vVV2TGqe951CBrwZytbbWiGqDuzkDETEkLJ9DDXuNMLsr8Bpj'
})
var axios = require('axios')

const logLevel = {
  NONE: -1,
  CRITICAL: 0,
  ERROR: 1,
  WARNING: 2,
  INFO: 3,
  VERBOSE: 4
}

var currentLogLevel = logLevel.WARNING

function setLogLevel (level) {
  currentLogLevel = level
}

function log (log, level) {
  if (!(level > currentLogLevel)) {
    console.log(log)
  }
}

/*
    Handling transfer
*/
async function transfer (address, key) {
  var utxos = await getUTXOs(key.toAddress().toString())
  // 开始构造转账TX
  var tx = bsv.Transaction()
  utxos.forEach(utxo => tx.from(utxo))
  tx.change(address)
  tx.feePerKb(1536)
  tx.sign(key)
  log(`转账TXID Transfer TXID: ${tx.id}`, logLevel.INFO)
  await broadcastInsight(tx.toString(), true)
}

/*
    Get UTXOs from insight API
*/
async function getUTXOs (address) {
  log(`Requesting UTXOs for ${address}`, logLevel.INFO)
  return mattercloud.getUtxos([address]).then(utxos => {
    if (utxos.code) {
      log(`Error code ${utxos.code}: ${utxos.message}`, logLevel.WARNING)
    }
    return utxos
  })
}
/*
async function getUTXOs(address){
    return new Promise((resolve, reject)=>{
        fetch(insight + "/api/addrs/utxo", {
            method: 'POST',
            mode: 'cors',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: `addrs=${address}`
        })
        .then(r=>r.json())
        .then(unspents=>{
            resolve(unspents)
        })
        .catch(err=>{
            reject("Insight API return Errors: " + err)
        })
    })
}
*/

/*
    Broadcast transaction though insight API
*/
async function broadcastInsight (tx) {
  return mattercloud.sendRawTx(tx.toString()).then(async r => {
    if (r.message && r.message.message) {
      throw r
    }
    return r.txid
  }).catch(async err => {
    let code
    if (err.message && err.message.message) {
      code = err.code
      err = err.message.message.split('\n').slice(0, 3).join('\n')
    }
    log(' MatterCloud API return Errors: ' + code, logLevel.INFO)
    log(err, logLevel.INFO)
    let txexists = await getTX(tx.id)
    if (txexists.txid) {
      log(' However, transaction is actually present.', logLevel.INFO)
      return { txid: txexists.txid }
    } else {
      throw [tx.id, 'MatterCloud API return Errors: ' + err]
    }
  })
}
/*
async function broadcast_insight(tx){
    return new Promise((resolve, reject)=>{
        fetch(insight + "/api/tx/send", {
            method: 'POST',
            mode: 'cors',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: `rawtx=${tx.toString()}`
        })
        .then(r=>r.json())
        .then(body=>{
            if(body.errors){
                log(" Insight API return Errors: ", logLevel.INFO)
                log(err, logLevel.INFO)
                reject([tx.id,"Insight API return Errors: " + err.message.message])
            }else{
                resolve(body)
            }
        })
        .catch(err=>{
            log(" Insight API return Errors: ", logLevel.INFO)
            log(err, logLevel.INFO)
            reject([tx.id,"Insight API return Errors: " + err])
        })
    })

}
*/
/*
    Wrapped broadcast transaction, push unbroadcast transaction into unbroadcast array provided.
*/
async function broadcast (tx, unBroadcast) {
  try {
    const res = await broadcastInsight(tx)
    log(`Broadcasted ${res.txid}`, logLevel.INFO)
    return res
  } catch (e) {
    if (unBroadcast && Array.isArray(unBroadcast))unBroadcast.push(tx)
    throw e
  }
}

/*
    Try broadcast all transactions given.
    If TXs is null, load transactions from cache.
*/
async function tryBroadcastAll (TXs) {
  var toBroadcast = TXs
  var unBroadcast = []
  for (let tx of toBroadcast) {
    try {
      await broadcast(tx, unBroadcast)
    } catch ([txid, err]) {
      log(`${txid} 广播失败，原因 fail to broadcast:`, logLevel.INFO)
      log(err.split('\n')[0], logLevel.INFO)
      log(err.split('\n')[2], logLevel.INFO)
    }
  }
  return unBroadcast
}

/*
    Find exist bsvup B/Bcat record on blockchain.
    We use sha1 as file name.
*/
async function findExist (buf, mime) {
  var sha1 = bsv.crypto.Hash.sha1(buf).toString('hex')
  log(sha1, logLevel.VERBOSE)
  if (global.quick) return null
  var records = []
  if (!Array.isArray(records) || records.length === 0) {
    log(' - 向BitDB搜索已存在的文件记录 Querying BitDB', logLevel.VERBOSE)
    records = await BitDB.findExist(buf)
    records = records.filter(record => record.contenttype === mime)
  }
  if (records.length === 0) {
    log(` - BitDB returned no matched`, logLevel.VERBOSE)
    return null
  }
  log(` - BitDB returned ${records.length} matched`, logLevel.VERBOSE)
  var txs = await Promise.all(records.map(record => getTX(record.txid)))
  var matchTX = await Promise.race(txs.map(tx => {
    return new Promise(async (resolve, reject) => {
      var databuf = await getData(tx).catch(err => {
        log(` - TX Data not properly resolved. Error: ${err}`, logLevel.VERBOSE)
        return Buffer.alloc(0)
      })
      if (databuf.equals(buf)) resolve(tx)
      else reject(new Error('Not Matched'))
    })
  })).catch(err => {
    log(` - TX Data not properly resolved. Error: ${err}`, logLevel.VERBOSE)
    return null
  })
  if (matchTX) {
    return matchTX
  } else {
    return null
  }
}

/*
    BitDB queries are expensive at time
    We should do a all in one query
*/
var dRecords = null
async function findD (key, address, value) {
  // if (global.quick) return null
  // var dRecords = await BitDB.findD(key, address)
  if (!dRecords) {
    log(`查询${address}下所有D记录中...`, logLevel.INFO)
    log(`Query all D records on ${address} from BitDB...`, logLevel.INFO)
    dRecords = await BitDB.findD(null, address)
  }
  var keyDRecords = dRecords.filter(record => record.key === key)
  var dRecord = (keyDRecords.length > 0) ? keyDRecords[0] : null
  if (dRecord && dRecord.value === value) return true
  else return false
}

async function getTX (txid) {
  return new Promise((resolve, reject) => {
    var tx = null // Cache.loadTX(txid)
    if (tx) {
      resolve(tx)
    } else {
      //bitindex.tx.getRaw(txid).then(res => {
      axios.get(`https://api.mattercloud.net/api/rawtx/${txid}`).then(res=>res.data).then(res => {
        tx = bsv.Transaction(res.rawtx)
        // Cache.saveTX(tx)
        resolve(tx)
      }).catch(err => {
        log(`获取TX时发生错误 Error acquring TX ${txid}`, logLevel.INFO)
        log(err, logLevel.INFO)
        resolve(null)
      })
    }
  }).catch(err => {
    log(`Return empty result because ${err}`, logLevel.VERBOSE)
    return null
  })
}
/*
async function getTX(txid) {
    return new Promise((resolve, reject) => {
        var tx = null // Cache.loadTX(txid)
        if (tx) {
            resolve(tx)
        } else {
            fetch(insight + `/api/tx/${txid}`)
                .then(r=>r.json())
                .then(body=>{
                    if(body.errors){
                        reject(body.errors)
                    }else{
                        tx = bsv.Transaction(body.rawtx)
                        //Cache.saveTX(tx)
                        resolve(tx)
                    }
                })
                .catch(err=>{
                    log(`获取TX时发生错误 Error acquring TX ${txid}`, logLevel.INFO)
                    log(err, logLevel.INFO)
                    reject(err)
                })
        }
    }).catch(err => null)
}
*/
/*
    Extract B/Bcat data from transaction(s)
*/
async function getData (tx) {
  var dataout = tx.outputs.filter(out => out.script.isDataOut() || out.script.isSafeDataOut())
  if (dataout.length === 0) throw new Error('Not Data TX')
  var bufs = dataout[0].script.chunks.map(chunk => (chunk.buf) ? chunk.buf : new bsv.deps.Buffer(0))
  var offset = dataout[0].script.isSafeDataOut() ? 1 : 0
  if (bufs[1 + offset].toString() === '19HxigV4QyBv3tHpQVcUEQyq1pzZVdoAut') return bufs[2 + offset]
  else {
    // 处理Bcat
    var bParts = bufs.slice(7 + offset).map(buf => buf.toString('hex'))
    log('处理Bcat中。。。' + bParts, logLevel.VERBOSE)
    var bPartTXs = await Promise.all(bParts.map(bPart => getTX(bPart)))
    log(bPartTXs.map(tx => tx.id), logLevel.VERBOSE)
    var bPartBufs = bPartTXs.map(tx => {
      let output = tx.outputs.filter(out => out.script.isDataOut() || out.script.isSafeDataOut())[0]
      return output.script.chunks[output.script.isSafeDataOut() ? 3 : 2].buf
    })
    log(bPartBufs.map(buf => buf.length), logLevel.VERBOSE)
    var buf = bsv.deps.Buffer.concat(bPartBufs)
    log(buf.length, logLevel.VERBOSE)
    return buf
  }
}

function readDir (file, dirHandle) {
  return {}
}

function readFile (file, dirHandle) {
  return {}
}

function readFiles (path) {
  return []
}

function isDirectory (path) {
  return false
}

module.exports = {
  transfer: transfer,
  findD: findD,
  findExist: findExist,
  tryBroadcastAll: tryBroadcastAll,
  broadcast: broadcast,
  getUTXOs: getUTXOs,
  readFile: readFile,
  readDir: readDir,
  readFiles: readFiles,
  isDirectory: isDirectory,
  logLevel: logLevel,
  setLogLevel: setLogLevel,
  log: log
}
