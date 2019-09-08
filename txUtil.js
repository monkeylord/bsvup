const bsv = require('bsv')
const ibe = require('bitcoin-ibe')
const MimeLookup = require('mime-lookup');
const MIME = new MimeLookup(require('mime-db'))
const fs = require("fs")
const crypto = require("crypto")

const CHUNK_SIZE = 64000
const FEE_PER_KB = 1536
const BASE_BPART_SIZE = 250
const BASE_B_SIZE = 300
const DUST_LIMIT = 546
const BASE_D_SIZE = 500
const BASE_MAP_SIZE = 1000
const TX_SIZE_MAX = 1000000

function verifyTX(tx) {
    if (global.debug) console.log(`Verifying ${tx.id}`)
    if (tx.inputAmount - tx.outputAmount < tx.toString().length / 2) {
        if (global.debug) console.log(JSON.stringify(tx))
        throw new Error(`${tx.id}: Insuffient Satoshis`)
    }
    else if (!tx.isFullySigned()) throw new Error(`${tx.id}: Not fully signed`)
    else if (tx.toString().length > TX_SIZE_MAX) throw new Error(`${tx.id} Oversized`)
    else return true
    return false
}


function prepareUtxos(target_utxos, original_utxos, privKey) {
    // 先不进行优化了，以后再说
    var tx = bsv.Transaction()
    original_utxos.forEach(outxo => tx.from(outxo))
    var utxos = target_utxos.map(tutxo => {
        tx.to(privKey.toAddress(), tutxo.satoshis)
        return {
            key: tutxo.key,
            tx: tx,
            vout: tx.outputs.length - 1,
            address: tx.outputs[tx.outputs.length - 1].script.toAddress().toString(),
            script: tx.outputs[tx.outputs.length - 1].script.toHex(),
            satoshis: tx.outputs[tx.outputs.length - 1].satoshis,
        }
    })
    if (tx.inputAmount - tx.outputAmount < 0) throw new Error("Insuffient satoshis.")
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

function retrieveUTXO(transaction, vout) {
    var tx = bsv.Transaction(transaction)
    return {
        txid: tx.id,
        vout: vout,
        address: tx.outputs[vout].script.toAddress().toString(),
        script: tx.outputs[vout].script.toHex(),
        satoshis: tx.outputs[vout].satoshis,
    }
}

function buildFileTX(utxo, filename, buffer, mime, privKey) {
    var md5 = crypto.createHash('md5').update(buffer).digest('hex')
    // prepare utxo for D TX
    var target_utxos = [{ key: "D", satoshis: DUST_LIMIT }]

    // prepare utxos and build TXs
    if (buffer.length > CHUNK_SIZE) {
        // should use BCAT

        // prepare chunks
        var bufferChunks = []
        while (buffer.length > 0) {
            bufferChunks.push(buffer.slice(0, CHUNK_SIZE))
            buffer = buffer.slice(CHUNK_SIZE)
        }
        // prepare utxos for B TXs
        var requires = [{ key: "bcat", satoshis: Math.max(BASE_B_SIZE + 50 * bufferChunks.length, DUST_LIMIT) }].concat(bufferChunks.map((bufferChunk, i) => {
            return { key: i, satoshis: Math.max(bufferChunk.length + BASE_BPART_SIZE, DUST_LIMIT) }
        }))

        // OK, split utxo now
        target_utxos = target_utxos.concat(requires)
        var { maptxs, utxos } = prepareUtxos(target_utxos, [utxo], privKey)

        var dUtxo = utxos[0]
        var bUtxos = utxos.slice(1)

        // Build BcatPart TXs
        var chunktxs = bUtxos.slice(1).map(utxo => {
            var tx = bsv.Transaction()
            tx.from(utxo)
            tx.addOutput(buildBCatPartOut({
                data: bufferChunks[utxo.key]
            }))
            tx.feePerKb(FEE_PER_KB)
            tx.change(privKey.toAddress())
            tx.sign(privKey)
            return tx
        })
        // Build Bcat TX
        var bcattx = bsv.Transaction()
        bcattx.from(bUtxos[0])
        bcattx.addOutput(buildBCatOut({
            info: "destine",
            mime: mime,
            encoding: "binary",
            filename: md5,
            flag: Buffer.from("00", "hex"),
            chunks: chunktxs.map(chunktx => chunktx.id)
        }))
        bcattx.sign(privKey)
        // Build D TX
        var dtx = buildDTX(dUtxo, filename, bcattx.id, privKey)
        // return all TX
        return {
            btx: bcattx,
            dtx: dtx,
            maptx: maptxs,
            chunks: chunktxs
        }
    } else {
        // should use B
        // prepare B UTXO
        var requires = [{ key: "b", satoshis: BASE_B_SIZE + buffer.length }]

        // OK, split utxo now
        target_utxos = target_utxos.concat(requires)
        var { maptxs, utxos } = prepareUtxos(target_utxos, [utxo], privKey)

        var dUtxo = utxos[0]
        var bUtxo = utxos[1]
        var tx = bsv.Transaction().from(bUtxo)
        tx.addOutput(buildBOut({
            data: buffer,
            mime: mime,
            encoding: "binary",
            filename: md5
        }))
        tx.feePerKb(FEE_PER_KB)
        tx.change(privKey.toAddress())
        tx.sign(privKey)
        // Build D TX
        var dtx = buildDTX(dUtxo, filename, tx.id, privKey)
        return {
            btx: tx,
            dtx: dtx,
            maptx: maptxs,
            chunks: []
        }
    }
}

function buildDTX(utxo, key, value, privKey) {
    if (global.debug) console.log(key)
    var tx = bsv.Transaction()
    tx.from(utxo)
    tx.addOutput(buildDOut({
        key: key,
        value: value,
        type: "b",
        sequence: new Date().getTime().toString()
    }))
    tx.sign(privKey)
    return tx
}

function buildDOut(dPayload) {
    var dScript = bsv.Script.buildDataOut([
        "19iG3WTYSsbyos3uJ733yK4zEioi1FesNU",
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

function buildBCatOut(bcatPayload) {
    var dScript = bsv.Script.buildDataOut([
        "15DHFxWZJT58f9nhyGnsRBqrgwK4W6h4Up",
        bcatPayload.info,
        bcatPayload.mime,
        bcatPayload.encoding,
        bcatPayload.filename,
        bcatPayload.flag
    ].concat(bcatPayload.chunks.map(txid => Buffer.from(txid, "hex"))))
    return bsv.Transaction.Output({
        satoshis: 0,
        script: dScript.toHex()
    })
}

function buildBCatPartOut(bcatPartPayload) {
    var bcatPartScript = bsv.Script.buildDataOut([
        "1ChDHzdd1H4wSjgGMHyndZm6qxEDGjqpJL",
        bcatPartPayload.data
    ])
    return bsv.Transaction.Output({
        satoshis: 0,
        script: bcatPartScript.toHex()
    })
}

function buildBOut(bPayload) {
    var bScript = bsv.Script.buildDataOut([
        "19HxigV4QyBv3tHpQVcUEQyq1pzZVdoAut",
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

var testPrivateKey = "5JZ4RXH4MoXpaUQMcJHo8DxhZtkf5U5VnYd9zZH8BRKZuAbxZEw"
var testUtxo = {
    txid: "8d29c20fd086ad5aa859037eb9bb25aaf6ebb84706965c4c662bbdb40e9cba02",
    vout: 0,
    address: "1A2JN4JAUoKCQ5kA4pHhu4qCqma8jZSU81",
    script: "76a91462f80abdd278a255e40c1a1f8dd89555de19a07688ac",
    satoshis: 10000000
}

var testBPayload = {
    "data": new Buffer("Some buffer payload"),
    "mime": "text/plain",
    "encoding": "utf-8",
    "filename": "demo.txt"
}

var testBCatPayload = {
    "info": "some index",
    "mime": "text/plain",
    "encoding": "utf-8",
    "filename": "demo.txt",
    "flag": "none",
    "chunks": ["8d29c20fd086ad5aa859037eb9bb25aaf6ebb84706965c4c662bbdb40e9cba02",
        "8d29c20fd086ad5aa859037eb9bb25aaf6ebb84706965c4c662bbdb40e9cba02"]
}

var testDPayload = {
    "key": "BDO_Craig_Wright_TrueCrypt_Analysis_Redacted.pdf",
    "value": "314ff3bab84fd688679857e0c007843d579fe658c6aa66fbb0731bdf6f312532",
    "type": "b",
    "sequence": new Date().getTime().toString()
}


module.exports = {
    verifyTX: verifyTX,
    buildBOut: buildBOut,
    buildBCatOut: buildBCatOut,
    buildBCatPartOut: buildBCatPartOut,
    buildDOut: buildDOut,
    buildFileTX: buildFileTX,
    buildDTX: buildDTX,
    prepareUtxos: prepareUtxos,
    retrieveUTXO: retrieveUTXO
}