/*
    This module handle details and APIs
    - acquire file/directory data
    - acquire blockchain data
    - broadcast to blockchain

    This should cover the difference between Node/Browser.
    TODO: Browser implements
*/
const explorer = require('bitcore-explorers')
const insight = new explorer.Insight('https://api.bitindex.network')
const bsv = require('bsv')
const fs = require('fs')
const BitDB = require('./bitdb.js')
const MimeLookup = require('mime-lookup');
const MIME = new MimeLookup(require('mime-db'))
const crypto = require("crypto")
const Cache = require("./cache.js")

/*
    Handling transfer
*/
async function transfer(address, key){
    var utxos = await getUTXOs(key.toAddress().toString())
    // 开始构造转账TX
    var tx = bsv.Transaction()
    utxos.forEach(utxo=>tx.from(utxo))
    tx.change(address)
    tx.feePerKb(1536)
    tx.sign(key)
    console.log(`转账TXID Transfer TXID: ${tx.id}`)
    await broadcast_insight(tx.toString(), true)
}

/*
    Get UTXOs from insight API
*/
async function getUTXOs(address){
    return new Promise((resolve, reject)=>{
        insight.getUnspentUtxos(address,(err,unspents)=>{
            if(err){
                reject("Insight API return Errors: " + err)
            } else {
                utxos = unspents
                resolve(unspents)
            }
        })
    })
}

/*
    Broadcast transaction though insight API
*/
async function broadcast_insight(tx){
    return new Promise((resolve, reject)=>{
        insight.broadcast(tx.toString(),(err,res)=>{
            if(err){
                if(err.message && err.message.message)err=err.message.message
                console.log(" Insight API return Errors: ")
                console.log(err)
                reject([tx.id,"Insight API return Errors: " + err])
            }else{
                resolve(res)
            }
        })
    })
    
}

/*
    Wrapped broadcast transaction, push unbroadcast transaction into unbroadcast array provided.
*/
async function broadcast(tx, unBroadcast){
    try {
      const res = await broadcast_insight(tx)
      Cache.saveTX(tx)
      console.log(`Broadcasted ${res}`)
      return res
    } catch(e) {
      if(unBroadcast && Array.isArray(unBroadcast))unBroadcast.push(tx)
      throw e
    }
}

/*
    Try broadcast all transactions given.
    If TXs is null, load transactions from cache.
*/
async function tryBroadcastAll(TXs){
    var toBroadcast = TXs? TXs : Cache.loadUnbroadcast()
    var unBroadcast = []
    for (let tx of toBroadcast) {
      try {
        await broadcast(tx, unBroadcast)
      } catch([txid,err]) {
        console.log(`${txid} 广播失败，原因 fail to broadcast:`)
        console.log(err.split("\n")[0])
        console.log(err.split("\n")[2])
      }
    }
    return Cache.saveUnbroadcast(unBroadcast)
}

/*
    Find exist bsvup B/Bcat record on blockchain.
    We use sha1 as file name.
*/
async function findExist(buf, mime) {
    var sha1 = crypto.createHash('sha1').update(buf).digest('hex')
    if (global.verbose) console.log(sha1)
    if (global.quick) return null
    var records = Cache.loadFileRecord(sha1)
    if (!Array.isArray(records) || records.length == 0) {
        if (global.verbose) console.log(" - 向BitDB搜索已存在的文件记录 Querying BitDB")
        records = await BitDB.findExist(buf)
        records = records.filter(record => record.contenttype == mime)
    }
    if (records.length == 0) return null
    var txs = await Promise.all(records.map(record => getTX(record.txid)))
    var matchTX = await Promise.race(txs.map(tx => {
        return new Promise(async (resolve, reject) => {
            var databuf = await getData(tx).catch(err => new Buffer(0))
            if (databuf.equals(buf)) resolve(tx)
            else reject()
        })
    })).catch(err => null)
    if (matchTX){
        Cache.saveFileRecord(sha1, records)
        return matchTX
    }
    else {
        return null
    }
}

/*
    BitDB queries are expensive at time
    We should do a all in one query
*/
var dRecords = null
async function findD(key, address, value) {
    if (global.quick) return null
    //var dRecords = await BitDB.findD(key, address)
    if (!dRecords) {
        if(global.verbose) console.log(`查询${address}下所有D记录中...`)
        if(global.verbose) console.log(`Query all D records on ${address} from BitDB...`)
        dRecords = await BitDB.findD(null, address)
    }
    var keyDRecords = dRecords.filter(record => record.key == key)
    var dRecord = (keyDRecords.length > 0) ? keyDRecords[0] : null
    if (dRecord && dRecord.value == value) return true
    else return false
}

async function getTX(txid) {
    return new Promise((resolve, reject) => {
        var tx = Cache.loadTX(txid)
        if (tx) {
            resolve(tx)
        } else {
            insight.requestGet(`/api/tx/${txid}`, (err, res, body) => {
                if (err || res.statusCode !== 200) reject(err || body)
                //console.log(body)
                try {
                    tx = bsv.Transaction(JSON.parse(body).rawtx)
                    Cache.saveTX(tx)
                    resolve(tx)
                } catch (err) {
                    console.log(`获取TX时发生错误 Error acquring TX ${txid}`)
                    console.log(body)
                    reject(err)
                }
            })
        }
    }).catch(err => null)
}

/*
    Extract B/Bcat data from transaction(s)
*/
async function getData(tx) {
    var dataout = tx.outputs.filter(out => out.script.isDataOut())
    if (dataout.length == 0) throw new Error("Not Data TX")
    var bufs = dataout[0].script.chunks.map(chunk => (chunk.buf) ? chunk.buf : new Buffer(0))
    if (bufs[1].toString() == "19HxigV4QyBv3tHpQVcUEQyq1pzZVdoAut") return bufs[2]
    else {
        // 处理Bcat
        var bParts = bufs.slice(7).map(buf => buf.toString('hex'))
        if (global.verbose) console.log("处理Bcat中。。。" + bParts)
        var bPartTXs = await Promise.all(bParts.map(bPart => getTX(bPart)))
        if (global.verbose) console.log(bPartTXs.map(tx => tx.id))
        var bPartBufs = bPartTXs.map(tx => tx.outputs.filter(out => out.script.isDataOut())[0].script.chunks[2].buf)
        if (global.verbose) console.log(bPartBufs.map(buf => buf.length))
        var buf = Buffer.concat(bPartBufs)
        if (global.verbose) console.log(buf.length)
        return buf
    }
}

/*
    Directory handler.
    
    TODO: index page
*/
function readDir(file, dirHandle){
    if (!fs.statSync(file).isDirectory()) return {}
    if (global.verbose) console.log(" - Generating folder file")
    switch (dirHandle) {
        case "html":
            return {
                buf: Buffer.from('<head><meta http-equiv="refresh" content="0;url=index.html"></head>'),
                mime: "text/html"
            }
        case "dir":
            // 创建目录浏览
            var files = fs.readdirSync(file).map(item => (fs.statSync(file + "/" + item).isDirectory()) ? item + "/" : item)
            return {
                buf: Buffer.from(`<head></head><body><script language="javascript" type="text/javascript">var files = ${JSON.stringify(files)};document.write("<p><a href='../'>..</a></p>");files.forEach(file=>document.write("<p><a href='" + file + "'>" + file + "</a></p>"));</script></body>`),
                mime: "text/html"
            }
        default:
            return {}
    }
}

/*
    Read file buffer and mime type
*/
function readFile(file, dirHandle) {
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

function readFiles(path) {
    path = path || "."
    return fs.readdirSync(path).map(item => {
        if (item == ".bsv") return []
        var itemPath = path + "/" + item
        return (fs.statSync(itemPath).isDirectory()) ? readFiles(itemPath).concat([itemPath + "/"]) : [itemPath]
    }).reduce((res, item) => res.concat(item), [])
}

function isDirectory(path){
    return fs.statSync(path).isDirectory()
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
    isDirectory: isDirectory
}
