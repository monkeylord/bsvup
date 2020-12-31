const bsv_p2p = require('bsv-p2p-deanmlittle')

// for now environment variable BSV_PEERS can be set for node addresses
var _nodeaddrs = process.env.BSV_NODES || 'seed.bitcoinsv.io,seed.cascharia.com,seed.satoshisvision.network'
_peers = {}
_broadcasting = {}

function set_peers (new_nodes)
{
  _nodeaddrs = new_nodes
}

async function connect (addr)
{
  var Peer = require('bitcore-p2p').Peer;
  const addrparts = addr.split(':')
  const peer = new bsv_p2p.Peer({host: addrparts[0], port: addrparts[1]})
  return peer
}

async function client ()
{
  if (_client === null) {
    client = 
// note: bitcore may have a good client already.
// goal: access bitcore just to figure out how to make a peer. [too much words, boss sensitive re: bitcore lightweight client]
  } 
}
