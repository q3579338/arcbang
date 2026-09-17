// 编译 src/*.sol：solc-js，纯 Node，Windows 上不需要 Foundry
// 用法：node tools/compile.js            编译 src 下所有 .sol
//       node tools/compile.js src/X.sol  只编译一个
// 产物（contracts/out/）：
//   <名字>.abi.json / <名字>.bytecode.hex / <名字>.runtime.hex   每个合约一套
//   abi.json / bytecode.hex / runtime.hex                        MirrorUniverse 的别名（deploy.html 在用）
const fs = require('fs');
const path = require('path');
const solc = require('solc');

const SRC = path.join(__dirname, '../src');
const OUT = path.join(__dirname, '../out');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const files = process.argv[2]
  ? [path.resolve(process.argv[2])]
  : fs.readdirSync(SRC).filter((f) => f.endsWith('.sol')).sort().map((f) => path.join(SRC, f));

const sources = {};
files.forEach((f) => { sources[path.basename(f)] = { content: fs.readFileSync(f, 'utf8') }; });

const input = {
  language: 'Solidity',
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    // 曲线路径要同时持有两个 20 元数组，旧管线会 stack too deep；
    // viaIR 是 solc 官方给的解法，编译慢一点但代码生成更好
    viaIR: true,
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } }
  }
};

const out = JSON.parse(solc.compile(JSON.stringify(input)));
let hardFail = false;
(out.errors || []).forEach((e) => {
  if (e.severity === 'error') hardFail = true;
  console.log(`[${e.severity}] ${e.formattedMessage.trim()}\n`);
});
if (hardFail) process.exit(1);

const LIMIT = 24576;          // EIP-170 部署上限
let overLimit = false;
Object.keys(out.contracts).sort().forEach((file) => {
  Object.keys(out.contracts[file]).forEach((nm) => {
    const c = out.contracts[file][nm];
    const init = c.evm.bytecode.object;
    const runtime = c.evm.deployedBytecode.object;
    if (!init || c.abi.length === 0) return;             // interface / 纯内部 library，不用落盘
    const size = init.length / 2;
    const runtimeSize = runtime.length / 2;
    if (runtimeSize > LIMIT) overLimit = true;
    console.log(
      `✓ ${nm.padEnd(16)} 部署字节码 ${String(size).padStart(6)} B   ` +
      `运行时 ${String(runtimeSize).padStart(6)} B   ` +
      (runtimeSize > LIMIT ? '← 超过 24576 的部署上限！' : `余量 ${LIMIT - runtimeSize} B`)
    );
    fs.writeFileSync(path.join(OUT, nm + '.abi.json'), JSON.stringify(c.abi, null, 1));
    fs.writeFileSync(path.join(OUT, nm + '.bytecode.hex'), init);
    fs.writeFileSync(path.join(OUT, nm + '.runtime.hex'), runtime);
    if (nm === 'MirrorUniverse') {                       // 老名字，web/deploy.html 在用
      fs.writeFileSync(path.join(OUT, 'abi.json'), JSON.stringify(c.abi, null, 1));
      fs.writeFileSync(path.join(OUT, 'bytecode.hex'), init);
      fs.writeFileSync(path.join(OUT, 'runtime.hex'), runtime);
    }
  });
});
console.log('产物 → ' + OUT);
process.exit(overLimit ? 1 : 0);
