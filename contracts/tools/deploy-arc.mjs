/*
 * 把 ARCBANG 的两个合约部署到 Arc（specs/arcbang-v1.md §七）：
 *   1. ArcUniverse —— 宇宙 NFT
 *   2. ArcMarket   —— 挂单簿。构造参数是**刚部署的那个 ArcUniverse 地址**，
 *      而且它是 immutable：顺序不能反，也不能事后接线。
 *
 * 为什么不用 web/deploy.html：那个向导是六合约一套（BangToken → Universe → Market → 三个金库 → 接线），
 * ARCBANG 没有代币、没有金库、没有接线，用它等于在一堆不存在的步骤里找那两步。
 *
 * 用法（私钥只从环境变量读，不接受命令行参数 —— 命令行会进 shell 历史）：
 *
 *   # 先干跑：只估 gas 和余额，不发任何交易
 *   ARC_KEY=0x… node tools/deploy-arc.mjs --dry
 *
 *   # 测试网（chainId 5042002，水龙头 https://faucet.circle.com/ 免费领）
 *   ARC_KEY=0x… node tools/deploy-arc.mjs --testnet --signer 0x… --base-uri https://…/api/token/
 *
 *   # 主网（chainId 5042）。多一道 --yes 才真发：主网的 gas 是真 USDC
 *   ARC_KEY=0x… node tools/deploy-arc.mjs --mainnet --signer 0x… --base-uri https://…/api/token/ --yes
 *
 * 另外三个可选开关：
 *   --treasury 0x…   市场手续费的收款地址（不给就是部署者自己）
 *   --universe 0x…   宇宙已经在链上了，这一趟只补市场（跳过第 1 步）
 *   --no-market      只部署宇宙，市场以后再说
 *
 * 部署完会打印要抄走的东西：两个合约地址 → web/config.arc.js 的 contract / market、
 * 服务端 /etc/bnbbang/api.env 的 BNBBANG_CONTRACT、以及部署高度（给索引器当起点）。
 * **两边地址必须一致**：签名把合约地址绑进摘要，不一致时链上一律 BadSig，而报错看不出是地址对不上。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { Wallet, JsonRpcProvider, ContractFactory, Contract, formatUnits, isAddress } =
  require(path.join(__dirname, '../../server/node_modules/ethers'));

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };

const NET = has('--mainnet')
  ? { id: 5042n, name: 'Arc 主网', rpc: 'https://rpc.mainnet.arc.io', explorer: 'https://explorer.arc.io' }
  : { id: 5042002n, name: 'Arc 测试网', rpc: 'https://rpc.testnet.arc.io', explorer: 'https://explorer.testnet.arc.io' };
const DRY = has('--dry');
const SIGNER = val('--signer');
const BASE_URI = val('--base-uri');
const TREASURY = val('--treasury');
const UNIVERSE = val('--universe');          // 已在链上的 ArcUniverse：这一趟只补市场
const NO_MARKET = has('--no-market');

const key = process.env.ARC_KEY;
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
  console.error('缺 ARC_KEY（0x 开头的 64 位十六进制私钥），只从环境变量读');
  console.error('PowerShell:  $env:ARC_KEY="0x…"; node tools/deploy-arc.mjs --dry');
  process.exit(1);
}
if (!DRY && !has('--testnet') && !has('--mainnet')) {
  console.error('必须显式写 --testnet 或 --mainnet，不给默认值 —— 部错链的代价是整套签名作废');
  process.exit(1);
}
if (has('--mainnet') && !DRY && !has('--yes')) {
  console.error('主网要多加一道 --yes：这一发花的是真 USDC');
  process.exit(1);
}
if (SIGNER && !isAddress(SIGNER)) { console.error('--signer 不是合法地址'); process.exit(1); }
if (TREASURY && !isAddress(TREASURY)) { console.error('--treasury 不是合法地址'); process.exit(1); }
if (UNIVERSE && !isAddress(UNIVERSE)) { console.error('--universe 不是合法地址'); process.exit(1); }
if (UNIVERSE && NO_MARKET) { console.error('--universe 和 --no-market 一起用等于什么都不部署'); process.exit(1); }

const OUT = path.join(__dirname, '../out');
const abi = JSON.parse(fs.readFileSync(path.join(OUT, 'ArcUniverse.abi.json'), 'utf8'));
const bytecode = '0x' + fs.readFileSync(path.join(OUT, 'ArcUniverse.bytecode.hex'), 'utf8').trim();
const mktAbi = JSON.parse(fs.readFileSync(path.join(OUT, 'ArcMarket.abi.json'), 'utf8'));
const mktBytecode = '0x' + fs.readFileSync(path.join(OUT, 'ArcMarket.bytecode.hex'), 'utf8').trim();
const mktRuntimeLen = fs.readFileSync(path.join(OUT, 'ArcMarket.runtime.hex'), 'utf8').trim().length / 2;

const provider = new JsonRpcProvider(NET.rpc, Number(NET.id), { staticNetwork: true });
const wallet = new Wallet(key, provider);

console.log('链      ' + NET.name + '（chainId ' + NET.id + '）  ' + NET.rpc);
console.log('部署者  ' + wallet.address);

const net = await provider.getNetwork();
if (net.chainId !== NET.id) {
  console.error('节点报的 chainId 是 ' + net.chainId + '，与要部署的链对不上 —— 停');
  process.exit(1);
}

const bal = await provider.getBalance(wallet.address);
/* Arc 的 baseFee 实测是固定的 20 gwei（回看 1024 块 min 20.000 / max 20.117，即使 138 个块用量过半也不涨），
   优先费为 0。eth_gasPrice 报的是「最近成交价」——主网上线当天有人按 280 gwei 乱付，
   它就跟着报 280，照它付等于多花 14 倍。这里按 baseFee 的两倍封顶、优先费 0，实付就是 baseFee。 */
const latestBlock = await provider.getBlock('latest');
const base = latestBlock.baseFeePerGas ?? (await provider.getFeeData()).gasPrice ?? 0n;
const fee = { maxFeePerGas: base * 2n, maxPriorityFeePerGas: 0n };
const gp = base;
console.log('余额    ' + formatUnits(bal, 18) + ' USDC');
console.log('baseFee ' + formatUnits(gp, 9) + ' gwei（按它付；上限 2 倍，优先费 0）');

const factory = new ContractFactory(abi, bytecode, wallet);
const mktFactory = new ContractFactory(mktAbi, mktBytecode, wallet);

/* ---- 估费。两个合约分开估，再相加 ---- */
let uniGas = 0n;
if (!UNIVERSE) {
  const deployTx = await factory.getDeployTransaction();
  uniGas = await provider.estimateGas({ ...deployTx, from: wallet.address });
  console.log('ArcUniverse gas ' + uniGas + ' → 约 ' + formatUnits(uniGas * gp, 18) + ' USDC');
}

/* ArcMarket 的构造函数要求 nft_ 是个**有代码的地址**，所以干跑时估不了真的那一笔 ——
   链上还没有 ArcUniverse。两条路：
     a) 找一个链上确实有代码的地址当替身，让节点真估一次（数字是准的）；
     b) 一个替身都找不到，就按 EVM 的收费规则自己算：
        21000 + calldata + EIP-3860 的 initcode 字费 + 代码存储费 200/字节 + 构造函数执行的余量。
        标成「粗估」，不冒充实测。 */
function calldataCost(hex) {
  const b = Buffer.from(hex.replace(/^0x/, ''), 'hex');
  let g = 0n;
  for (const x of b) g += x === 0 ? 4n : 16n;
  return g;
}
async function estimateMarket(nftStandIn) {
  const tx = await mktFactory.getDeployTransaction(nftStandIn, TREASURY || wallet.address);
  return { gas: await provider.estimateGas({ ...tx, from: wallet.address }), exact: true };
}
async function marketGasEstimate() {
  /* 替身候选：--universe 给的地址优先；其次是 Arc 上的系统合约 EIP-2935 区块哈希史，
     再次是各链通用的 Multicall3。只要其中一个有代码，估出来的就是真数字。 */
  const cands = [UNIVERSE,
    '0x0000F90827F1C53a10cb7A02335B175320002935',
    '0xcA11bde05977b3631167028862bE2a173976CA11'].filter(Boolean);
  for (const a of cands) {
    try {
      if ((await provider.getCode(a)) !== '0x') return await estimateMarket(a);
    } catch { /* 这个候选不行，换下一个 */ }
  }
  const init = mktBytecode.replace(/^0x/, '');
  const rough = 21000n
    + calldataCost(init) + 64n * 16n                       // initcode + 两个构造参数
    + 2n * BigInt(Math.ceil(init.length / 2 / 32))         // EIP-3860
    + 200n * BigInt(mktRuntimeLen)                         // 代码存储费
    + 90000n;                                              // 三次 SSTORE + 一次 EXTCODESIZE 的余量
  return { gas: rough, exact: false };
}

let mktGas = 0n;
if (!NO_MARKET) {
  const m = await marketGasEstimate();
  mktGas = m.gas;
  console.log('ArcMarket   gas ' + mktGas + ' → 约 ' + formatUnits(mktGas * gp, 18) + ' USDC'
    + (m.exact ? '' : '（粗估：链上还没有可当替身的合约地址，节点估不了）'));
}

const gas = uniGas + mktGas;
const cost = gas * gp;
console.log('合计     gas ' + gas + ' → 约 ' + formatUnits(cost, 18) + ' USDC');
if (bal < cost * 2n) {
  console.error('余额不够（按两倍部署成本留的余量）。测试网去 https://faucet.circle.com/ 领；主网走 https://portal.arc.io');
  if (!DRY) process.exit(1);
}

if (DRY) {
  console.log('\n--dry：到此为止，一笔交易都没发。');
  console.log('真部署再加 --testnet / --mainnet' + (has('--mainnet') ? ' --yes' : '') + '，并带上 --signer 与 --base-uri。');
  process.exit(0);
}

let addr = UNIVERSE;
let rec = null;
if (UNIVERSE) {
  if ((await provider.getCode(UNIVERSE)) === '0x') {
    console.error('--universe 给的地址在这条链上没有代码 —— 停（市场的 nft 是 immutable，部错就废了）');
    process.exit(1);
  }
  console.log('\n沿用已在链上的 ArcUniverse  ' + UNIVERSE);
} else {
  console.log('\n正在部署 ArcUniverse…');
  const c0 = await factory.deploy(fee);
  rec = await c0.deploymentTransaction().wait();
  addr = await c0.getAddress();
  console.log('✓ ArcUniverse  ' + addr);
  console.log('  区块 ' + rec.blockNumber + '   ' + NET.explorer + '/address/' + addr);
}
const c = new Contract(addr, abi, wallet);

/* ---- 市场。构造参数是上面那个宇宙地址，而且 immutable：顺序不能反。 ---- */
let mktAddr = null;
if (!NO_MARKET) {
  console.log('\n正在部署 ArcMarket…（nft = ' + addr + '）');
  const m = await mktFactory.deploy(addr, TREASURY || wallet.address, fee);
  const mrec = await m.deploymentTransaction().wait();
  mktAddr = await m.getAddress();
  console.log('✓ ArcMarket    ' + mktAddr);
  console.log('  区块 ' + mrec.blockNumber + '   ' + NET.explorer + '/address/' + mktAddr);
  console.log('  国库 ' + (TREASURY || wallet.address) + (TREASURY ? '' : '（没给 --treasury，用的是部署者自己）'));
  console.log('  手续费 1%，硬上限 10%；版税按 ArcUniverse 的 ERC-2981 走（默认 5%，截断线也是 10%）');
}

/* signer 不设 = 铸造整条路是关着的（bangSigned 第一行就 revert）。
   这是有意的默认：合约先上链、服务端确认好再开闸，中间那段时间没人能铸。 */
if (SIGNER) {
  const tx = await c.setSigner(SIGNER, fee);
  await tx.wait();
  console.log('✓ setSigner    ' + SIGNER);
} else {
  console.log('! signer 没设 —— 铸造现在是关着的。服务端起来之后跑：');
  console.log('    cast send ' + addr + ' "setSigner(address)" <服务端签名地址>');
}
if (BASE_URI) {
  const tx = await c.setBaseURI(BASE_URI, fee);
  await tx.wait();
  console.log('✓ setBaseURI   ' + BASE_URI);
} else {
  console.log('! baseURI 没设 —— tokenURI 退回合约内的链上 SVG（能看，只是没有服务端出的图）');
}

console.log('\n抄走这几样：');
console.log('  web/config.arc.js   contract: \'' + addr + '\'');
if (mktAddr) console.log('  web/config.arc.js   market:   \'' + mktAddr + '\'');
console.log('  服务端 api.env      BNBBANG_CONTRACT=' + addr);
if (rec) console.log('  索引器起点          BNBBANG_INDEX_FROM=' + rec.blockNumber);
console.log('\n两边地址必须一致：签名把合约地址绑进摘要，不一致时链上一律 BadSig。');
