var bsvup = module.exports

bsvup.logic = require("./logic.js")
bsvup.api = require("./api.js")
bsvup.cache = require("./cache.js")
bsvup.txUtil = require("./txUtil.js")

/*
    var fooDatum = [{
            buf: Buffer.from("Hello BSVUP"),
            mime: "text/html",
            dKey: "foo/file.txt"
    }]
    async function example(filedatum, privkey, utxos){
        var tasks = await bsvup.logic.createUploadTasks(filedatum)
        await bsvup.logic.fundTasks(tasks, privkey, utxos)
        await bsvup.logic.pendTasks(tasks)
        await bsvup.logic.verifyTasks(tasks)
        var TXs = bsvup.logic.getTXs(tasks)
    }
*/