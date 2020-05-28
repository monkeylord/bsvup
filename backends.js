/*
    This module handles calling out to other backends.
    - query information
    - download transactions
    - broadcast transactions
*/

var mattercloud = require('mattercloudjs').instance({
  api_key: '4ZiBSwCzjgkCzDbX9vVV2TGqe951CBrwZytbbWiGqDuzkDETEkLJ9DDXuNMLsr8Bpj'
})
var axios = require('axios')

async function get_bitquery (query)
{
  // TODO STUB: abstract bitdb or bitbus
}

async function get_rawtx (identifier)
{
  // TODO STUB: return transaction from mattercloud or whatsonchain or anything
}

async function get_utxos (address)
{
  // TODO STUB: return transactions, coins spendable by address
}

async function broadcast (transaction)
{
  // TODO STUB: broadcast transaction to network, return identifier of result
}

module.exports = {
  get_bitquery: get_bitquery,
  get_rawtx: get_rawtx,
  get_utxos: get_utxos,
  broadcast: broadcast
}
