const explorer = require('bitcore-explorers')
const Insight = explorer.Insight
const insight = new explorer.Insight('https://api.bitindex.network')
const bsv = require('bsv')
const fs = require('fs')
const BitDB = require('./bitdb.js')
const MimeLookup = require('mime-lookup');
const MIME = new MimeLookup(require('mime-db'))

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

async function broadcast(tx){
    return new Promise((resolve, reject)=>{
        insight.broadcast(tx.toString(),(err,res)=>{
            if(err){
                console.log(" Insight API return Errors: ")
                console.log(err)
                reject("Insight API return Errors: " + err)
            }else resolve(res)
        })
    })
}

async function findExist(file){
    if(global.quick)return null
    var buf = fs.readFileSync(file)
    var records = await BitDB.findExist(buf)
    if(records.length==0)return null
    records = records.filter(record=>record.contenttype==MIME.lookup(file))
    var txs = await Promise.all(records.map(record => getTX(record.txid)))
    var matchTX = await Promise.race(txs.map(tx=>{
        return new Promise(async (resolve, reject)=>{
            var databuf = await getData(tx)
            if(databuf.equals(buf))resolve(tx)
            else reject()
        })
    })).catch(err=>null)
    if(matchTX)return matchTX
    else return null
}
async function findD(key, address ,value){
    if(global.quick)return null
    var dRecord = await BitDB.findD(key, address)
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
                var rawtx = JSON.parse(body).rawtx
                fs.writeFileSync(`./.bsv/tx/${txid}`, rawtx)
                resolve(bsv.Transaction(rawtx))
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
        var bParts = bufs.slice(7).map(buf=>buf.toString('hex'))
        var bPartTXs = await Promise(bParts.map(bPart=>getTX(bPart)))
        var bPartBufs = bPartTXs.map(tx=>tx.outputs.filter(out=>out.script.isDataOut())[0].script.chunks[2].buf)
        return bPartBufs.reduce((buf,partBuf)=>buf.concat(partBuf),new Buffer(0))
    }
}

module.exports = {
    findD: findD,
    findExist: findExist,
    broadcast: broadcast,
    getUTXOs: getUTXOs
}