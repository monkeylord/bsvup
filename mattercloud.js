/*
var bitindex = require('bitindex-sdk').instance({
  api_key: '4ZiBSwCzjgkCzDbX9vVV2TGqe951CBrwZytbbWiGqDuzkDETEkLJ9DDXuNMLsr8Bpj'
})
*/
var mattercloud = require('mattercloudjs').instance({
  api_key: '4ZiBSwCzjgkCzDbX9vVV2TGqe951CBrwZytbbWiGqDuzkDETEkLJ9DDXuNMLsr8Bpj'
})
var axios = require('axios')

/*
    Get UTXOs from insight API
*/
async function get_utxos (address) {
  const utxos = await mattercloud.getUtxos([address])
  if (utxos.code) {
    console.log(`Error code ${utxos.code}: ${utxos.message}`)
  }
  return utxos
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
  return mattercloud.sendRawTx(tx.toString()).then(async r => {
    if (r.message && r.message.message) {
      throw r
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
    let code
    if (err.message && err.message.message) {
      err.message = err.message.message
    }
    if (err.code == 500 && err.message.indexOf('Transaction already in the mempool') !== -1) {
      console.log(` Mattercloud reports already in mempool: ${tx.id}`)
      return tx.id
    }
    code = err.code
    err = err.message.split('\n').slice(0, 3).join('\n')
    console.log(' MatterCloud API return Errors: ' + code)
    console.log(err)
    throw [tx.id, 'MatterCloud API return Errors: ' + err]
  })
}

async function get_rawtx (txid) {
  // Access mattercloud with Insight API
  //mattercloud.getTx(txid).then(res => {
  const res = await axios.get(`https://api.mattercloud.net/api/rawtx/${txid}`)
  return res.data.rawtx
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

module.exports = {
  get_utxos: get_utxos,
  broadcast: broadcastInsight,
  get_rawtx: get_rawtx
}
