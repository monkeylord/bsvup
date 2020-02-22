## BSVUP

A file upload tool.

### Background

It's a long time since first file uploaded to bitcoin.

What's more, with D/B/Bcat protocol, we can define an onchain file system.

This tool is an implement of D/B/Bcat protocol, so that you can upload files/directory to blockchain as filesystem.

### Usage

bsvup provides a module for node/browser and a command line tool.

#### As Module

##### Install

**Node**

~~~bash
npm install bsvup
~~~

**Browser**

bsvup depends on bsv library

~~~html
<script src="https://unpkg.com/bsv@1.0.0/bsv.min.js"></script>
<script src="https://unpkg.com/bsvup/bsvup.min.js"></script>
~~~

##### Upload with Private Key

~~~javascript
var privkey = bsv.PrivateKey("Your key")
var uploader = new bsvup()
var TXs = await uploader.addData("some blog", "blog1")
						.addData("['blog1']", "index.json")
						.setPrivkey(privkey)
						.buildTXs()

console.log(`The file (for example, the second one) can be accessed from https://bico.media/${privkey.toAddress()}/index.json`)
~~~

##### Upload with External Signer

~~~javascript
// Signer Example
var privkey = bsv.PrivateKey("Your key")
var address = privkey.toAddress()
var signer = async function (tx) {
    // Do some check before signing
    var TX = bsv.Transaction(tx)
    var signedTX = TX.sign(privkey)
    if (!signedTX.isFullySigned()){
       throw new Error('Not successful signed, privkey and utxos may be unmatched') 
    }
    return signedTX
}

// Use external signer
var uploader = new bsvup()
var TXs = await uploader.addData("some blog", "blog1")
						.addData("['blog1']", "index.json")
						.setAddress(customAddress)
						.setSigner(customSignerFunc)
						.buildTXs()
~~~

##### Upload Files

~~~javascript
// File Data Example
var fileData1 = {
    buf: Buffer.from("<p>Hello BSVUP1</p>"),
    mime: "text/html",
    dKey: "foo/file1.txt"
}
var fileData2 = {
    buf: Buffer.from("<p>Hello BSVUP2</p>"),
    mime: "text/html",
    dKey: "foo/file2.txt"
}

// Upload
var privkey = bsv.PrivateKey("Your key")
var uploader = new bsvup()
var TXs = await uploader.addFile(fileData1)
						.addFile(fileData2)
						.setAddress(customAddress)
						.setSigner(customSignerFunc)
						.buildTXs()

console.log(`The file (for example, the second one) can be accessed from https://bico.media/${privkey.toAddress()}/foo/file2.txt`)
~~~

##### Point D Path to a TX Already Onchain

~~~javascript
// A B/Bcat TX which already exist on chain 
var txid = "068562c97621b4e6921fe9cf43c3ed8caa88ccb048744964339485894b091ded"

// Upload
var privkey = bsv.PrivateKey("Your key")
var uploader = new bsvup()
var TXs = await uploader.addDPath("test.html", txid)
						.addFile({buf: Buffer.from("<p>Hello BSVUP1</p>"),
                                  mime: "text/html",
                                  dKey: "foo/file1.txt"
                                 })
						.addData("['blog1']", "index.json")
						.setAddress(customAddress)
						.setSigner(customSignerFunc)
						.buildTXs()

console.log(`The file (for example, the first one) can be accessed from https://bico.media/${privkey.toAddress()}/test.html`)
~~~

##### Use Provided UTXOs

~~~javascript
// UTXOs Example
var utxos = [{
  txid: '8d29c20fd086ad5aa859037eb9bb25aaf6ebb84706965c4c662bbdb40e9cba02',
  vout: 0,
  address: '1A2JN4JAUoKCQ5kA4pHhu4qCqma8jZSU81',
  script: '76a91462f80abdd278a255e40c1a1f8dd89555de19a07688ac',
  satoshis: 10000000
}]

// Upload
var privkey = bsv.PrivateKey("Your key")
var uploader = new bsvup()
var TXs = await uploader.addData("some blog", "blog1")
						.addData("['blog1']", "index.json")
						.addUtxos(utxos)
						.setPrivkey(privkey)
						.buildTXs()
~~~

#### As Command Line Tool

##### Install

Once installed, you can use `bsvup` in  command line.

~~~bash
npm install -g bsvup
~~~

##### Initialize

Switch your working directory to the directory you want to upload, and do the initialization.

This will create a `.bsv` folder, initialize caches and generate key.

~~~bash
bsvup init
~~~

##### Provide satoshis as fees

We  cannot upload things to blockchain without spending some fees, so you should charge some satoshis to the key generated above.

~~~bash
bsvup charge
~~~

##### Upload current working directory

The tool can upload any folder or file to blockchain. By default, it upload the current working folder.

 Bsvup will search and cache exist onchain files to minimize uploading.

~~~bash
bsvup upload
~~~

##### Transfer the remaining fees out

It's unnecessary, but you can do that if you want to get remaining satoshis out.

~~~bash
bsvup transfer
~~~

### How Does It Works

There are dependency between TXs, you need to know TXID before building D/Bcat TXs, but you still need collect informations to build TX. So bsvup defines `tasks` to handle this.

#### Logic

bsvup collect neccesary informations first, then create tasks, then split utxos for each task, then execute tasks to build TXs.

~~~mermaid
graph TD
Collect[Collect Informations]
Task[Create Tasks]
Fund[Split Utxos for Each Task]
Sign[Execute Task and Build TX]
Collect --> Task --> Fund --> Sign
~~~



bsvup also implement some api, like get/broadcast TX from remote api.

#### Tasks

There are basically 3 status of task:

`prepend`: necessary information collected, but still depend on other tasks

`ready`: no dependencies, can build and signed TX.

`pended`: TX is built and signed

~~~mermaid
graph TD
prepend --Not All Dependencies Pended--> prepend
prepend --Is All Dependencies Pended--> ready
ready --Build TX and Sign--> pended
~~~

There won't be deadlock, because Bcat/D protocol doesn't have circular dependency.





