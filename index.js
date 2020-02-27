const bsv = require('bsv')
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

        var txs = new bsvup().setPrivkey(privkey).addFile(fileData).addDPath("testfile2.txt", "1234567890").addUtxos(utxos).buildTXs()
    or
        var txs = new bsvup().setAddress(customAddress).setSigner(customSignerFunc).addFile(fileData).addDPath("testfile2.txt", "1234567890").buildTXs()

*/

function bsvup (options) {
  this.options = options || {}
  this.fileDatum = []
  this.tasks = []
  this.utxos = []
  this.address = null
  this.signer = null
  this.feePerKB = 1000
}

bsvup.logic = require('./logic.js')
bsvup.api = require('./api.js')
bsvup.cache = require('./cache.js')
bsvup.txUtil = require('./txUtil.js')

bsvup.prototype.addData = function(data, dKey){
  var fileData = {
    buf: Buffer.from(data),
    mime: "application/octet-stream",
    dKey: dKey,
    bExist: false,
    dExist: false,
  }
  this.fileDatum.push(fileData)
  return this
}

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

bsvup.prototype.setAddress = function (address) {
    this.address = address.toString()
    return this
}

bsvup.prototype.setSigner = function (signer) {
  this.signer = signer
  return this
}

bsvup.prototype.setPrivkey = function (privkey) {
  privkey = bsv.PrivateKey(privkey)
  this.address = privkey.toAddress().toString()
  if (!this.signer) this.signer = bsvup.txUtil.privkeySigner(privkey)
  return this
}

bsvup.prototype.setFeePerKB = function(feePerKB) {
  this.feePerKB = feePerKB
  return this
}

bsvup.prototype.buildTasks = async function (isCheckExist) {
  if (!this.signer) throw new Error('No signer or privkey assigned')
  if (!this.address) throw new Error('No address assigned')
  if (this.fileDatum.length === 0) throw new Error('No file provided')

  if (isCheckExist) {
    var alreadyReduced = this.fileDatum.filter(file => file.bExist || file.dExist)
    var toReduce = this.fileDatum.filter(file => (!file.bExist) & (!file.dExist))
    this.fileDatum = alreadyReduced.concat(await bsvup.logic.reduceFileDatum(toReduce))
  }

  this.tasks = await bsvup.logic.createUploadTasks(this.fileDatum, this.feePerKB)
  return this
}

bsvup.prototype.estimateFee = async function (isCheckExist){
  await this.buildTasks(isCheckExist)
  var DUST_LIMIT = 546
  var BASE_TX = 250
  var SIZE_PER_OUTPUT = 100
  var total = this.tasks.reduce((total, task)=>total + Math.max(DUST_LIMIT, task.satoshis), 0)
  var mapCost = Math.ceil((BASE_TX + SIZE_PER_OUTPUT * this.tasks.length) * this.feePerKB / 1000)
  return total + mapCost
}

bsvup.prototype.buildTXs = async function (isCheckExist) {
  await this.buildTasks(isCheckExist)
  if(this.utxos.length == 0){
      try{
        this.utxos = await bsvup.api.getUTXOs(this.address)
      }catch(err){
        throw new Error(`No utxo found for ${this.address}`)
      }
  }
  await bsvup.logic.fundTasksEx(this.tasks, this.address, this.utxos, this.signer, this.feePerKB)
  await bsvup.logic.pendTasks(this.tasks)

  try{
    if (!this.verify()) throw new Error('Not all transactions valid.')
  }catch(err){
    throw new Error('Not all transactions valid:' + err)
  }
  

  return this.getTXs()
}

bsvup.prototype.verify = function () {
  //var nonMaptasks = this.tasks.filter(task => task.type !== 'Map')
  //return bsvup.logic.verifyTasks(nonMaptasks)
  return bsvup.logic.verifyTasks(this.tasks, this.feePerKB)
}

bsvup.prototype.getTXs = function () {
  return bsvup.logic.getTXs(this.tasks)
}

module.exports = bsvup
