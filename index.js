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

/*
    This is the main class of bsvup
    This class is designed to pack logics behind bsvup into a easy to understand class.
    The goal is chained operations like:

    var txs = new bsvup().setPrivkey(privkey).addFile(fileData).addDPath("testfile2.txt", "1234567890").addUtxos(utxos).broadcast()
    or
    var txs = new bsvup().setPrivkey(privkey).setSigner(customSignerFunc).addFile(fileData).addDPath("testfile2.txt", "1234567890").addUtxos(utxos).buildTXs()

*/

function bsvup (options) {
  this.options = options || {}
  this.fileDatum = []
  this.tasks = []
  this.utxos = []
  this.privkey = null
  this.signer = null
}

bsvup.logic = require('./logic.js')
bsvup.api = require('./api.js')
bsvup.cache = require('./cache.js')
bsvup.txUtil = require('./txUtil.js')

bsvup.prototype.addFile = function (file, filename) {
  // TODO process file to file object
  var fileData = null
  if ((file instanceof Object) && file.buf && file.mime) {
    fileData = {
      buf: file.buf,
      mime: file.mime,
      dKey: filename || file.dKey || file.toString()
    }
  } else {
    fileData = bsvup.api.readFile(file)
    fileData.dKey = filename || file.toString()
  }

  this.fileDatum.push(fileData)

  /*
    var bTasks = bsvup.logic.upload_FileTask(file.buf, file.mime)
    if(filename){
        var dTask = bsvup.logic.upload_dTask(filename, bTasks)
        this.tasks.push(dTask)
    }
    bTasks.forEach(task=>this.tasks.push(task))
    */
  return this
}

bsvup.prototype.addDPath = function (dKey, dValue) {
  this.fileDatum.push({
    dKey: dKey,
    bExist: true,
    dExist: false,
    dValue: dValue
  })

  /*
    this.tasks.push(bsvup.logic.update_dTask(DKey,DValue))
    */
  return this
}

bsvup.prototype.addUtxos = function (utxos, privkey) {
  utxos.forEach(utxo => {
    this.utxos.push(utxo)
  })
  if (privkey) this.signer = bsvup.txUtil.privkeySigner(privkey)
  return this
}

bsvup.prototype.setSigner = function (signer) {
  this.signer = signer
  return this
}

bsvup.prototype.setPrivkey = function (privkey) {
  this.privkey = privkey
  if (!this.signer) this.signer = bsvup.txUtil.privkeySigner(privkey)
  return this
}

bsvup.prototype.buildTXs = async function (isCheckExist) {
  if (!this.signer) throw new Error('No signer or privkey assigned')
  if (!this.privkey) throw new Error('No privkey assigned')
  if (this.fileDatum.length === 0) throw new Error('No file provided')

  if (isCheckExist) {
    var alreadyReduced = this.fileDatum.filter(file => file.bExist || file.dExist)
    var toReduce = this.fileDatum.filter(file => (!file.bExist) & (!file.dExist))
    this.fileDatum = alreadyReduced.concat(await bsvup.logic.reduceFileDatum(toReduce))
  }

  this.tasks = await bsvup.logic.createUploadTasks(this.fileDatum)
  await bsvup.logic.fundTasksEx(this.tasks, this.privkey, this.utxos, this.signer)
  await bsvup.logic.pendTasks(this.tasks)

  if (!this.verify()) throw new Error('Not all transactions valid.')

  return this.getTXs()
}

bsvup.prototype.verify = function () {
  var nonMaptasks = this.tasks.filter(task => task.type !== 'Map')
  return bsvup.logic.verifyTasks(nonMaptasks)
}

bsvup.prototype.getTXs = function () {
  return bsvup.logic.getTXs(this.tasks)
}

bsvup.prototype.broadcast = function () {
  return this.buildTXs().then(txs => {
    bsvup.api.tryBroadcastAll(txs)
    return txs
  })
}

module.exports = bsvup
