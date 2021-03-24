// previously seen transactions are ignored when 'tx' is received.  notably rejected transactions.
// the validation queue has a size limit, and transactions are ignored if this is reached
// the mempool has a size limit (default 1000 MB), and transactions appear ignored if this is reached.  this likely empties when a new block happens.
// the validation queue has a time limit, too.  10 seconds for a single run, 100ms frequency.  expiring this moves lower priority transactions to a different queue.
    // this expiration should send a rejection,  I believe.  there are a lot of rejections, including too-long-mempool-chain, which might have to do with spending from the mempool
    // some of these rejections might be wrong. 
// default max memory usage for transaction queues is 2GB.

// polyfill to use bsv-legacy as bitcore-lib for bitcore-spv
const bsv = require('bsv')
bsv.util.buffer = {
    reverse: buffer => Buffer.from(buffer).reverse()
}
const bitcorespv = require('bitcore-spv')
const bitcorep2p = require('bitcore-p2p')

const fs = require('fs')
const path = require('path')

const chainfilename = path.resolve('.bsv', 'chain.js')

var _client = null
const _txs = {}

async function client ()
{
  if (_client === null) {
    _client = new bitcorespv.Pool({ relay: false })
    _client.connect()
    _client.pool.maxSize = 128
    if (fs.existsSync(chainfilename)) {
      _client.chain.fromObject(require(chainfilename))
    } else {
      _client.chain.fromObject({
        version: 1,
        type: 'chain',
        hashes: [],
        ts: [],
        heights: []
      })
    }
    _client.on('chain-progress', function(progress) {
      var height = _client.chain.index.lastHeight
      console.log('syncProgress:', progress, 'height:', height, 'estimatedHeight', _client.chain.estimatedBlockHeight())
    
      fs.writeFileSync(chainfilename + '.new', 'module.exports = ' + JSON.stringify(_client.chain.toJSON(), null, 2) + '\n')
      fs.renameSync(chainfilename + '.new', chainfilename)
    })
    _client.on('peer-ready', function(peer) {
      peer.sendMessage(new peer.messages.GetAddr())
      peer.sendMessage(new peer.messages.MemPool())
      if (_txs.length) {
        inventory = Object.keys(_txs).map(txid => bitcorep2p.Inventory.forTransaction(txid))
        peer.sendMessage(new peer.messages.Inventory(inventory))
      }
    })
    _client.pool.on('peerinv', function(peer, message) {
      for (const item of message.inventory) {
        if (item.type !== bitcorep2p.Inventory.TYPE.TX) { continue; }
        const txid = item.hash.reverse().toString('hex')
        if (txid in _txs) {
          console.log(peer.host + ' has ' + txid)
        //} else {
        //  console.log('unk tx ' + peer.host + ' ' + txid)
        }
      }
    })
    _client.pool.on('peergetdata', function(peer, message) {
      for (const item of message.inventory) {
        if (item.type !== bitcorep2p.Inventory.TYPE.TX) { continue; }
        const txid = item.hash.reverse().toString('hex')
        if (txid in _txs) {
          console.log('Sending ' + txid + ' to ' + peer.host)
          peer.sendMessage(new peer.messages.Transaction(_txs[txid]))
          if (_txs[txid]._bsvup) {
            _txs[txid]._bsvup.count ++
            if (_txs[txid]._bsvup.count > 3) {
              _txs[txid]._bsvup.resolve(txid)
              _txs[txid]._bsvup = null
            }
          }
        }
      }
    })
    _client.pool.on('peerreject', function(peer, message) {
      const id = message.data.reverse().toString('hex')
      if (id in _txs && _txs[id]._bsvup) {
        // TODO: if it is something silly, like mempool full or fee too low, don't reject, just find more peers.  and if it's a good reason, don't disconnect but do delete the transaction
        _txs[id]._bsvup.reject(message.reason)
        _txs[id]._bsvup = null
        // delete _txs[id]
      } else {
        console.log(peer.host + ' also rejected ' + id)
      }
      peer.disconnect()
    })
    _client.pool.on('peererror', function(peer, message) {
      // errors are like 'connection refused'
      console.log('peer error ' + peer.host + ' ' + JSON.stringify(message))
    })
    await new Promise((resolve, reject) => _client.once('chain-progress', resolve))
  }
  return _client
}

function disconnect()
{
  if (_client !== null) {
    _client.disconnect()
    _client = null
  }
}

async function reconnect_client()
{
  disconnect()
  return client()
}

async function broadcast(txhex)
{
  const spv = await client()
  tx = bsv.Transaction(txhex)  
  console.log(tx.id)
  _txs[tx.id] = tx
  for (const peer of spv.peers.connected) {
    if (peer.status !== 'ready') { continue; }
    peer.sendMessage(new peer.messages.Inventory.forTransaction(tx.id))
    console.log('Unsolicited sending ' + tx.id + ' to ' + peer.host)
    peer.sendMessage(new peer.messages.Transaction(tx))
  }
  const try_harder = setInterval(() => {
    spv.pool.maxSize ++
    spv.disconnect()
    spv.connect()
    //if (spv.peers.connected.length == spv.pool.maxSize) {
    //  spv.peers.connected[0].disconnect()
    //}
    //spv.pool.connect()
    //console.log(spv.peers.connected.length)
  }, 10000)
  const result = await new Promise((resolve, reject) => tx._bsvup = { resolve: resolve, reject: reject, count: 0 })
  clearInterval(try_harder)
  return result
}

module.exports = {
  client: client,
  broadcast: broadcast
}
