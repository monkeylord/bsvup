/*
var bitindex = require('bitindex-sdk').instance({
  api_key: '4ZiBSwCzjgkCzDbX9vVV2TGqe951CBrwZytbbWiGqDuzkDETEkLJ9DDXuNMLsr8Bpj'
})
*/
const mattercloud = require('mattercloudjs').instance({
  api_key: '4ZiBSwCzjgkCzDbX9vVV2TGqe951CBrwZytbbWiGqDuzkDETEkLJ9DDXuNMLsr8Bpj'
})
const axios = require('axios')
const log = require('./log.js')

/*
    Get UTXOs from insight API
*/
async function get_utxos (address) {
  const utxos = await mattercloud.getUtxos([address])
  if (utxos.code) {
    log.log(`Error code ${utxos.code}: ${utxos.message}`, log.level.ERROR)
    throw utxos
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
  try {
    return mattercloud.sendRawTx(tx.toString()).then(async r => {
      if (r.result) {
        r = r.result
      }
      if (r.message && r.message.message) {
        throw r
      }
      if (!r.txid) {
        // 2020-02-04: this appears to indicate mattercloud rate limiting
        log.log('maybe rate limiting? ', r, log.level.INFO)
        log.log('Waiting 60s ...', log.level.INFO)
        return new Promise(resolve => setTimeout(resolve, 60000))
          .then(() => broadcastInsight(tx))
      }
      return r.txid
    }).catch(async err => {
      let code
      if (err.message && err.message.message) {
        err.message = err.message.message
      }
      if ((err.code == 500 || err.code == 422) && err.message.toUpperCase().indexOf('TRANSACTION ALREADY IN THE MEMPOOL') !== -1) {
        log.log(` Mattercloud reports already in mempool: ${tx.id}`, log.level.INFO)
        return tx.id
      }
      code = err.code
      err = err.message.split('\n').slice(0, 3).join('\n')
      log.log(' MatterCloud API return Errors: ' + code, log.level.INFO)
      log.log(err, log.level.INFO)
      throw [tx.id, 'MatterCloud API return Errors: ' + err]
    })
  } catch (errors) {
    if (errors[0] != tx.id || !errors[1]) {
      throw Error(errors)
    }
    log.log(errors[1].split('\n')[0], log.level.INFO)
    log.log(errors[1].split('\n')[2], log.level.INFO)
    throw Error(errors[1])
  }
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
