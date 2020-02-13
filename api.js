/*
    This module handle details and APIs
    - acquire file/directory data
    - acquire blockchain data
    - broadcast to blockchain

    This should cover the difference between Node/Browser.
    TODO: Browser implements
*/
const bsv = require('bsv')
const fs = require('fs')
const BitDB = require('./bitdb.js')
const MimeLookup = require('mime-lookup')
const MIME = new MimeLookup(require('mime-db'))
const crypto = require('crypto')
const Cache = require('./cache.js')
var bitindex = require('bitindex-sdk').instance({
  api_key: '4ZiBSwCzjgkCzDbX9vVV2TGqe951CBrwZytbbWiGqDuzkDETEkLJ9DDXuNMLsr8Bpj'
})

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
  return bitindex.address.getUtxos([address]).then(utxos => {
    if (utxos.code) {
      log(`Error code ${utxos.code}: ${utxos.message}`, logLevel.WARNING)
    }
    return utxos
  })
  /*
    return new Promise((resolve, reject)=>{
        insight.getUtxos(address,(err,unspents)=>{
            if(err){
                reject("Insight API return Errors: " + err)
            } else {
                utxos = unspents
                resolve(unspents)
            }
        })
    })
    */
}

/*
    Broadcast transaction though insight API
*/
async function broadcastInsight (tx) {
  let txexists = await BitDB.findTx(tx.id)
  if (txexists.length) {
    log(' Transaction is actually present.', logLevel.INFO)
    return tx.id
  }

  return bitindex.tx.send(tx.toString()).then(r => {
    if (r.message && r.message.message) {
      throw r.message.message.split('\n').slice(0, 3).join('\n')
    }
    if (!r.txid) {
      // 2020-02-04: this appears to indicate mattercloud rate limiting
      log(r, logLevel.INFO)
      log('Waiting 60s ...', logLevel.INFO)
      return new Promise(resolve => setTimeout(resolve, 60000))
        .then(() => broadcastInsight(tx))
    }
    return r.txid
  }).catch(async err => {
    log(' BitIndex API return Errors: ', logLevel.INFO)
    log(err, logLevel.INFO)
    throw [tx.id, 'BitIndex API return Errors: ' + err]
  })

  /*
    return new Promise((resolve, reject)=>{
        insight.broadcast(tx.toString(),(err,res)=>handleBroadcast(err,res))
        async function handleBroadcast(err,res){
            if(err){
                if(err.message && err.message.message)err=err.message.message
                log(" Insight API return Errors: ", logLevel.INFO)
                log(err, logLevel.INFO)
                let txexists = await new Promise(resolve=>{
                    insight.getTransaction(tx.id,(err,res)=>resolve(!err && res))
                })
                if (txexists) {
                    log(" However, transaction is actually present.", logLevel.INFO)
                    resolve(txexists.txid)
                } else {
                    reject([tx.id,"Insight API return Errors: " + err])
                }
            }else{
                resolve(res)
            }
        }
    })
    */
}

/*
    Wrapped broadcast transaction, push unbroadcast transaction into unbroadcast array provided.
*/
async function broadcast (tx, unBroadcast) {
  try {
    const res = await broadcastInsight(tx)
    Cache.saveTX(tx)
    log(`Broadcasted ${res}`, logLevel.INFO)
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
  var toBroadcast = TXs || Cache.loadUnbroadcast()
  var unBroadcast = []
  var needToWait = false
  for (let tx of toBroadcast) {
    try {
      if (needToWait) {
        unBroadcast.push(tx)
      } else {
        await broadcast(tx, unBroadcast)
      }
    } catch ([txid, err]) {
      log(`${txid} 广播失败，原因 fail to broadcast:`, logLevel.INFO)
      log(err.split('\n')[0], logLevel.INFO)
      log(err.split('\n')[2], logLevel.INFO)
      if (err.indexOf('too-long-mempool-chain') !== -1) {
        needToWait = true
      }
    }
  }
  return Cache.saveUnbroadcast(unBroadcast)
}

/*
    Find exist bsvup B/Bcat record on blockchain.
    We use sha1 as file name.
*/
async function findExist (buf, mime) {
  var sha1 = crypto.createHash('sha1').update(buf).digest('hex')
  log(sha1, logLevel.VERBOSE)
  if (global.quick) return null
  var records = Cache.loadFileRecord(sha1)
  if (!Array.isArray(records) || records.length === 0) {
    log(' - 向BitDB搜索已存在的文件记录 Querying BitDB', logLevel.VERBOSE)
    records = await BitDB.findExist(buf)
    records = records.filter(record => record.contenttype === mime)
  }
  if (records.length === 0) return null
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
    Cache.saveFileRecord(sha1, records)
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
  if (global.quick) return null
  // var dRecords = await BitDB.findD(key, address)
  if (!dRecords) {
    log(`查询${address}下所有D记录中...`, logLevel.VERBOSE)
    log(`Query all D records on ${address} from BitDB...`, logLevel.VERBOSE)
    dRecords = await BitDB.findD(null, address)
  }
  var keyDRecords = dRecords.filter(record => record.key === key)
  var dRecord = (keyDRecords.length > 0) ? keyDRecords[0] : null
  if (dRecord && dRecord.value === value) return true
  else return false
}

async function getTX (txid) {
  return new Promise((resolve, reject) => {
    var tx = Cache.loadTX(txid)
    if (tx) {
      resolve(tx)
    } else {
      bitindex.tx.getRaw(txid).then(res => {
        tx = bsv.Transaction(res.rawtx)
        Cache.saveTX(tx)
        resolve(tx)
      }).catch(err => {
        log(`获取TX时发生错误 Error acquring TX ${txid}`, logLevel.INFO)
        log(err, logLevel.INFO)
        resolve(null)
      })
      /*
            insight.requestGet(`/api/tx/${txid}`, (err, res, body) => {
                if (err || res.statusCode !== 200) reject(err || body)
                //console.log(body)
                try {
                    tx = bsv.Transaction(JSON.parse(body).rawtx)
                    Cache.saveTX(tx)
                    resolve(tx)
                } catch (err) {
                    log(`获取TX时发生错误 Error acquring TX ${txid}`, logLevel.INFO)
                    log(body, logLevel.INFO)
                    reject(err)
                }
            })
            */
    }
  }).catch(err => {
    log(`Return empty result because ${err}`, logLevel.VERBOSE)
    return null
  })
}

/*
    Extract B/Bcat data from transaction(s)
*/
async function getData (tx) {
  var dataout = tx.outputs.filter(out => out.script.isDataOut())
  if (dataout.length === 0) throw new Error('Not Data TX')
  var bufs = dataout[0].script.chunks.map(chunk => (chunk.buf) ? chunk.buf : Buffer.alloc(0))
  if (bufs[1].toString() === '19HxigV4QyBv3tHpQVcUEQyq1pzZVdoAut') return bufs[2]
  else {
    // 处理Bcat
    var bParts = bufs.slice(7).map(buf => buf.toString('hex'))
    log('处理Bcat中。。。' + bParts, logLevel.VERBOSE)
    var bPartTXs = await Promise.all(bParts.map(bPart => getTX(bPart)))
    log(bPartTXs.map(tx => tx.id), logLevel.VERBOSE)
    var bPartBufs = bPartTXs.map(tx => tx.outputs.filter(out => out.script.isDataOut())[0].script.chunks[2].buf)
    log(bPartBufs.map(buf => buf.length), logLevel.VERBOSE)
    var buf = Buffer.concat(bPartBufs)
    log(buf.length, logLevel.VERBOSE)
    return buf
  }
}

/*
    Directory handler.

    TODO: index page
*/
function readDir (file, dirHandle) {
  if (!fs.statSync(file).isDirectory()) return {}
  log(' - Generating folder file', logLevel.VERBOSE)
  switch (dirHandle) {
    case 'html':
      return {
        buf: Buffer.from('<head><meta http-equiv="refresh" content="0;url=index.html"></head>'),
        mime: 'text/html'
      }
    case 'dir':
      // 创建目录浏览
      var files = fs.readdirSync(file).map(item => (fs.statSync(file + '/' + item).isDirectory()) ? item + '/' : item)
      return {
        buf: Buffer.from(`<head></head><body><script language="javascript" type="text/javascript">var files = ${JSON.stringify(files)};document.write("<p><a href='../'>..</a></p>");files.forEach(file=>document.write("<p><a href='" + file + "'>" + file + "</a></p>"));</script></body>`),
        mime: 'text/html'
      }
    default:
      return {}
  }
}

/*
    Read file buffer and mime type
*/
function readFile (file, dirHandle) {
  if (fs.statSync(file).isDirectory()) {
    return readDir(file, dirHandle)
  } else {
    var buf = fs.readFileSync(file)
    var mime = MIME.lookup(file)
    return {
      buf: buf,
      mime: mime
    }
  }
}

function readFiles (path) {
  path = path || '.'
  return fs.readdirSync(path).map(item => {
    if (item === '.bsv') return []
    var itemPath = path + '/' + item
    return (fs.statSync(itemPath).isDirectory()) ? readFiles(itemPath).concat([itemPath + '/']) : [itemPath]
  }).reduce((res, item) => res.concat(item), [])
}

function isDirectory (path) {
  return fs.statSync(path).isDirectory()
}

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
