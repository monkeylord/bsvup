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
const Cache = require("./cache.js")

global.verbose = false
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
    .version(require('./package.json').version)
    .option('-f, --file [file]', 'File/Directory to upload 【指定要上传的文件/目录】')
    .option('-k, --key [private key]', 'Appoint private key mannually 【指定使用的私钥】')
    .option('-q, --quick', 'Skip file existence check  【快速上传，不检查文件是否已在链上】')
    .option('-a, --address', 'Address to transfer to / 【目标转账地址】')
    .option('-t, --type [type]', 'Directory type: dir / html / none  【目录类型，用于表明目录被如何表示】', "html")
    .option('-p, --password [password]', 'Password to unlock privatekey 【解锁私钥的密码】')
    .option('-b, --broadcast', 'Broadcast without asking  【生成后直接广播】', false)
    .option('-s, --subdirectory [subdirectory]', 'Upload to sub directory onchain  【上传到子目录】', "")
    .option('-n, --newtask', 'abandon unbroadcasted and start new tasks  【放弃未广播内容】')
    .option('-v, --verbose', 'show detailed infomation  【显示详细信息】')

var unBroadcast = []
if (process.argv.length < 3) {
    console.log("BSVUP 目录上链工具")
    console.log("使用命令 bsvup init 在该目录下初始化")
    console.log("使用命令 bsvup charge 来提供上链费用")
    console.log("使用命令 bsvup upload 将目录上传到链上")
    console.log("可以使用 bsvup -h 来查看帮助")
    console.log("Examples: ")
    console.log("   bsvup init -k L1C8GaB7KepzbvNPpwbtdypjNvSeFd748ewPckGXt4WFkE7R8cUG -p mypassword")
    console.log("   bsvup upload -f somedirectory -s subpath/anothersubpath -p mypassword -n -b")
    console.log("   bsvup transfer -a 19vuHzifeejLBqWhGnQ1zmw1TwYzoXcaUM -p mypassword")
}
// 因为这个判断在parse之前，不能从program里判断，只有自己判断了
if (process.argv.filter(arg => (arg == "-n" || arg == "--newtask")).length == 0 && fs.existsSync("./.bsv/unbroadcasted.tx.json")) {
    inquirer.prompt([{
        type: 'confirm',
        name: 'continue',
        message: `发现未广播TX，是否继续广播？（Y继续广播，N删除这些未广播TX）\r\nUnbroadcasted TX(s) found, continue broadcasting?(Y continue, N abandon those TXs)`,
        default: true
    }]).then((answers) => {
        if (answers.continue) {
            //unBroadcast = JSON.parse(fs.readFileSync("./.bsv/unbroadcasted.tx.json")).map(tx => bsv.Transaction(tx))
            console.log(`${Cache.loadUnbroadcast().length} TX(s) loaded.`)
            console.log("开始广播，可能需要花费一段时间，等几个区块。\r\nStart Broadcasting, it may take a while and several block confirmation...")
            broadcast()
        } else {
            //清除未广播的TX
            if (fs.existsSync("./.bsv/unbroadcasted.tx.json")) fs.unlinkSync("./.bsv/unbroadcasted.tx.json")
            program.parse(process.argv)
        }
    })
} else {
    program.parse(process.argv)
}

async function init(){
    Cache.initCache()

    // 记录私钥，并产生地址
    if (Cache.isKeyExist()) {
        console.log("当前目录已经初始化过，如需重新初始化，请删除 .bsv 目录（删除前注意备份私钥）。")
        console.log("This directory is already initialize, delete .bsv if you want to re-initialize.(Important: Backup your private key before deletion)")
        console.log("需要查看充值地址可使用密码解锁。")
        console.log("Unlock private key to see charge address.")
        charge()
    }
    else if (program.key && bsv.PrivateKey.isValid(program.key)) {
        console.log(`链上地址 onchain address：${bsv.PrivateKey(program.key).toAddress().toString()}`)
        await saveKey(program.key)
        showQR(bsv.PrivateKey(program.key))
    } else {
        var answers = await inquirer.prompt([{
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
async function broadcast(){
    let remaining = await api.tryBroadcastAll()
    if(remaining.length>0){
        console.log(`${remaining}个TX广播失败，已保存至'./.bsv/unbroadcasted.tx.json'，120秒后重新尝试广播。`)
        console.log(`Not All Transaction Broadcasted, ${remaining.length} transaction(s) is saved to './.bsv/unbroadcasted.tx.json' and will be rebroadcasted in 120s.`)
        setTimeout(broadcast,120000)
    }else{
        console.log("所有TX已广播！")
        console.log("All TX Broadcasted!")
    }
}

async function upload(){
    global.quick = (program.quick)?true:false
    global.verbose = (program.verbose)?true:false

    var key = (program.key)?program.key:await loadKey()
    var path = (program.file)?program.file:process.cwd()

    var tasks = await logic.prepareUpload(path, key, program.type, program.subdirectory)

    // Briefing
    console.log("----------------------------------------------------------------------")
    console.log(`链上地址为 Address: ${key.toAddress().toString()}`)
    console.log("----------------------------------------------------------------------")
    console.log("新上传的内容可通过如下地址访问 Content is accessible from:")
    tasks.filter(task => task.type == "D").forEach(task => {
        console.log(` https://bico.media/${key.toAddress().toString()}/${task.out.key}`)
    })
    console.log("----------------------------------------------------------------------")
    console.log("生成了如下 TX(s): ")
    console.log(` Map: ${tasks.filter(task => task.type == "Map").length} TX(s)`)
    console.log(` B: ${tasks.filter(task => task.type == "B").length} TX(s)`)
    console.log(` Bcat: ${tasks.filter(task => task.type == "Bcat").length} TX(s)`)
    console.log(` BcatPart: ${tasks.filter(task => task.type == "BcatPart").length} TX(s)`)
    console.log(` D: ${tasks.filter(task => task.type == "D").length} TX(s)`)
    console.log(`共计 Total ${tasks.length} TX(s)`)
    console.log("----------------------------------------------------------------------")

    // Ready to broadcast
    let unBroadcast = logic.getTXs(tasks)

    // 没有内容需要上传的话，就直接返回了
    if (unBroadcast.length == 0) return
    // 上传确认
    var toBroadcast = program.broadcast
    if (!program.broadcast) {
        var answers = await inquirer.prompt([{
            type: 'confirm',
            name: 'broadcast',
            message: `确认并开始广播吗？Broadcast?`,
            default: true
        }])
        toBroadcast = answers.broadcast
    }
    if (toBroadcast) {
        Cache.saveUnbroadcast(unBroadcast)
        var timenow = new Date().getTime()
        fs.writeFileSync(`bsvup.${timenow}.tasks`, JSON.stringify(tasks))
        console.log(`Tasks is saved at bsvup.${timenow}.tasks`)
        fs.writeFileSync(`bsvup.${timenow}.txs`, JSON.stringify(unBroadcast.map(tx=>tx.toString())))
        console.log(`TX(s) for the tasks is saved at bsvup.${timenow}.txs`)
        console.log("开始广播，可能需要花费一段时间，等几个区块。\r\nStart Broadcasting, it may take a while and several block confirmation...")
        broadcast()
    }
}

async function charge() {
    //qrcode.generate(`bitcoin://${loadKey().toAddress().toString()}?sv&message=destine`)
    var key = await loadKey()
    showQR(key)
}

function showQR(key) {
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

async function transfer() {
    var address = (program.address) ? program.address : null
    if (!address) {
        address = (await inquirer.prompt([{
            type: 'string',
            name: 'address',
            message: "请输入要转账到的地址是 Transfer target："
        }])).address
    }
    if (!bsv.Address.isValid(address)) {
        console.log("无效地址！ Invalid Address!")
        return
    }
    var key = await loadKey()
    await api.transfer(address, key)
}

async function loadKey(){
    var password
    if (program.password) {
        password = program.password
    } else {
        var answers = await inquirer.prompt([ { 
            type: 'password', 
            name: 'password', 
            default: "",
            message: "请输入密码以解锁私钥 Password to unlock private key:", 
        }])
        password = answers.password
    }
    return Cache.loadKey(password)
}
async function saveKey(privkey){
    var password
    if (program.password) {
        password = program.password
    } else {
        var answers = await inquirer.prompt([ { 
            type: 'password', 
            name: 'password', 
            default: "",
            message: "请设置密码以加密私钥 Set key unlock password:", 
        }])
        password = answers.password
    }
    Cache.saveKey(privkey, password)
}
