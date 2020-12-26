const bsv_p2p = require('bsv-p2p')

// for now environment variable BSV_PEERS can be set for node addresses
_nodeaddrs = process.env.BSV_NODES || 'seed.bitcoinsv.io,seed.cascharia.com,seed.satoshisvision.network'
_peers = {}
_broadcasting = {}

function set_peers (new_nodes)
{
  _nodeaddrs = new_nodes
}

async function connect (addr)
{
  const peer = new bsv_p2p({
    node: addr,
    stream: false,
    validate: false
  })
  peer.on('addr', ({ addr }) => {
    connect(addr)
  })
  peer.on('connected', () => {
    txs = Object.keys(_broadcasting)
    if (txs.length) {
      // async call
      console.log('connected to ' + addr + ', broadcasting: ' + JSON.stringify(txs))
      peer.broadcastTxs(txs)
    }
  })
  peer.on('disconnected', () => {
    delete _peers[addr]
    console.log('BSVP2P: . disconnected from ' + addr)
  })
  try {
    await peer.connect()
  } catch(e) {
    console.log('BSVP2P: failed to connect to ' + addr + ': ' + e)
    return
  }
  _peers[addr] = peer
  console.log('BSVP2P: ! connected to ' + addr)
}

async function peers ()
{
  await Promise.race(_nodeaddrs.split(',').map(addr => addr in _peers ? null : connect(addr)))
  return _peers
}

async function broadcast (transaction)
{
  const nodes = await peers()
  _broadcasting[transaction] = 0
  txid = await Promise.race(Object.values(nodes).map(peer => peer.broadcastTx(transaction)))
  delete _broadcasting[transaction]
  return txid
}

module.exports = {
  set_peers: set_peers,
  clients: peers,
  broadcast: broadcast
}
