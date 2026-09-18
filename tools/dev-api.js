// 本地 API：读 Arc 主网区块，合约地址是占位（铸造不可用，引爆/沙盒/出图都正常）。
// 签名私钥是众所周知的测试值，**只用于本机预览**；线上实例的密钥放在服务器的 api.env.arc 里，永远不进仓库。
const path = require('path'), os = require('os');
const tmp = path.join(os.tmpdir(), 'arcbang-dev');
Object.assign(process.env, {
  BNBBANG_CHAIN_ID: process.env.BNBBANG_CHAIN_ID || '5042',
  BNBBANG_RPC: process.env.BNBBANG_RPC || 'https://rpc.mainnet.arc.io',
  BNBBANG_CONTRACT: process.env.BNBBANG_CONTRACT || '0x0000000000000000000000000000000000000001',
  BNBBANG_SIGNER_KEY: process.env.BNBBANG_SIGNER_KEY || '0x' + '11'.repeat(32),
  BNBBANG_STORE: process.env.BNBBANG_STORE || path.join(tmp, 'store'),
  BNBBANG_CACHE: process.env.BNBBANG_CACHE || path.join(tmp, 'cache'),
  BNBBANG_PUBLIC_BASE: process.env.BNBBANG_PUBLIC_BASE || 'http://localhost:8795',
  BNBBANG_BRAND: process.env.BNBBANG_BRAND || 'ARCBANG',
  BNBBANG_CHAIN_WORD: process.env.BNBBANG_CHAIN_WORD || 'Arc',
  BNBBANG_REPO_URL: process.env.BNBBANG_REPO_URL || 'https://github.com/q3579338/arcbang'
});
/* server/index.js 只在被直接运行时才监听端口（require.main 判断），所以这里起一个子进程 */
const child = require('child_process').spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { stdio: 'inherit', env: process.env });
child.on('exit', (code) => process.exit(code == null ? 1 : code));
