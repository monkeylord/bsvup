## 文件同步上链工具

### 背景

链上文件系统已经提出多时。

基于BitDB、B系列协议、D协议，可以实现一套文件系统。

本工具目的即是这样的实现。

### 安装与使用

#### 安装

~~~bash
npm install -g bsvup
~~~

#### 初始化

首先进入目标目录

~~~bash
bsvup init
~~~

#### 提供上链花费

~~~bash
bsvup charge
~~~

#### 上链

~~~bash
bsvup upload
~~~

#### 转出余额

~~~bash
bsvup transfer
~~~

### 流程图

上传流程如下

~~~mermaid
graph TB
init[Init]
load[Load Key]
checkExistFile[Check Exist Files]
createFileTask[Create file tasks]
checkExistMap[Check Exist Map]
createMapTask[Create map tasks]
utxos[Split utxos to fund tasks]
handleFileTask
updateMapTask
handleMapTask
broadcastTX
wait[Wait for enough satoshis]
recharge[Recharge QR code]

init-->load
init-->checkExistFile
init-->checkExistMap
checkExistFile-->createFileTask
checkExistMap-->createMapTask
load-->utxos
utxos-->wait
wait-->recharge
recharge-->wait
createFileTask-->utxos
createMapTask-->utxos
wait-->handleFileTask
handleFileTask-->updateMapTask
updateMapTask-->handleMapTask
handleMapTask-->broadcastTX

~~~

下载流程如下

~~~mermaid
graph TB
start
getAddr[Get folder address]
getMap[Get map files, or all D]
getFiles[Get all files]

start-->getAddr
getAddr-->getMap
getMap-->getFiles
~~~

### 任务

TX的构建被作为任务

任务和任务之间具有关联：首先，他们需要的UTXO往往需要裂解自相同的最初一批UTXO。其次，他们之间是有先后的依赖顺序的。





