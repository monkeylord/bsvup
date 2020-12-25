const bsv_rpc = require('bitcoin-cash-rpc')

const fs = require('fs')
const os = require('os')

// for now environment variable BSV_RPC can be set for server rpc path/url 
_server = process.env.BSV_RPC || '~/.bitcoin'
_client = null

function set_server(new_server)
{
    _server = new_server
    if (_client !== null) {
        _client = null
    }
}

function client()
{
    if (_client === null) {
        let server = _server
        // if 'server' is a path to a datadir or cookie file, read it
        const homereplace = server.replace('~', os.homedir())
        for (let fname of [server + '/.cookie', homereplace + '/.cookie', server, homereplace]) {
            if (fs.existsSync(fname)) {
                server = fs.readFileSync(fname).toString()
                break
            }
        }

        // remove any protocol from server
        server = server.split('://')
        server = server[server.length - 1]

        // separate login from location, if present
        server = server.split('@')
        let login = server[0].split(':')
        const username = login[0]
        const password = login[1]

        // process location
        if (server.length < 2) {
            server = 'localhost'
        } else {
            server = server[1]
        }
        server = server.split(':')
        const host = server[0]
        const port = server.length < 2 ? 8332 : parseInt(server[1])

        // connect
        _client = new bsv_rpc(host, username, password, port, 5000, true) // for now debugging=true is needed to throw errors
    }
    return _client
}

async function request(name, ...params)
{
    const rpc = client()
    return await rpc[name](...params)
}

async function get_rawtx (identifier)
{
    return request('getRawTransaction', identifier)
}

async function broadcast (transaction)
{
    return request('sendRawTransaction', transaction)
}

module.exports = {
    set_server: set_server,
    client: client,
    get_rawtx: get_rawtx,
    broadcast: broadcast
}
