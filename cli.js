#!/usr/bin/env node

const fs = require("fs")
const bsv = require('bsv')
const ibe = require('bitcoin-ibe')
const crypto = require("crypto")
const MimeLookup = require('mime-lookup');
const MIME = new MimeLookup(require('mime-db'))
const explorer = require('bitcore-explorers')
const Insight = explorer.Insight
const insight = new explorer.Insight('https://api.bitindex.network')
const txutil = require("./txUtil.js")
const api = require("./api.js")
const logic = require("./logic.js")

global.debug = false
global.quick = false

var program = require('commander')
var inquirer = require('inquirer')
var qrcode = require('qrcode-terminal')

program
    .command('init')
    .description('在当前目录初始化')
    .action(init)

program
    .command('upload')
    .description('向链上上传')
    .action(upload)

program
    .command('charge')
    .description('展示地址二维码，向该地址转账以为上传提供资金')
    .action(charge)

program
    .command('transfer')
    .description('将该地址剩余资金转走，需搭配-a参数使用')
    .action(transfer)

program
    //.version(require('./package.json').version)
    .option('-f, --file [file]', '指定要上传的文件/目录  File/Directory to upload')
    .option('-s, --subkey [subpath]', '将内容上传到的子路径键  Subpath key to upload contents to', "/")
    .option('-k, --key [private key]', '指定使用的私钥  Appoint private key mannually')
    .option('-q, --quick', '快速上传，不检查文件是否已在链上  Skip file existence check')
    .option('-a, --address', '目标转账地址 Address to transfer to')
    .option('-t, --type [type]', '目录类型，用于表明目录被如何表示  Directory type: dir / html / none', "html")

var unBroadcast = []
if(process.argv.length<3){
    console.log("BSVUP 目录上链工具")
    console.log("使用命令 bsvup init 在该目录下初始化")
    console.log("使用命令 bsvup charge 来提供上链费用")
    console.log("使用命令 bsvup upload 将目录上传到链上")
    console.log("可以使用 bsvup -h 来查看帮助")
}
if(fs.existsSync("./.bsv/unbroadcasted.tx.json")){
    inquirer.prompt([ { 
        type: 'confirm', 
        name: 'continue', 
        message: `发现未广播TX，是否继续广播？（Y继续广播，N删除这些未广播TX）\r\nUnbroadcasted TX(s) found, continue broadcasting?(Y continue, N abandon those TXs)`, 
        default: true 
    }]).then((answers) => {
        if(answers.continue){
            unBroadcast = JSON.parse(fs.readFileSync("./.bsv/unbroadcasted.tx.json")).map(tx=>bsv.Transaction(tx))
            console.log(`${unBroadcast.length} TX(s) loaded.`)
            console.log("开始广播，可能需要花费一段时间，等几个区块。\r\nStart Broadcasting, it may take a while and several block confirmation...")
            broadcast()
        }else{
            //清除未广播的TX
            if(fs.existsSync("./.bsv/unbroadcasted.tx.json"))fs.unlinkSync("./.bsv/unbroadcasted.tx.json")
            program.parse(process.argv)
        }
    })
}else{
    program.parse(process.argv)
}

async function init(){
    if(!fs.existsSync("./.bsv")){
        fs.mkdirSync("./.bsv")
    }
    // 初始化objects结构
    if(!fs.existsSync("./.bsv/objects")){
        fs.mkdirSync("./.bsv/objects")
    }
    // 初始化D镜像目录
    if(!fs.existsSync("./.bsv/tx")){
        fs.mkdirSync("./.bsv/tx")
    }
    // 初始化D树文件
    if(!fs.existsSync("./.bsv/info")){
        fs.mkdirSync("./.bsv/info")
    }
    // 记录私钥，并产生地址
    if(fs.existsSync("./.bsv/key")){
        console.log("当前目录已经初始化过，如需重新初始化，请删除 .bsv 目录（删除前注意备份私钥）。")
        console.log("This directory is already initialize, delete .bsv if you want to re-initialize.(Backup your private key before deletion)")
        console.log("需要查看充值地址可使用密码解锁。")
        console.log("Unlock private key to see charge address.")
        charge()
    }
    else if(program.key && bsv.PrivateKey.isValid(program.key)){
        console.log(`链上地址 onchain address：${bsv.PrivateKey(program.key).toAddress().toString()}`)
        await saveKey(program.key)
    }else{
        var answers = await inquirer.prompt([ { 
            type: 'String', 
            name: 'privkey', 
            default: null,
            message: "私钥 PrivateKey(留空则自动生成 leave blank for a generated one):", 
        }])
        var privkey = (answers.privkey == "") ? null : answers.privkey
        var pk = bsv.PrivateKey(privkey)
        console.log(`链上地址 onchain address：${pk.toAddress().toString()}`)
        await saveKey(pk.toString())
        showQR(pk)
    }
}
function broadcast(){
    var toBroadcast = unBroadcast
    unBroadcast = []
    toBroadcast.reduce((promise,tx,index)=>{
        return promise.then(p=>{
            return new Promise((resolve, reject)=>{
                insight.broadcast(tx.toString(),(err,res)=>{
                    if(err){
                        console.log(`${tx.id} 广播失败，原因 fail to broadcast:`)
                        if(err.message && err.message.message){
                            console.log(err.message.message.split("\n")[0])
                            console.log(err.message.message.split("\n")[2])
                        }
                        unBroadcast.push(tx)
                    }else{
                        console.log(`Broadcasted ${res}`)
                        fs.writeFileSync(`./.bsv/tx/${res}`, tx)
                    }
                    resolve()
                })
            })
        })
    },
    new Promise(r=>r()))
    .then(r=>{
        if(unBroadcast.length>0){
            console.log(`${unBroadcast.length}个TX广播失败，已保存至'./.bsv/unbroadcasted.tx.json'，120秒后重新尝试广播。`)
            console.log(`Not All Transaction Broadcasted, ${unBroadcast.length} transaction(s) is saved to './.bsv/unbroadcasted.tx.json' and will be rebroadcasted in 120s.`)
            fs.writeFileSync("./.bsv/unbroadcasted.tx.json", JSON.stringify(unBroadcast))
            setTimeout(broadcast,120000)
        }else{
            console.log("所有TX已广播！")
            console.log("All TX Broadcasted!")
            if(fs.existsSync("./.bsv/unbroadcasted.tx.json"))fs.unlinkSync("./.bsv/unbroadcasted.tx.json")
        }
    })
}

async function upload(){
    global.quick = (program.quick)?true:false
    var key = (program.key)?program.key:await loadKey()
    var path = (program.file)?program.file:process.cwd()
    var subkey = (program.subkey)?program.subkey:"/"
    var tasks = await logic.upload(path, key, subkey, program.type)

    // 准备上传
    unBroadcast = tasks.map(task=>task.tx)
    tasks.every(task=>{
        if(global.debug)console.log(`Verifying ${task.type} TX ${task.tx.id}`)
        return txutil.verifyTX(task.tx)
    })
    fs.writeFileSync("./.bsv/unbroadcasted.tx.json",JSON.stringify(unBroadcast))
    // 做一些描述
    console.log("----------------------------------------------------------------------")
    console.log(`链上地址为 Address: ${key.toAddress().toString()}`)
    console.log("----------------------------------------------------------------------")
    console.log("新上传的内容可通过如下地址访问 Content is accessible from:")
    tasks.filter(task=>task.type=="D").forEach(task=>{
        console.log(` https://bico.media/${key.toAddress().toString()}/${task.out.key}`)
    })
    console.log("----------------------------------------------------------------------")
    console.log("生成了如下 TX(s): ")
    console.log(` Map: ${tasks.filter(task=>task.type=="Map").length} TX(s)`)
    console.log(` B: ${tasks.filter(task=>task.type=="B").length} TX(s)`)
    console.log(` Bcat: ${tasks.filter(task=>task.type=="Bcat").length} TX(s)`)
    console.log(` BcatPart: ${tasks.filter(task=>task.type=="BcatPart").length} TX(s)`)
    console.log(` D: ${tasks.filter(task=>task.type=="D").length} TX(s)`)
    console.log(`共计 Total ${unBroadcast.length} TX(s)`)
    console.log("----------------------------------------------------------------------")
    // 没有内容需要上传的话，就直接返回了
    if(unBroadcast.length==0)return
    // 上传确认
    inquirer.prompt([ { 
        type: 'confirm', 
        name: 'broadcast', 
        message: `确认并开始广播吗？Broadcast?`, 
        default: true 
    }]).then((answers) => {
        if(answers.broadcast){
            console.log("开始广播，可能需要花费一段时间，等几个区块。\r\nStart Broadcasting, it may take a while and several block confirmation...")
            broadcast()
        }
    })
}

async function charge(){
    //qrcode.generate(`bitcoin://${loadKey().toAddress().toString()}?sv&message=destine`)
    var key = await loadKey()
    showQR(key)
}

function showQR(key){
    console.log("----------------------------------------------------------------------")
    console.log(`地址 Address : ${key.toAddress().toString()}`)
    console.log("----------------------------------------------------------------------")
    console.log("适用于通常比特币钱包的二维码如下 Address in bitcoin:// format")
    console.log("----------------------------------------------------------------------")
    qrcode.generate(`bitcoin://${key.toAddress().toString()}?sv&message=destine`)
    console.log("----------------------------------------------------------------------")
    console.log("适用于打点钱包的二维码如下 Address")
    console.log("----------------------------------------------------------------------")
    qrcode.generate(`${key.toAddress().toString()}`)
    console.log("----------------------------------------------------------------------")
    console.log("该目录存放上传费用的转账地址如上，存储足够上传花费的小额Satoshis到此地址即可。")
    console.log("A small charge in is enough, unless you want to upload really big files.")
    console.log("私钥直接保存于本地，尽管有密码保护，并非钱包级安全性，请不要在其中存放过多金额。")
    console.log("Even though private key is encrypted, do not leave too much satoshis in.")
    console.log("----------------------------------------------------------------------")
}

async function transfer(){
    var address = (program.address)?program.address:null
    if(!address){
        address = (await inquirer.prompt([ { 
            type: 'string', 
            name: 'address', 
            message: "请输入要转账到的地址是 Transfer target："
        }])).address
    }
    if(!bsv.Address.isValid(address)){
        console.log("无效地址！ Invalid Address!")
        return
    }
    var key = await loadKey()
    var utxos = await api.getUTXOs(key.toAddress().toString())
    // 开始构造转账TX
    var tx = bsv.Transaction()
    utxos.forEach(utxo=>tx.from(utxo))
    tx.change(address)
    tx.feePerKb(1536)
    tx.sign(key)
    console.log(`转账TXID Transfer TXID: ${tx.id}`)
    api.broadcast(tx.toString())
}

async function loadKey(){
    var answers = await inquirer.prompt([ { 
        type: 'password', 
        name: 'password', 
        default: "",
        message: "请输入密码以解锁私钥 Password to unlock private key:", 
    }])
    var password = answers.password
    var buf = fs.readFileSync("./.bsv/key").toString()
    var decBuf = decrypt(buf, password)
    return bsv.PrivateKey(decBuf.toString())
}
async function saveKey(privkey){
    var answers = await inquirer.prompt([ { 
        type: 'password', 
        name: 'password', 
        default: "",
        message: "请设置密码以加密私钥 Set key unlock password:", 
    }])
    var password = answers.password
    var buf = Buffer.from(privkey.toString())
    var encBuf = encrypt(buf, password)
    fs.writeFileSync("./.bsv/key", encBuf)
}


function encrypt(plaintext, password){
    var cipher = crypto.createCipher('aes-128-ecb',password)
    return cipher.update(plaintext,'utf8','hex') + cipher.final('hex')
}
function decrypt(ciphertext, password){
    var cipher = crypto.createDecipher('aes-128-ecb',password)
    return cipher.update(ciphertext,'hex','utf8') + cipher.final('utf8')

}
