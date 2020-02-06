const bsv = require("bsv")
const bitdb = 'https://genesis.bitdb.network/q/1FnauZ9aUH2Bex6JzdcV4eNX7oLSSEbxtN/'
const BitDBKey = ['159bcdKY4spcahzfTZhBbFBXrTWpoh4rd3']
const fetch = require('node-fetch')

async function findTx(id) {
    var query = queryTx(id)
    var b64 = Buffer.from(JSON.stringify(query)).toString('base64');
    var url = bitdb + b64;
    var header = {
        headers: { key: BitDBKey }
    };
    var r
    try {
        r = await fetch(url, header)
    } catch(e) {
        console.log(e)
        return []
    }
    r = await r.json()
    return r.u.concat(r.c)
}

async function findExist(buffer) {
    var sha1 = bsv.crypto.Hash.sha1(buffer).toString('hex')
    var query = queryHash(sha1)
    var query2 = queryHashGenesis(sha1)
    // TODO: 向BitDB查询相关TX(s)并校验
    var b64 = Buffer.from(JSON.stringify(query)).toString('base64');
    var b642 = Buffer.from(JSON.stringify(query2)).toString('base64');
    var url = bitdb + b64;
    var url2 = bitdb + b642;
    var header = {
        headers: { key: BitDBKey }
    };
    var r, r2
    try {
        r = await fetch(url, header)
        r2 = await fetch(url2, header)
    } catch(e) {
        console.log(e)
        return []
    }
    r = await r.json()
    r2 = await r2.json()
    r = r2.u.concat(r2.c,r.c)
    return r.filter(record => (
        record.prefix == "15DHFxWZJT58f9nhyGnsRBqrgwK4W6h4Up" || record.prefix == "19HxigV4QyBv3tHpQVcUEQyq1pzZVdoAut"
    ))
}

async function findD(key, address) {
    var query = queryD(key, address)
    var query2 = queryDGenesis(key, address)
    // TODO: 向BitDB查询相关TX(s)并校验
    var b64 = Buffer.from(JSON.stringify(query)).toString('base64');
    var b642 = Buffer.from(JSON.stringify(query2)).toString('base64');
    var url = bitdb + b64;
    var url2 = bitdb + b642;
    var header = {
        headers: { key: BitDBKey }
    };
    try {
        r = await fetch(url, header)
        r2 = await fetch2(url, header)
    } catch(e) {
        console.log(e)
        return []
    }
    r = await r.json()
    r2 = await r2.json()
    r = r2.u.concat(r2.c, r.c)
    return r.sort((a, b) => b.sequence - a.sequence))
}

function queryTx(id) {
    return {
        "v": 3,
        "q": {
            "find": {
                "tx.h": id
            },
            "project": {
                "tx.h": 1
            },
        },
    }
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
function queryHashGenesis(hash) {
    // B or Bcat
    return {
        "v": 3,
        "q": {
            "find": {
                "$or": [{ "out.s2": "15DHFxWZJT58f9nhyGnsRBqrgwK4W6h4Up" }, { "out.s2": "19HxigV4QyBv3tHpQVcUEQyq1pzZVdoAut" }],
                "out.s6": hash
            },
        },
        "r": {
            "f": "[ .[] | {prefix: .out[0].s2 , contenttype: .out[0].s4, txid: .tx.h} ]"
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
function queryDGenesis(key, address) {
    return {
        "v": 3,
        "q": {
            "find": {
                "in.e.a": address ? address : undefined,
                "out.s3": key ? key : undefined,
                "out.s2": "19iG3WTYSsbyos3uJ733yK4zEioi1FesNU"
            }
        },
        "r": {
            "f": "[.[] | (.out[0] | { key: .s3, value: .s4, type: .s5, sequence: .s6}) + {address: .in[0].e.a}]"
        }
    }
}

module.exports = {
    findTx: findTx,
    findExist: findExist,
    findD: findD
}
