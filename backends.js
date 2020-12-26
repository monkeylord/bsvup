/*
    This module handles calling out to other backends.
    - query information
    - download transactions
    - broadcast transactions
*/

const mattercloud = require('mattercloudjs').instance({
  api_key: '4ZiBSwCzjgkCzDbX9vVV2TGqe951CBrwZytbbWiGqDuzkDETEkLJ9DDXuNMLsr8Bpj'
})
const bsv = require('bsv')
const bitbus = require('./bitbus.js')
const axios = require('axios')

async function get_bitquery (query)
{
  return bitbus.get_array(query)
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

// Functions that were originally in bitdb.js
async function findTx (id) {
  var queryTx = {
    'v': 3,
    'q': {
      'find': {
        'tx.h': id
      },
      'project': {
        'tx.h': 1,
        'blk': 1
      }
    }
  }
  var r = await get_bitquery(queryTx)
  return r
}
async function findMightExist (buffer) {
  // findExist is renamed to findMightExist because the sha1 could mismatch the data
  var hash = bsv.crypto.Hash.sha1(buffer).toString('hex')

  // B or Bcat
  var queryHash = {
    'v': 3,
    'q': {
      'find': {
        '$or': [{ 'out.s1': '15DHFxWZJT58f9nhyGnsRBqrgwK4W6h4Up' }, { 'out.s1': '19HxigV4QyBv3tHpQVcUEQyq1pzZVdoAut' }],
        'out.s5': hash
      },
      'project': {
        'out.s1': 1,
        'out.s3': 1,
        'tx.h': 1
      }
    }
  }
  var queryHashGenesis = {
    'v': 3,
    'q': {
      'find': {
        '$or': [{ 'out.s2': '15DHFxWZJT58f9nhyGnsRBqrgwK4W6h4Up' }, { 'out.s2': '19HxigV4QyBv3tHpQVcUEQyq1pzZVdoAut' }],
        'out.s6': hash
      },
      'project': {
        'out.s2': 1,
        'out.s4': 1,
        'tx.h': 1
      }
    }
  }
  var r = await get_bitquery(queryHash)
  var r2 = await get_bitquery(queryHashGenesis)
  for (var index = 0; index < r.length; ++ index) {
    data = r[index]
    r[index] = {
      'prefix': data.out[0].s1,
      'contenttype': data.out[0].s3,
      'txid': data.tx.h
    }
  }
  for (var index = 0; index < r2.length; ++ index) {
    data = r2[index]
    r2[index] = null
    r.push({
      'prefix': data.out[0].s2,
      'contenttype': data.out[0].s4,
      'txid': data.tx.h
    })
  }
  return r.filter(record => record.prefix && (
    // TODO: since the query already performed this comparison, this is probably where we want to check the data, and only return transactions with correct data.  the comparison is migrated from bitdb.
    record.prefix === '15DHFxWZJT58f9nhyGnsRBqrgwK4W6h4Up' || record.prefix === '19HxigV4QyBv3tHpQVcUEQyq1pzZVdoAut'
  ))
}

async function findD (key, address) {
  var queryD = {
    'v': 3,
    'q': {
      'find': {
        'in.e.a': address || undefined,
        'out.s2': key || undefined,
        'out.s1': '19iG3WTYSsbyos3uJ733yK4zEioi1FesNU'
      },
      'project': {
        'out.s2': 1,
        'out.s3': 1,
        'out.s4': 1,
        'out.s5': 1,
        'in.e.a': 1,
        'blk.i': 1
      }
    }
  }
  var queryDGenesis = {
    'v': 3,
    'q': {
      'find': {
        'in.e.a': address || undefined,
        'out.s3': key || undefined,
        'out.s2': '19iG3WTYSsbyos3uJ733yK4zEioi1FesNU'
      },
      'project': {
        'out.s3': 1,
        'out.s4': 1,
        'out.s5': 1,
        'out.s6': 1,
        'in.e.a': 1,
        'blk.i': 1
      }
    }
  }
  var r = await get_bitquery(queryD)
  var r2 = await get_bitquery(queryDGenesis)
  for (var index = 0; index < r.length; ++ index) {
    data = r[index]
    r[index] = {
      'key': data.out[0].s2,
      'value': data.out[0].s3,
      'type': data.out[0].s4,
      'sequence': data.out[0].s5,
      'address': data.in[0].e.a,
      'height': data.blk.i
    }
  }
  for (var index = 0; index < r2.length; ++ index) {
    data = r2[index]
    r2[index] = null
    r.push({
      'key': data.out[0].s3,
      'value': data.out[0].s4,
      'type': data.out[0].s5,
      'sequence': data.out[0].s6,
      'address': data.in[0].e.a,
      'height': data.blk.i
    })
  }
  
  return r.sort(function(a, b) {
    if (b.height == a.height) {
      return b.sequence - a.sequence
    } else {
      return b.height - a.height
    }
  })
}

module.exports = {
  get_bitquery: get_bitquery,
  get_rawtx: get_rawtx,
  get_utxos: get_utxos,
  broadcast: broadcast,
  findTx: findTx,
  findMightExist: findMightExist,
  findD: findD
}
