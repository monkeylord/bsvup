const explorer = require('bitcore-explorers')
const Insight = explorer.Insight
const insight = new explorer.Insight('https://api.bitindex.network')
const bsv = require('bsv')
const fs = require('fs')
const BitDB = require('./bitdb.js')
const MimeLookup = require('mime-lookup');
const MIME = new MimeLookup(require('mime-db'))
const crypto = require("crypto")
const logic = require("./logic.js")

function init(){
    if(!fs.existsSync("./.bsv")){
        fs.mkdirSync("./.bsv")
    }
    // 初始化objects结构
    if(!fs.existsSync("./.bsv/objects")){
        fs.mkdirSync("./.bsv/objects")
    }
    // 初始化D镜像目录
    if(!fs.existsSync("./.bsv/tx")){
        fs.mkdirSync("./.bsv/tx")
    }
    // 初始化D树文件
    if(!fs.existsSync("./.bsv/info")){
        fs.mkdirSync("./.bsv/info")
    }
}

function loadKey(password){
    var buf = fs.readFileSync("./.bsv/key").toString()
    var decBuf = decrypt(buf, password)
    return bsv.PrivateKey(decBuf.toString())
}
function saveKey(privkey, password){
    var buf = Buffer.from(privkey.toString())
    var encBuf = encrypt(buf, password)
    fs.writeFileSync("./.bsv/key", encBuf)
}

function encrypt(plaintext, password){
    var cipher = crypto.createCipher('aes-128-ecb',password)
    return cipher.update(plaintext,'utf8','hex') + cipher.final('hex')
}
function decrypt(ciphertext, password){
    var cipher = crypto.createDecipher('aes-128-ecb',password)
    return cipher.update(ciphertext,'hex','utf8') + cipher.final('utf8')
}

async function transfer(address, privkey){
    var utxos = await api.getUTXOs(key.toAddress().toString())
    // 开始构造转账TX
    var tx = bsv.Transaction()
    utxos.forEach(utxo=>tx.from(utxo))
    tx.change(address)
    tx.feePerKb(1536)
    tx.sign(key)
    console.log(`转账TXID Transfer TXID: ${tx.id}`)
    await broadcast(tx.toString(), true)
}

async function getUTXOs(address){
    return new Promise((resolve, reject)=>{
        insight.getUnspentUtxos(address,(err,unspents)=>{
            if(err){
                reject("Insight API return Errors: " + err)
            }else{
                utxos = unspents
                resolve(unspents)
            }
        })
    })
}

async function broadcast(tx, nosave = false){
    return new Promise((resolve, reject)=>{
        insight.broadcast(tx.toString(),(err,res)=>{
            if(err){
                if (!nosave) unBroadcast.push(tx)
                if(err.message && err.message.message)err=err.message.message
                console.log(" Insight API return Errors: ")
                console.log(err)
                reject([tx.id,"Insight API return Errors: " + err])
            }else{
                if (!nosave) fs.writeFileSync(`./.bsv/tx/${res}`, tx)
                console.log(`Broadcasted ${res}`)
                resolve(res)
            }
        })
    })
    
}

async function findExist(buf, mime){
    var sha1 = crypto.createHash('sha1').update(buf).digest('hex')
    if(global.debug)console.log(sha1)
    if(global.quick)return null
    var records = []
    if(fs.existsSync(`./.bsv/objects/${sha1}`))records = JSON.parse(fs.readFileSync(`./.bsv/objects/${sha1}`))
    if(!Array.isArray(records) || records.length==0){
        console.log(" - 向BitDB搜索已存在的文件记录 Querying BitDB")
        records = await BitDB.findExist(buf)
        records = records.filter(record=>record.contenttype==mime)
        fs.writeFileSync(`./.bsv/objects/${sha1}`, JSON.stringify(records))
    }
    if(records.length==0)return null
    var txs = await Promise.all(records.map(record => getTX(record.txid)))
    var matchTX = await Promise.race(txs.map(tx=>{
        return new Promise(async (resolve, reject)=>{
            var databuf = await getData(tx).catch(err=>new Buffer(0))
            if(databuf.equals(buf))resolve(tx)
            else reject()
        })
    })).catch(err=>null)
    if(matchTX)return matchTX
    else return null
}

var dRecords = null
async function findD(key, address ,value){
    if(global.quick)return null
    //var dRecords = await BitDB.findD(key, address)
    if(!dRecords){
        console.log(`查询${address}下所有D记录中...`)
        console.log(`Query all D records on ${address} from BitDB...`)
        dRecords = await BitDB.findD(null, address)
    }
    var keyDRecords = dRecords.filter(record=>record.key==key)
    var dRecord = (keyDRecords.length>0)?keyDRecords[0]:null
    if(dRecord && dRecord.value == value)return true
    else return false
}

async function getTX(txid){
    return new Promise((resolve, reject)=>{
        if(fs.existsSync(`./.bsv/tx/${txid}`)){
            var rawtx = fs.readFileSync(`./.bsv/tx/${txid}`).toString()
            resolve(bsv.Transaction(rawtx))
        } else{
            insight.requestGet(`/api/tx/${txid}`,(err, res, body)=>{
                if(err || res.statusCode !== 200) reject(err || body)
                //console.log(body)
                try{
                    var rawtx = JSON.parse(body).rawtx
                    fs.writeFileSync(`./.bsv/tx/${txid}`, rawtx)
                    resolve(bsv.Transaction(rawtx))
                }catch(err){
                    console.log("获取TX时发生错误 Error acquring TX")
                    console.log(body)
                    reject(err)
                }
            })
        }
    }).catch(err=>null)
}


async function getData(tx){
    var dataout = tx.outputs.filter(out=>out.script.isDataOut())
    if(dataout.length==0)throw new Error("Not Data TX")
    var bufs = dataout[0].script.chunks.map(chunk=>(chunk.buf)?chunk.buf:new Buffer(0))
    if(bufs[1].toString()=="19HxigV4QyBv3tHpQVcUEQyq1pzZVdoAut")return bufs[2]
    else{
        // 处理Bcat
        var bParts = bufs.slice(7).map(buf=>buf.toString('hex'))
        if(global.debug)console.log("处理Bcat中。。。" + bParts)
        var bPartTXs = await Promise.all(bParts.map(bPart=>getTX(bPart)))
        if(global.debug)console.log(bPartTXs.map(tx=>tx.id))
        var bPartBufs = bPartTXs.map(tx=>tx.outputs.filter(out=>out.script.isDataOut())[0].script.chunks[2].buf)
        if(global.debug)console.log(bPartBufs.map(buf=>buf.length))
        var buf = Buffer.concat(bPartBufs)
        if(global.debug)console.log(buf.length)
        return buf
    }
}

var unBroadcast = []
async function loadUnbroadcast(){
    unBroadcast = JSON.parse(fs.readFileSync("./.bsv/unbroadcasted.tx.json")).map(tx=>bsv.Transaction(tx))
    return unBroadcast.length
}

async function prepareUpload(path, key, type){
    var tasks = await logic.upload(path, key, type)

    // 准备上传
    unBroadcast = tasks.map(task=>task.tx)
    tasks.every(task=>{
        if(global.debug)console.log(`Verifying ${task.type} TX ${task.tx.id}`)
        return txutil.verifyTX(task.tx)
    })
    fs.writeFileSync("./.bsv/unbroadcasted.tx.json",JSON.stringify(unBroadcast))

    return tasks
}

async function tryBroadcastAll(){
    var toBroadcast = unBroadcast
    unBroadcast = []
    await toBroadcast.reduce((promise,tx,index)=>{
        return promise.then(p=>{
            
            return broadcast(tx.toString()).catch(([txid,err])=>{
                console.log(`${txid} 广播失败，原因 fail to broadcast:`)
                console.log(err.split("\n")[0])
                console.log(err.split("\n")[2])
            })
        })
    },
    new Promise(r=>r()))
    if(unBroadcast.length>0){
        fs.writeFileSync("./.bsv/unbroadcasted.tx.json", JSON.stringify(unBroadcast))
    }else{
        if(fs.existsSync("./.bsv/unbroadcasted.tx.json"))fs.unlinkSync("./.bsv/unbroadcasted.tx.json")
    }
    return unBroadcast.length
}

module.exports = {
    init: init,
    loadKey: loadKey,
    saveKey: saveKey,
    transfer: transfer,
    findD: findD,
    findExist: findExist,
    broadcast: broadcast,
    getUTXOs: getUTXOs,
    loadUnbroadcast: loadUnbroadcast,
    prepareUpload: prepareUpload,
    tryBroadcastAll: tryBroadcastAll
}
