const crypto = require("crypto")
const bitdb = 'https://genesis.bitdb.network/q/1FnauZ9aUH2Bex6JzdcV4eNX7oLSSEbxtN/'
const BitDBKey = ['159bcdKY4spcahzfTZhBbFBXrTWpoh4rd3']
const fetch = require('node-fetch')

function findExist(buffer) {
    var sha1 = crypto.createHash('sha1').update(buffer).digest('hex')
    var query = queryHash(sha1)
    // TODO: 向BitDB查询相关TX(s)并校验
    var b64 = Buffer.from(JSON.stringify(query)).toString('base64');
    var url = bitdb + b64;
    var header = {
        headers: { key: BitDBKey }
    };
    return fetch(url, header)
        .then(r => r.json())
        .then(r => r.c)
        .then(r => r.filter(record => (
            record.prefix == "15DHFxWZJT58f9nhyGnsRBqrgwK4W6h4Up" || record.prefix == "19HxigV4QyBv3tHpQVcUEQyq1pzZVdoAut")
        ))
        .catch(err => { console.log(err); return [] })
}

function findD(key, address) {
    var query = queryD(key, address)
    // TODO: 向BitDB查询相关TX(s)并校验
    var b64 = Buffer.from(JSON.stringify(query)).toString('base64');
    var url = bitdb + b64;
    var header = {
        headers: { key: BitDBKey }
    };
    return fetch(url, header)
        .then(r => r.json())
        .then(r => r.u.concat(r.c))
        .then(r => r.sort((a, b) => b.sequence - a.sequence))
        //.then(r=>{console.log(r);return r})
        //.then(r=>(r.length>0)?r[0]:null)
        .catch(err => console.log(err))
}

function queryHash(hash) {
    // B or Bcat
    return {
        "v": 3,
        "q": {
            "find": {
                "$or": [{ "out.s1": "15DHFxWZJT58f9nhyGnsRBqrgwK4W6h4Up" }, { "out.s1": "19HxigV4QyBv3tHpQVcUEQyq1pzZVdoAut" }],
                "out.s5": hash
            },
        },
        "r": {
            "f": "[ .[] | {prefix: .out[0].s1 , contenttype: .out[0].s3, txid: .tx.h} ]"
        }
    }
}
function queryTXID(txid) {
    return {
        "v": 3,
        "q": {
            "find": { "tx.h": txid },
        }
    }
}

function queryD(key, address) {
    return {
        "v": 3,
        "q": {
            "find": {
                "in.e.a": address ? address : undefined,
                "out.s2": key ? key : undefined,
                "out.s1": "19iG3WTYSsbyos3uJ733yK4zEioi1FesNU"
            }
        },
        "r": {
            "f": "[.[] | (.out[0] | { key: .s2, value: .s3, type: .s4, sequence: .s5}) + {address: .in[0].e.a}]"
        }
    }
}

module.exports = {
    findExist: findExist,
    findD: findD
}