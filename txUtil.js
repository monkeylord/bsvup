/*
    This module handle handle transactions
    - UTXO split
    - Transaction verification
    - Retrieve UTXO from transaction
    - Build BitCom output
        - B/Bcat/BcatPart
        - D
*/
const bsv = require('bsv')
const API = require('./api.js')

const CHUNK_SIZE = 64000
const FEE_PER_KB = 1536
const BASE_BPART_SIZE = 250
const BASE_B_SIZE = 300
const DUST_LIMIT = 546
const BASE_D_SIZE = 500
const BASE_MAP_SIZE = 1000
const TX_SIZE_MAX = 1000000

/*
    Check if transaction valid on basic concensus
    - Output Amount > Input Amount
    - Enough Fees (TODO)
    - Fully Signed
    - TX Size < 1MB
    - Output Script < 99KB (TODO)
    - Non-dust (TODO)

    Input
    - (bsv.Transaction) Transaction

    Output
    - (boolean) is Transaction valid
*/
function verifyTX (tx) {
  API.log(`Verifying ${tx.id}`, API.logLevel.VERBOSE)
  if (tx.inputAmount - tx.outputAmount < tx.toString().length / 2) {
    API.log(JSON.stringify(tx), API.logLevel.VERBOSE)
    throw new Error(`${tx.id}: Insuffient Satoshis`)
  } else if (!tx.isFullySigned()) throw new Error(`${tx.id}: Not fully signed`)
  else if (tx.toString().length > TX_SIZE_MAX) throw new Error(`${tx.id} Oversized`)
  else return true
}

/*
    Depleted!

    Split original UTXOs into target UTXOs.
    This procedure create MAP transaction that take original UTXOs as inputs, and target UTXOs as outputs.

    Input
    - (Object Array) Target UTXOs
        Example: [{key: "String Or Object", satoshis: 1000}]
    - (UTXO Array) Original UTXOs
    - (BSV PrivateKey) PrivateKey for UTXOs

    Output
    - (BSV Transaction) Map TX
    - (UTXO with target key Array) UTXOs
*/
function prepareUtxos (targetUtxos, originalUtxos, privKey) {
  // 先不进行优化了，以后再说
  var tx = bsv.Transaction()
  originalUtxos.forEach(outxo => tx.from(outxo))
  var utxos = targetUtxos.map(tutxo => {
    tx.to(privKey.toAddress(), tutxo.satoshis)
    return {
      key: tutxo.key,
      tx: tx,
      vout: tx.outputs.length - 1,
      address: tx.outputs[tx.outputs.length - 1].script.toAddress().toString(),
      script: tx.outputs[tx.outputs.length - 1].script.toHex(),
      satoshis: tx.outputs[tx.outputs.length - 1].satoshis
    }
  })
  if (tx.inputAmount - tx.outputAmount < 0) throw new Error('Insuffient satoshis.')
  if (tx.inputAmount - tx.outputAmount - tx.toString().length / 2 > 1000) {
    tx.change(privKey.toAddress())
    tx.feePerKb(FEE_PER_KB)
  }
  tx.sign(privKey)
  utxos.forEach(utxo => utxo.txid = utxo.tx.id)
  return {
    maptxs: [tx],
    utxos: utxos
  }
}

/*
    Retrieve UTXO in transaction
*/

function retrieveUTXO (transaction, vout) {
  var tx = bsv.Transaction(transaction)
  return {
    txid: tx.id,
    vout: vout,
    address: tx.outputs[vout].script.toAddress().toString(),
    script: tx.outputs[vout].script.toHex(),
    satoshis: tx.outputs[vout].satoshis
  }
}

function buildDTX (utxo, key, value, privKey) {
  API.log(key, API.logLevel.VERBOSE)
  var tx = bsv.Transaction()
  tx.from(utxo)
  tx.addOutput(buildDOut({
    key: key,
    value: value,
    type: 'b',
    sequence: new Date().getTime().toString()
  }))
  tx.sign(privKey)
  return tx
}

function buildDOut (dPayload) {
  var dScript = bsv.Script.buildSafeDataOut([
    '19iG3WTYSsbyos3uJ733yK4zEioi1FesNU',
    encodeURI(dPayload.key),
    dPayload.value,
    dPayload.type,
    dPayload.sequence
  ])
  return bsv.Transaction.Output({
    satoshis: 0,
    script: dScript.toHex()
  })
}

function buildBCatOut (bcatPayload) {
  var dScript = bsv.Script.buildSafeDataOut([
    '15DHFxWZJT58f9nhyGnsRBqrgwK4W6h4Up',
    bcatPayload.info,
    bcatPayload.mime,
    bcatPayload.encoding,
    bcatPayload.filename,
    bcatPayload.flag
  ].concat(bcatPayload.chunks.map(txid => Buffer.from(txid, 'hex'))))
  return bsv.Transaction.Output({
    satoshis: 0,
    script: dScript.toHex()
  })
}

function buildBCatPartOut (bcatPartPayload) {
  var bcatPartScript = bsv.Script.buildSafeDataOut([
    '1ChDHzdd1H4wSjgGMHyndZm6qxEDGjqpJL',
    bcatPartPayload.data
  ])
  return bsv.Transaction.Output({
    satoshis: 0,
    script: bcatPartScript.toHex()
  })
}

function buildBOut (bPayload) {
  var bScript = bsv.Script.buildSafeDataOut([
    '19HxigV4QyBv3tHpQVcUEQyq1pzZVdoAut',
    bPayload.data,
    bPayload.mime,
    bPayload.encoding,
    bPayload.filename
  ])
  return bsv.Transaction.Output({
    satoshis: 0,
    script: bScript.toHex()
  })
}

var testPrivateKey = '5JZ4RXH4MoXpaUQMcJHo8DxhZtkf5U5VnYd9zZH8BRKZuAbxZEw'
var testUtxo = {
  txid: '8d29c20fd086ad5aa859037eb9bb25aaf6ebb84706965c4c662bbdb40e9cba02',
  vout: 0,
  address: '1A2JN4JAUoKCQ5kA4pHhu4qCqma8jZSU81',
  script: '76a91462f80abdd278a255e40c1a1f8dd89555de19a07688ac',
  satoshis: 10000000
}

var testBPayload = {
  'data': Buffer.from('Some buffer payload'),
  'mime': 'text/plain',
  'encoding': 'utf-8',
  'filename': 'demo.txt'
}

var testBCatPayload = {
  'info': 'some index',
  'mime': 'text/plain',
  'encoding': 'utf-8',
  'filename': 'demo.txt',
  'flag': 'none',
  'chunks': ['8d29c20fd086ad5aa859037eb9bb25aaf6ebb84706965c4c662bbdb40e9cba02',
    '8d29c20fd086ad5aa859037eb9bb25aaf6ebb84706965c4c662bbdb40e9cba02']
}

var testDPayload = {
  'key': 'BDO_Craig_Wright_TrueCrypt_Analysis_Redacted.pdf',
  'value': '314ff3bab84fd688679857e0c007843d579fe658c6aa66fbb0731bdf6f312532',
  'type': 'b',
  'sequence': new Date().getTime().toString()
}

var privkeySigner = function (privKey) {
  if (!(privKey instanceof bsv.PrivateKey)) throw new Error('Support BSV PrivateKey only')
  return async function (tx) {
    var signedTX = tx.sign(privKey)
    if (!signedTX.isFullySigned()) throw new Error('Not successful signed, privkey and utxos may be unmatched')
    return signedTX
  }
}

module.exports = {
  verifyTX: verifyTX,
  buildBOut: buildBOut,
  buildBCatOut: buildBCatOut,
  buildBCatPartOut: buildBCatPartOut,
  buildDOut: buildDOut,
  buildDTX: buildDTX,
  prepareUtxos: prepareUtxos,
  retrieveUTXO: retrieveUTXO,
  privkeySigner: privkeySigner,
  testData: {
    testPrivateKey: testPrivateKey,
    testUtxo: testUtxo,
    testBPayload: testBPayload,
    testBCatPayload: testBCatPayload,
    testDPayload: testDPayload
  },
  parameters: {
    CHUNK_SIZE: CHUNK_SIZE,
    FEE_PER_KB: FEE_PER_KB,
    BASE_BPART_SIZE: BASE_BPART_SIZE,
    BASE_B_SIZE: BASE_B_SIZE,
    DUST_LIMIT: DUST_LIMIT,
    BASE_D_SIZE: BASE_D_SIZE,
    BASE_MAP_SIZE: BASE_MAP_SIZE,
    TX_SIZE_MAX: TX_SIZE_MAX
  }
}
