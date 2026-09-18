// 本地 API：读 Arc 主网区块，合约地址是占位（铸造不可用，引爆/沙盒/出图都正常）。
// 签名私钥是众所周知的测试值，**只用于本机预览**；线上实例的密钥放在服务器的 env 文件里，永远不进仓库。
const path = require('path'), os = require('os');
/* 环境变量旧名兼容（BNBBANG_* → ARCBANG_*）：shell 里还按旧名导的照样生效 */
require('../server/env-compat.js');
const tmp = path.join(os.tmpdir(), 'arcbang-dev');
Object.assign(process.env, {
  ARCBANG_CHAIN_ID: process.env.ARCBANG_CHAIN_ID || '5042',
  ARCBANG_RPC: process.env.ARCBANG_RPC || 'https://rpc.mainnet.arc.io',
  ARCBANG_CONTRACT: process.env.ARCBANG_CONTRACT || '0x0000000000000000000000000000000000000001',
  ARCBANG_SIGNER_KEY: process.env.ARCBANG_SIGNER_KEY || '0x' + '11'.repeat(32),
  ARCBANG_STORE: process.env.ARCBANG_STORE || path.join(tmp, 'store'),
  ARCBANG_CACHE: process.env.ARCBANG_CACHE || path.join(tmp, 'cache'),
  ARCBANG_PUBLIC_BASE: process.env.ARCBANG_PUBLIC_BASE || 'http://localhost:8795',
  /* 站名 / 链名 / 仓库地址：线上那份 env 里写的就是这三个值（server/api.env.example）。
     本地不配的话分享页 /s/<高度> 会退回历史默认值（BNBBANG / BNB block），
     跟线上对不上，看着像 bug。这里给上同一组。 */
  ARCBANG_BRAND: process.env.ARCBANG_BRAND || 'ARCBANG',
  ARCBANG_CHAIN_WORD: process.env.ARCBANG_CHAIN_WORD || 'Arc',
  ARCBANG_REPO_URL: process.env.ARCBANG_REPO_URL || 'https://github.com/q3579338/arcbang'
});
/* server/index.js 只在被直接运行时才监听端口（require.main 判断），所以这里起一个子进程 */
const child = require('child_process').spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { stdio: 'inherit', env: process.env });
child.on('exit', (code) => process.exit(code == null ? 1 : code));
