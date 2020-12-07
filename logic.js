/*
    This module handle core task logic.
    This module use API and don't care how to broadcast, read file data nor access blockchain.

    There must be tasks because there are dependencies.
    You need previous TXID to build next transaction.
    However, you need to know some information before necessary calculation like target UTXOs or Satoshis required.

    Task lifecircle:
    - prepend (Task created but data is not fully determined because some data depend on other task)
    - ready (Data is fully determined, but transaction is not created or signed)
    - pended (Transaction is built and fully signed)
    - * broadcasted (Transaction is broadcasted)

    Uploading precedure:
    - read files to filedata objects (getFileDatum)
    - check exist B/Bcat/D and reduce filedatum (reduceFileDatum)
    - create B/Bcat/D Task from filedatum (createUploadTasksEx)
    - create Map Task to split approperiate UTXOs to fund previous tasks (fundTasks)
    - pend tasks and handle dependencies (pendTasks)
    - check if all tasks valid (verifyTasks)
    - * broadcast
*/

const bsv = require('bsv')
const API = require('./api.js')
const txutil = require('./txUtil.js')

const CHUNK_SIZE = txutil.parameters.CHUNK_SIZE
const DUST_LIMIT = txutil.parameters.DUST_LIMIT
const BASE_TX = 178
const MAX_OUTPUT_INPUT_BYTES = 100000 // estimated
const SIZE_PER_OUTPUT = 42 // estimated
const SIZE_PER_INPUT = 156 // estimated

/*
    Wrap task lifecircle, read file datum from fs, create tasks and make tasks ready to broadcast
*/
async function prepareUpload (path, privkey, type, subdir, feePerKB) {
  // read files
  var fileDatum = await getFileDatum(path, type, subdir)
  // check existed
  fileDatum = await reduceFileDatum(fileDatum, privkey.toAddress())
  // create tasks
  var tasks = await createUploadTasks(fileDatum, feePerKB)
  // var tasks = await createUploadTasks(path, privkey, type, subdir)
  if (tasks.length === 0) return tasks
  // fund tasks (Throw insuffient satoshis error if not enough)
  var UTXOs = await API.getUTXOs(privkey.toAddress().toString())
  await fundTasks(tasks, privkey, UTXOs, feePerKB)
  // pend tasks (known issue: Customized tasks may dead loop for dependencies cannot be solved)
  await pendTasks(tasks)
  // verify tasks (will throw error if failed)
  verifyTasks(tasks, feePerKB)

  // ready to be broadcast
  return tasks
}

/*
    Read file datum from filesystem.

    Input
    - path in filesystem
    - directory handle type
    - sub directory in D record

    Output
    - file datum
*/
async function getFileDatum (path, dirHandle, subdir) {
  API.log(`[+] Loading files from ${path}`, API.logLevel.INFO)
  API.log(`    Directory type: ${dirHandle}`, API.logLevel.VERBOSE)
  API.log(`    Target sub directory: ${subdir}`, API.logLevel.VERBOSE)

  var fileDatum = []
  var files = API.isDirectory(path) ? API.readFiles(path) : [path]
  var basePath = API.isDirectory(path) ? path : path.split('/').reverse().slice(1).reverse().join('/')

  API.log(`    Base path: ${basePath}`, API.logLevel.VERBOSE)
  API.log(`    Total: ${files.length} files`, API.logLevel.VERBOSE)

  for (var file of files) {
    API.log(` - File to read is ${file}`, API.logLevel.VERBOSE)
    var { buf, mime } = API.isDirectory(file) ? API.readDir(file, dirHandle) : API.readFile(file)
    if (!mime) {
      API.log(` - File data not found, skip`, API.logLevel.VERBOSE)
      continue
    }
    var relativePath = file.slice(basePath.length)
    API.log(` - Reading ${API.isDirectory(file) ? 'directory' : 'file'}: ${relativePath}`, API.logLevel.VERBOSE)

    var filename = (subdir + '/' + relativePath).replace(/\/\/+/g, '/')
    if (filename.startsWith('/')) filename = filename.slice(1)
    API.log(`   D key: ${encodeURI(filename)}`, API.logLevel.VERBOSE)

    fileDatum.push({
      buf: buf,
      mime: mime,
      dKey: filename
    })
  }
  return fileDatum
}

/*
    Check if file B/D record already on chain.
    We do not need to waste satoshis.

    Input
    - file datum

    Ouput
    - file datum (marked)

    Input example:
    [{
        buf: Buffer,
        mime: "text/html",
        dKey: "foo/file.txt",
    }]
*/
async function reduceFileDatum (fileDatum, address) {
  API.log(`[+] Checking Exist Record`, API.logLevel.INFO)
  for (var fileData of fileDatum) {
    API.log(` - Checking ${fileData.dKey}`, API.logLevel.INFO)
    var fileTXs = await API.findExist(fileData.buf, fileData.mime)
    if (fileTXs) {
      API.log(`   Data found on chain.`, API.logLevel.INFO)
      fileData.bExist = true
      // fileData.buf = undefined    // Release Buffer
      fileData.dExist = false
      for (var fileTX of fileTXs) {
        fileData.dValue = fileTX.id
        if (await API.findD(fileData.dKey, address.toString(), fileTX.id)) {
          fileData.dExist = true
          API.log(`   D Record found on chain.`, API.logLevel.INFO)
          break
        }
      }
    } else {
      fileData.bExist = false
      fileData.dExist = false
    }
  }
  return fileDatum
}

/*
    Create file/directory upload tasks from file datum.

    Input
    - File datum
    - Fee Per KB (default 1000)
    Output
    - Tasks

    TODO:
    - other encoding (I think binary is OK for everything, but someone may want gzip)

    PS: You can use this directly.

    filedatum example:
    [
        {
            buf: Buffer,
            mime: "text/html",
            dKey: "foo/file.txt",
            bExist: false,
            dExist: false,
        },
        {
            dKey: "foo/file.txt",
            dValue: TXID,
            bExist: true,
            dExist: false,
        }
    ]
*/
async function createUploadTasks (filedatum, feePerKB) {
  feePerKB = feePerKB || 1000
  API.log(`[+] Creating Tasks`, API.logLevel.INFO)
  var tasks = []
  filedatum.forEach(filedata => {
    var bTasks, dTask
    if (!filedata.bExist) {
      API.log(` - Create B/D tasks for ${filedata.dKey}`, API.logLevel.VERBOSE)
      bTasks = uploadFileTask(filedata.buf, filedata.mime, feePerKB)
      dTask = uploadDTask(filedata.dKey, bTasks, feePerKB)
      tasks.push(dTask)
      bTasks.forEach(bTask => tasks.push(bTask))
    } else if (!filedata.dExist) {
      API.log(` - Create D tasks for ${filedata.dKey}`, API.logLevel.VERBOSE)
      dTask = updateDTask(filedata.dKey, filedata.dValue, feePerKB)
      tasks.push(dTask)
    } else {
      API.log(` - Ignore ${filedata.dKey}`, API.logLevel.VERBOSE)
      // Both B and D Exist, no task needed.
    }
  })
  if (tasks.length === 0) API.log('No task created.', API.logLevel.WARNING)
  return tasks
}

/*
    Create file task, B for small file, Bcat for large file
    B/BcatPart output depend on nothing, so it's ready when created.
    However Bcat output depend on BcatPart, that we cannot know those txid before those tasks pended.

    Input
    - File buffer
    - MIME type
    - Fee Per KB (default 1000)

    Output
    - Tasks
*/
function uploadFileTask (fileBuf, mime, feePerKB) {
  feePerKB = feePerKB || 1000
  /*
    var fileBuf = fs.readFileSync(filename)
    var mime = MIME.lookup(filename)
    */
  var sha1 = bsv.crypto.Hash.sha1(fileBuf).toString('hex')

  var tasks = []
  if (fileBuf.length <= CHUNK_SIZE) {
    // 单个B协议TX就可以解决这个文件
    var fileTask = {
      type: 'B',
      status: 'ready',
      out: {
        data: fileBuf,
        mime: mime,
        encoding: 'binary',
        filename: sha1
      },
      satoshis: Math.ceil((fileBuf.length + mime.length + 'binary'.length + sha1.length + 40) / 1000 * feePerKB)
    }
    tasks.push(fileTask)
  } else {
    // 要用Bcat了
    // 先切分Buffer
    var bufferChunks = []
    while (fileBuf.length > 0) {
      bufferChunks.push(fileBuf.slice(0, CHUNK_SIZE))
      fileBuf = fileBuf.slice(CHUNK_SIZE)
    }
    // 然后创建BcatPart任务
    var partTasks = bufferChunks.map(buf => {
      return {
        type: 'BcatPart',
        status: 'ready',
        out: {
          data: buf
        },
        satoshis: Math.ceil((37 + buf.length) / 1000 * feePerKB)
      }
    })
    // 然后创建Bcat任务
    // 假设：deps顺序即为chunks顺序
    var bcatTask = {
      type: 'Bcat',
      status: 'prepend',
      out: {
        info: 'bsvup',
        mime: mime,
        encoding: 'binary',
        filename: sha1,
        flag: bsv.deps.Buffer.from('00', 'hex'),
        chunks: null
      },
      deps: partTasks,
      satoshis: Math.ceil(('bsvup'.length + mime.length + 'binary'.length + sha1.length + 33 * bufferChunks.length + 41) / 1000 * feePerKB)
    }
    partTasks.forEach(task => tasks.push(task))
    tasks.push(bcatTask)
  }
  return tasks
}

/*
    Create D Task that depend on tasks.
    We assume the value(txid) will be provided by the first depended task.

    Input
    - D key
    - Tasks depended
    - Fee Per KB (default 1000)

    Output
    - Task
*/
function uploadDTask (key, depTasks, feePerKB) {
  // 假设：B TX的依赖在depTasks中第一个
  feePerKB = feePerKB || 1000
  return {
    type: 'D',
    status: 'prepend',
    out: {
      key: key,
      value: null,
      type: 'b',
      sequence: new Date().getTime().toString()
    },
    deps: depTasks,
    satoshis: Math.ceil((key.length + 64 + 13 + 40) / 1000 * feePerKB)
  }
}

/*
    Create D Task.
    This is used to point a key to value we know already.

    Input
    - D key
    - D value
    - Fee Per KB (default 1000)

    Output
    - Task
*/
function updateDTask (key, value, feePerKB) {
  feePerKB = feePerKB || 1000
  return {
    type: 'D',
    status: 'ready',
    out: {
      key: key,
      value: value,
      type: 'b',
      sequence: new Date().getTime().toString()
    },
    satoshis: Math.ceil((key.length + value.length + 13 + 40) / 1000 * feePerKB)
  }
}

/*
    Create MAP task and fund given tasks, by spliting UTXOs into UTXOs tasks needed.
    This procedure create MAP tasks that take current UTXOs as inputs, and approperiate UTXOs as outputs.
    Map tasks will be added into tasks given.

    Input
    - Tasks
    - PrivateKey
    - Fee Per KB (default 1000)

    Output
    - Funded tasks with map tasks added
*/
async function fundTasks (tasks, privkey, utxos, feePerKB) {
  feePerKB = feePerKB || 1000
  // 给任务添加的UTXO格式中应包含privkey
  API.log(`[+] Funding Tasks`, API.logLevel.INFO)
  // var utxos = await API.getUTXOs(privkey.toAddress().toString())
  // 现在检查是否有足够的Satoshis
  var satoshisRequired = tasks.reduce((totalRequired, task) => totalRequired += Math.max(DUST_LIMIT, task.satoshis + Math.ceil(BASE_TX * feePerKB / 1000)), 0)
  var satoshisProvided = utxos.reduce((totalProvided, utxo) => totalProvided += (utxo.amount) ? Math.round(utxo.amount * 1e8) : utxo.satoshis, 0)
  if (satoshisProvided - satoshisRequired - tasks.length * SIZE_PER_OUTPUT < 0) {
    API.log(`当前地址为 ${privkey.toAddress()}`, API.logLevel.WARNING)
    API.log(`Current Address ${privkey.toAddress()}`, API.logLevel.WARNING)
    API.log(`当前地址余额不足以完成上传操作，差额大约为 ${satoshisRequired + tasks.length * SIZE_PER_OUTPUT - satoshisProvided} satoshis`, API.logLevel.WARNING)
    API.log(`Insuffient satoshis, still need ${satoshisRequired + tasks.length * SIZE_PER_OUTPUT - satoshisProvided} satoshis`, API.logLevel.WARNING)
    API.log('请使用 charge 命令获取转账地址二维码 Use charge command to acquire charge address QRCode', API.logLevel.WARNING)
    throw new Error('Insuffient satoshis.')
  }
  var mytasks = tasks
  var myUtxos = utxos
  var totalSpent = 0
  var mapTasks = []
  while (mytasks.length > 0) {
    // To avoid create oversized TX
    numOutputs = Math.max(Math.floor((MAX_OUTPUT_INPUT_BYTES - myUtxos.length * SIZE_PER_INPUT) / SIZE_PER_OUTPUT), 1)
    var currentTasks = mytasks.slice(0,  numOutputs)
    mytasks = mytasks.slice(numOutputs)
    // 创建MapTX
    var mapTX = bsv.Transaction()
    // 按理说可以先算出所需要的Satoshis，然后只要能够满足需要的部分UTXO即可，不需要全部，但是这个优化以后再说
    while (myUtxos.length > 0 && numOutputs * SIZE_PER_OUTPUT + (mapTX.inputs.length + 1) * SIZE_PER_INPUT <= MAX_OUTPUT_INPUT_BYTES) {
        mapTX.from(myUtxos.pop())
    }
    currentTasks.forEach(task => {
      // 创建输出
      mapTX.to(privkey.toAddress(), Math.max(DUST_LIMIT, task.satoshis + Math.ceil(BASE_TX * feePerKB / 1000)))
      // 用刚创建的输出构建UTXO
      task.utxo = {
        privkey: privkey,
        txid: null,
        vout: mapTX.outputs.length - 1,
        address: mapTX.outputs[mapTX.outputs.length - 1].script.toAddress().toString(),
        script: mapTX.outputs[mapTX.outputs.length - 1].script.toHex(),
        satoshis: mapTX.outputs[mapTX.outputs.length - 1].satoshis
      }
    })
    if (mapTX.inputAmount - mapTX.outputAmount - mapTX.outputs.length * 150 - mapTX.inputs.length * 150 > 1000) {
      mapTX.change(privkey.toAddress())
      mapTX.feePerKb(feePerKB)
    }
    // 签名
    mapTX.sign(privkey)
    // 此时最终确定了txid
    currentTasks.forEach(task => task.utxo.txid = mapTX.id)
    // 计算花费
    var spent = mapTX.inputAmount - mapTX.outputs[mapTX.outputs.length - 1].satoshis
    // 更新总花费
    totalSpent = totalSpent + spent
    // 把mapTX封装成一个任务
    mapTasks.unshift({
      type: 'Map',
      status: 'pended',
      // 总花费
      satoshis: spent,
      tx: mapTX
    })
    // ChangeOutput as new UTXO
    if (mapTX.getChangeOutput()) {
      myUtxos.push({
        txid: mapTX.id,
        vout: mapTX.outputs.length - 1,
        address: mapTX.outputs[mapTX.outputs.length - 1].script.toAddress().toString(),
        script: mapTX.outputs[mapTX.outputs.length - 1].script.toHex(),
        satoshis: mapTX.outputs[mapTX.outputs.length - 1].satoshis
      })
    } else {
      // This means insuffient Satoshis
      API.log('Insuffient Satoshis when funding tasks', API.logLevel.VERBOSE)
    }
  }

  // 开始压入mapTX，mapTXs放到前面，因为它们是接下来一切TX的父TX，需要最先广播，否则会报Missing input
  // Map transactions need to be broadcast first, or there will be "Missing Input".
  mapTasks.forEach(task => {
    tasks.unshift(task)
  })

  API.log(`预计总花费 Estimated fee : ${totalSpent} satoshis`, API.logLevel.INFO)
  API.log(`费率 Fee Rate : ${feePerKB/1000} satoshis/byte`, API.logLevel.INFO)
  
  return tasks
}

/*
    Fund tasks with external signer, for situation "I don't have the private key for utxos".
    Like you are using a external wallet to do the signing.
    In this situation, you still need a separated private key, which is mainly used to for D protocol and is for your identity.

    signer is a async function which is expected to take unsigned maptx and return signed maptx.
*/
async function fundTasksEx (tasks, address, utxos, signer, feePerKB) {
  feePerKB = feePerKB || 1000
  var mapTX = bsv.Transaction()
  var currentTasks = tasks
  //var provided = utxos.reduce((total, utxo) => total += utxo.satoshis, 0)
  var spent = 0
  utxos.forEach(utxo => mapTX.from(utxo))
  currentTasks.forEach(task => {
    // 创建输出
    mapTX.to(address, Math.max(DUST_LIMIT, task.satoshis + Math.ceil(BASE_TX * feePerKB / 1000)))
    // 用刚创建的输出构建UTXO
    task.utxo = {
      signer: signer,
      txid: null,
      vout: mapTX.outputs.length - 1,
      address: mapTX.outputs[mapTX.outputs.length - 1].script.toAddress().toString(),
      script: mapTX.outputs[mapTX.outputs.length - 1].script.toHex(),
      satoshis: mapTX.outputs[mapTX.outputs.length - 1].satoshis
    }
    spent += task.utxo.satoshis
  })
  if (mapTX.inputAmount - mapTX.outputAmount - mapTX.outputs.length * 150 - mapTX.inputs.length * 150 > 1000) {
    if(utxos[0].address)mapTX.change(utxos[0].address)
    mapTX.feePerKb(feePerKB)
  }
  var signedMapTX = bsv.Transaction(await signer(mapTX))
  txutil.copyInputsInformation(mapTX, signedMapTX)
  currentTasks.forEach(task => task.utxo.txid = signedMapTX.id)

  var mapTask = {
    type: 'Map',
    status: 'pended',
    // 总花费
    satoshis: spent,
    tx: signedMapTX
  }
  tasks.unshift(mapTask)
  return tasks
}

/*
    Pend tasks

    Input
    - Funded tasks
    - PrivateKey (though funded tasks has private key, but we may need privatekey in the future)

    Output
    - Pended tasks

*/
async function pendTasks (tasks, privkey) {
  API.log(`[+] Pending Tasks`, API.logLevel.INFO)
  // 假设：不存在依赖死锁或循环问题。所以可以通过有限次循环完成所有TX的生成
  while (!tasks.every(task => task.status === 'pended')) {
    // 寻找可以直接生成的TX
    var readyTasks = tasks.filter(task => task.status === 'ready')
    // 生成TX并更新这些任务的状态为 pended
    // 假设：Task里所有的UTXO都是计算过手续费的正好的UTXO
    for(var task of readyTasks){
    //readyTasks.forEach(task => {
      switch (task.type) {
        case 'B':
          task.tx = bsv.Transaction()
          task.tx.from(task.utxo)
          task.tx.addOutput(txutil.buildBOut(task.out))
          if(task.utxo.privkey)task.tx.sign(task.utxo.privkey)
          else if(task.utxo.signer){
            var signedTX = await task.utxo.signer(task.tx)
            txutil.copyInputsInformation(task.tx, signedTX)
            task.tx = signedTX
          }
          else throw new Error("Task not funded, no privkey nor signer found for utxo.")
          break
        case 'Bcat':
          task.tx = bsv.Transaction()
          task.tx.from(task.utxo)
          task.tx.addOutput(txutil.buildBCatOut(task.out))
          if(task.utxo.privkey)task.tx.sign(task.utxo.privkey)
          else if(task.utxo.signer){
            var signedTX = await task.utxo.signer(task.tx)
            txutil.copyInputsInformation(task.tx, signedTX)
            task.tx = signedTX
          }
          else throw new Error("Task not funded, no privkey nor signer found.")
          break
        case 'BcatPart':
          task.tx = bsv.Transaction()
          task.tx.from(task.utxo)
          task.tx.addOutput(txutil.buildBCatPartOut(task.out))
          if(task.utxo.privkey)task.tx.sign(task.utxo.privkey)
          else if(task.utxo.signer){
            var signedTX = await task.utxo.signer(task.tx)
            txutil.copyInputsInformation(task.tx, signedTX)
            task.tx = signedTX
          }
          else throw new Error("Task not funded, no privkey nor signer found.")
          break
        case 'D':
          task.tx = bsv.Transaction()
          task.tx.from(task.utxo)
          task.tx.addOutput(txutil.buildDOut(task.out))
          if(task.utxo.privkey)task.tx.sign(task.utxo.privkey)
          else if(task.utxo.signer){
            var signedTX = await task.utxo.signer(task.tx)
            txutil.copyInputsInformation(task.tx, signedTX)
            task.tx = signedTX
          }
          else throw new Error("Task not funded, no privkey nor signer found.")
          break
        default:
          API.log('未知任务类型！', API.logLevel.ERROR)
          throw new Error('Task Pending Error')
      }
      task.status = 'pended'
    //})
    }
    // 更新Task状态
    var prependTasks = tasks.filter(task => task.status === 'prepend')
    prependTasks.forEach(task => {
      var isDepsPended = task.deps.every(depTask => depTask.status === 'pended')
      if (isDepsPended) {
        // 更新out
        switch (task.type) {
          case 'Bcat':
            // 假设：deps顺序即为chunks顺序
            task.out.chunks = task.deps.map(task => task.tx.id)
            break
          case 'D':
            // 假设：B TX的依赖在depTasks中第一个
            task.out.value = task.deps.filter(task => (task.type === 'B' || task.type === 'Bcat'))[0].tx.id
            API.log(task.deps.map(task => task.tx.id), API.logLevel.VERBOSE)
            break
          default:
            // 按说只有Bcat和D要处理依赖。所以不应该执行到这里。
            API.log(`不应出现的任务类型:${task.type}`, API.logLevel.INFO)
            throw new Error('Task Pending Error')
        }
        task.status = 'ready'
      }
    })
  }
  return tasks
}

/*
    Verify tasks

    Input
    - Tasks

    Output
    - True if all tasks valid
*/
function verifyTasks (tasks, feePerKB) {
  API.log(`[+] Verifying Tasks`, API.logLevel.INFO)
  return tasks.every(task => {
    API.log(` - Verifying ${task.type} TX ${task.tx.id}`, API.logLevel.VERBOSE)
    return txutil.verifyTX(task.tx, feePerKB)
  })
}

/*
    Extract TX from pended tasks

    Input
    - Tasks

    Output
    - TXs
*/
function getTXs (tasks) {
  return tasks.map(task => task.tx)
}

module.exports = {
  createUploadTasks: createUploadTasks,
  reduceFileDatum: reduceFileDatum,
  fundTasks: fundTasks,
  fundTasksEx: fundTasksEx,
  pendTasks: pendTasks,
  verifyTasks: verifyTasks,
  getTXs: getTXs,
  prepareUpload: prepareUpload,
  update_dTask: updateDTask,
  upload_dTask: uploadDTask,
  upload_FileTask: uploadFileTask
}
