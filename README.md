## BSVUP

A file upload tool.

### Background

It's a long time since first file uploaded to bitcoin.

What's more, with D/B/Bcat protocol, we can define an onchain file system.

This tool is an implement of D/B/Bcat protocol, so that you can upload files/directory to blockchain as filesystem.

### Installation and Usage

#### Command line

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

#### Browser



### Tasks

There are dependency between TXs, you need to know TXID before building D/Bcat TXs, but you still need to know how big exactly TX size is, so that you can split utxos for each TX.

Task is what bsvup use to descript TX.





