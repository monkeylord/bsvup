const fs = require('fs')
const bsv = require('bsv')
const crypto = require("crypto")
const API = require('./api.js')
const txutil = require("./txUtil.js")


const MimeLookup = require('mime-lookup');
const MIME = new MimeLookup(require('mime-db'))

const CHUNK_SIZE = 64000
const BASE_TX = 400
const FEE_PER_KB = 1536
const DUST_LIMIT = 546
const MAX_OUTPUT = 1000
const SIZE_PER_OUTPUT = 100

async function upload(path, privkey, dirHandle, subdir) {
    // 准备上传任务
    var tasks = []
    if (fs.statSync(path).isDirectory()) {
        var files = readFiles(path)
        // 处理文件上传任务
        while (files.length > 0) {
            var file = files.pop()
            var { buf, mime } = readFile(file, dirHandle)
            if (global.debug) console.log(mime)
            // 如果不处理该文件，则跳过，是否处理暂时用mime标识。
            if (!mime) continue
            /*
            var buf = fs.readFileSync(file)
            var mime = MIME.lookup(file)
            */
            var filename = file.slice(path.length)
            if (subdir) filename = (subdir + "/" + filename).replace(/\/\/+/g, '/')
            if (filename.startsWith('/')) filename = filename.slice(1)
            filename = encodeURI(filename)
            console.log(`正在处理 Handling ${filename}`)
            var fileTX = await API.findExist(buf, mime).catch(err => null)
            if (fileTX) {
                // 如果链上文件存在，那么要判断是否已经存在D指向了
                console.log(`${filename} - 找到了链上文件数据 File already on chain`)
                if (global.debug) console.log(fileTX.id)
                var dTX = await API.findD(filename, privkey.toAddress().toString(), fileTX.id)
                if (!dTX) {
                    // 链上文件存在而D不存在，则单纯做一次重新指向即可
                    var dTask = update_dTask(filename, fileTX.id)
                    tasks.push(dTask)
                } else {
                    console.log(`${filename} - 找到了链上D记录，无需上传 D record found, skip`)
                }
            } else {
                var fileTasks = upload_FileTask(buf, mime)
                var dTask = upload_dTask(filename, fileTasks)
                fileTasks.forEach(task => tasks.push(task))
                tasks.push(dTask)
            }
        }
        // 处理多余文件删除任务 TODO
    } else {
        // 先找是否在链上存在
        var filename = path.split("/").reverse()[0].split("\\").reverse()[0]
        if (subdir) filename = (subdir + "/" + filename).replace(/\/\/+/g, '/')
        if (filename.startsWith('/')) filename = filename.slice(1)
        filename = encodeURI(filename)
        var { buf, mime } = readFile(path, dirHandle)
        // 如果不处理该文件，则跳过，是否处理暂时用mime标识。
        if (!mime) return []
        /*
        var buf = fs.readFileSync(path)
        var mime = MIME.lookup(path)
        */
        var fileTX = await API.findExist(buf, mime).catch(err => null)
        if (fileTX) {
            // 如果链上文件存在，那么要判断是否已经存在D指向了
            console.log("找到了链上文件数据 File already on chain")
            if (global.debug) console.log(fileTX.id)
            var dTX = await API.findD(filename, privkey.toAddress().toString(), fileTX.id)
            if (!dTX) {
                // 链上文件存在而D不存在，则单纯做一次重新指向即可
                var dTask = update_dTask(path, fileTX.id)
                tasks.push(dTask)
            } else {
                console.log("找到了链上D记录，无需上传 D record found, skip")
            }
        } else {
            var fileTasks = upload_FileTask(buf, mime)
            var dTask = upload_dTask(filename, fileTasks)
            fileTasks.forEach(task => tasks.push(task))
            tasks.push(dTask)
        }
    }
    if (tasks.length == 0) {
        console.log("没有新内容需要上传 Nothing to upload")
        return tasks
    }
    await fundTasks(tasks, privkey)
    pendTasks(tasks)
    return tasks
}

function upload_FileTask(fileBuf, mime) {
    /*
    var fileBuf = fs.readFileSync(filename)
    var mime = MIME.lookup(filename)
    */
    var sha1 = crypto.createHash('sha1').update(fileBuf).digest('hex')

    var tasks = []
    if (fileBuf.length <= CHUNK_SIZE) {
        // 单个B协议TX就可以解决这个文件
        var fileTask = {
            type: "B",
            status: "ready",
            out: {
                data: fileBuf,
                mime: mime,
                encoding: "binary",
                filename: sha1
            },
            satoshis: fileBuf.length
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
                type: "BcatPart",
                status: "ready",
                out: {
                    data: buf
                },
                satoshis: buf.length
            }
        })
        // 然后创建Bcat任务
        // 假设：deps顺序即为chunks顺序
        var bcatTask = {
            type: "Bcat",
            status: "prepend",
            out: {
                info: "bsvup",
                mime: mime,
                encoding: "binary",
                filename: sha1,
                flag: Buffer.from("00", "hex"),
                chunks: null
            },
            deps: partTasks,
            satoshis: 64 * bufferChunks.length
        }
        partTasks.forEach(task => tasks.push(task))
        tasks.push(bcatTask)
    }
    return tasks
}

function upload_dTask(key, depTasks) {
    // 假设：B TX的依赖在depTasks中第一个
    return {
        type: "D",
        status: "prepend",
        out: {
            key: key,
            value: null,
            type: "b",
            sequence: new Date().getTime().toString()
        },
        deps: depTasks,
        satoshis: key.length + 64
    }
}
function update_dTask(key, value) {
    return {
        type: "D",
        status: "ready",
        out: {
            key: key,
            value: value,
            type: "b",
            sequence: new Date().getTime().toString()
        },
        satoshis: key.length + 64
    }
}

async function fundTasks(tasks, privkey) {
    // 给任务添加的UTXO格式中应包含privkey
    var utxos = await API.getUTXOs(privkey.toAddress().toString())
    // 现在检查是否有足够的Satoshis
    var satoshisRequired = tasks.reduce((totalRequired, task)=>totalRequired += Math.max(DUST_LIMIT, task.satoshis + BASE_TX), 0)
    var satoshisProvided = utxos.reduce((totalProvided, utxo)=>totalProvided += (utxo.amount)? Math.round(utxo.amount * 1e8) : utxo.satoshis, 0)
    if (satoshisProvided - satoshisRequired - tasks.length * SIZE_PER_OUTPUT < 0) {
        console.log(`当前地址余额不足以完成上传操作，差额大约为 ${satoshisProvided - satoshisRequired - tasks.length * SIZE_PER_OUTPUT} satoshis`)
        console.log(`Insuffient satoshis, still need ${satoshisProvided - satoshisRequired - tasks.length * SIZE_PER_OUTPUT} satoshis`)
        console.log("请使用 charge 命令获取转账地址 Use charge command to acquire charge address")
        throw new Error("Insuffient satoshis.")
    }
    var mytasks = tasks
    var myUtxos = utxos
    var totalSpent = 0
    var mapTasks = []
    while (mytasks.length > 0) {
        var currentTasks = mytasks.slice(0, MAX_OUTPUT)
        mytasks = mytasks.slice(MAX_OUTPUT)
        // 创建MapTX
        var mapTX = bsv.Transaction()
        // 按理说可以先算出所需要的Satoshis，然后只要能够满足需要的部分UTXO即可，不需要全部，但是这个优化以后再说
        myUtxos.forEach(utxo => mapTX.from(utxo))
        currentTasks.forEach(task => {
            // 创建输出
            mapTX.to(privkey.toAddress(), Math.max(DUST_LIMIT, task.satoshis + BASE_TX))
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
            mapTX.feePerKb(FEE_PER_KB)
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
            type: "Map",
            status: "pended",
            // 总花费
            satoshis: spent,
            tx: mapTX
        })
        // ChangeOutput as new UTXO
        if (mapTX.getChangeOutput()) {
            myUtxos = [{
                txid: mapTX.id,
                vout: mapTX.outputs.length - 1,
                address: mapTX.outputs[mapTX.outputs.length - 1].script.toAddress().toString(),
                script: mapTX.outputs[mapTX.outputs.length - 1].script.toHex(),
                satoshis: mapTX.outputs[mapTX.outputs.length - 1].satoshis
            }]
        } else {
            // This means insuffient Satoshis
            if(global.debug)console.log("Insuffient Satoshis when funding tasks")
            myUtxos = []
        }
    }

    // 开始压入mapTX，mapTXs放到前面，因为它们是接下来一切TX的父TX，需要最先广播，否则会报Missing input
    mapTasks.forEach(task => {
        tasks.unshift(task)
    })

    console.log(`预计总花费 Estimated fee : ${totalSpent} satoshis`)
}

function pendTasks(tasks, privkey) {
    // 假设：不存在依赖死锁或循环问题。所以可以通过有限次循环完成所有TX的生成
    while (!tasks.every(task => task.status == "pended")) {
        // 寻找可以直接生成的TX
        var readyTasks = tasks.filter(task => task.status == "ready")
        // 生成TX并更新这些任务的状态为 pended
        // 假设：Task里所有的UTXO都是计算过手续费的正好的UTXO
        readyTasks.forEach(task => {
            switch (task.type) {
                case "B":
                    task.tx = bsv.Transaction()
                    task.tx.from(task.utxo)
                    task.tx.addOutput(txutil.buildBOut(task.out))
                    task.tx.sign(task.utxo.privkey)
                    break;
                case "Bcat":
                    task.tx = bsv.Transaction()
                    task.tx.from(task.utxo)
                    task.tx.addOutput(txutil.buildBCatOut(task.out))
                    task.tx.sign(task.utxo.privkey)
                    break;
                case "BcatPart":
                    task.tx = bsv.Transaction()
                    task.tx.from(task.utxo)
                    task.tx.addOutput(txutil.buildBCatPartOut(task.out))
                    task.tx.sign(task.utxo.privkey)
                    break;
                case "D":
                    task.tx = bsv.Transaction()
                    task.tx.from(task.utxo)
                    task.tx.addOutput(txutil.buildDOut(task.out))
                    task.tx.sign(task.utxo.privkey)
                    break;
                default:
                    console.log("未知任务类型！")
                    throw new Error("Task Pending Error")
            }
            task.status = "pended"
        })
        // 更新Task状态
        var prependTasks = tasks.filter(task => task.status == "prepend")
        prependTasks.forEach(task => {
            var isDepsPended = task.deps.every(depTask => depTask.status == "pended")
            if (isDepsPended) {
                // 更新out
                switch (task.type) {
                    case "Bcat":
                        // 假设：deps顺序即为chunks顺序
                        task.out.chunks = task.deps.map(task => task.tx.id)
                        break;
                    case "D":
                        // 假设：B TX的依赖在depTasks中第一个
                        task.out.value = task.deps.filter(task => (task.type == "B" || task.type == "Bcat"))[0].tx.id
                        if (global.debug) console.log(task.deps.map(task => task.tx.id))
                        break;
                    default:
                        // 按说只有Bcat和D要处理依赖。所以不应该执行到这里。
                        console.log(`不应出现的任务类型:${task.type}`)
                        throw new Error("Task Pending Error")
                }
                task.status = "ready"
            }
        })
    }
}

function readFile(file, dirHandle) {
    if (fs.statSync(file).isDirectory()) {
        if (global.debug) console.log("处理目录 Handling folder")
        switch (dirHandle) {
            case "html":
                return {
                    buf: Buffer.from('<head><meta http-equiv="refresh" content="0;url=index.html"></head>'),
                    mime: "text/html"
                }
            case "dir":
                // 创建目录浏览
                var files = fs.readdirSync(file).map(item => (fs.statSync(file + "/" + item).isDirectory()) ? item + "/" : item)
                return {
                    buf: Buffer.from(`<head></head><body><script language="javascript" type="text/javascript">var files = ${JSON.stringify(files)};document.write("<p><a href='../'>..</a></p>");files.forEach(file=>document.write("<p><a href='" + file + "'>" + file + "</a></p>"));</script></body>`),
                    mime: "text/html"
                }
            default:
                return {}
        }
    } else {
        var buf = fs.readFileSync(file)
        var mime = MIME.lookup(file)
        return {
            buf: buf,
            mime: mime
        }
    }
}

function readFiles(path) {
    path = path || "."
    return fs.readdirSync(path).map(item => {
        if (item == ".bsv") return []
        var itemPath = path + "/" + item
        return (fs.statSync(itemPath).isDirectory()) ? readFiles(itemPath).concat([itemPath + "/"]) : [itemPath]
    }).reduce((res, item) => res.concat(item), [])
}

module.exports.upload = upload