// polyfill to use bsv-legacy as bitcore-lib for bitcore-spv
const bsv = require('bsv')
bsv.util.buffer = {
    reverse: buffer => Buffer.from(buffer).reverse()
}
const bitcorespv = require('bitcore-spv')

var _client = null

async function client ()
{
  if (_client === null) {
    const pool = new bitcorespv.Pool({ relay: false })
    pool.connect();
    pool.chain.fromObject({
      version: 1,
      type: 'chain',
      hashes: [],
      ts: [],
      heights: []
    })
    pool.on('chain-progress', function(progress) {
      var height = pool.chain.index.lastHeight
      console.log('syncProgress:', progress, 'height:', height, 'estimatedHeight', pool.chain.estimatedBlockHeight())
      // can generate json to make speedy next time.  defaults to writing to own source.
    })
    return pool
  }
}

module.exports = {
  client: client,
//  broadcast: broadcast
}
