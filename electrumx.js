const electrum = require('@codewarriorr/electrum-client-js')
const bsv = require('bsv')

var _client = null;

var _servers = [
  ['sv.usebsv.com', 50002],
  ['electrum.privateservers.network', 50011],
  ['sv2.satoshi.io', 50002],
  ['sv.satoshi.io', 50002],
  ['satoshi.vision.cash', 50002]
];

async function client ()
{
  if (_client === null) {
    server = _servers[Math.floor(Math.random() * _servers.length)]
    const c = new electrum(server[0], server[1], 'ssl')
    _client = c
  }
  await _client.connect()
  return _client
}

function address2script(address)
{
  return bsv.Script.buildPublicKeyHashOut(address).toBuffer()
}

function script2scripthash(script)
{
  return bsv.crypto.Hash.sha256(script).reverse().toString('hex')
}

async function get_rawtx (identifier)
{
  const electrum = await client()
  return await electrum.blockchain_transaction_get(identifier, false)
}

async function get_utxos (address)
{
  const electrum = await client()
  const script = address2script(address)
  const scripthash = script2scripthash(script)
  const scripthex = script.toString('hex')
  let results = await electrum.blockchain_scripthash_listunspent(scripthash)
  if (results == null) {
    return []
  }
  results = results.map(result => ({
    address: address,
    txid: result.tx_hash,
    vout: result.tx_pos,
    amount: result.value / 100000.0,
    satoshis: result.value,
    value: result.value,
    height: result.height,
    scriptPubKey: scripthex,
    script: scripthex,
    outputIndex: result.tx_pos
  }))
  return results
}

async function get_history (address)
{
  const electrum = await client()
  const scripthash = script2scripthash(address2script(address))
  const txs = await electrum.blockchain_scripthash_getHistory(scripthash)
  return txs.map(tx => tx.tx_hash)
}

async function broadcast (transaction)
{
  console.log('electrumx broadcast ' + transaction)
  const electrum = await client()
  try {
    result = await electrum.blockchain_transaction_broadcast(transaction)
  } catch(e) {
    console.log('failed to broadcast ' + e)
    console.log(e.stack)
    throw e
  }
  console.log('result: ' + result)
  return result[0].hash
}

async function findTx (id)
{
  const electrum = await client()
  try {
    const tx = await electrum.blockchain_transaction_get(id, true)
    return [{
      tx: {h:tx.hash},
      blk: {h:tx.blockhash}
    }]
  } catch(e) {
    if (e.indexOf("'code': -5") !== -1) {
      return []
    }
    throw e
  }
}

module.exports = {
  client: client,
  get_rawtx: get_rawtx,
  get_utxos: get_utxos,
  get_history: get_history,
  broadcast: broadcast,
  findTx: findTx,
}
