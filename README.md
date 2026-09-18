# ARCBANG

**Every Arc block hash is a universe. Detonate it, mint it.**
**每一个 Arc 区块哈希都是一个宇宙。免费引爆，喜欢再铸。**

[arcbang.xyz](https://arcbang.xyz) · Arc L1 (chainId 5042, gas is paid in USDC) · 1,387 universes · no token, ever

> **Status (2026-09-18): pre-launch.** The site shows a holding page while the mint is reworked into an
> allowlisted warm-up. A first mainnet deployment (`0xd5b4…61ea` / `0x73cc…85a8`) was retired after a script
> drained 5 free mints in its first 20 minutes; the next deployment adds a server-signed free/paid flag so
> free mints go only to allowlisted addresses. Everything else — detonation, the 3D simulator, the sandbox — is done.
>
> **状态（2026-09-18）：上线前。** 站点挂着「测试中」页，铸造改成白名单预热后再开。第一次主网部署
> （`0xd5b4…61ea` / `0x73cc…85a8`）上线 20 分钟被脚本薅走 5 枚免费额度，已作废；下一次部署把「免费/付费」
> 标志签进服务端签名，免费只给白名单地址。引爆、3D 模拟器、沙盒都已完成。

---

## What this is

A 32-byte Arc block hash is read as a full set of physical constants — 23 of them, including the number
of spatial dimensions — and a physics engine runs that universe from its singularity to heat death.
Most universes die: no stable orbits, no atoms, no chemistry, no stars. About 1.5% can grow observers.

Detonating is free, needs no wallet, and happens in your browser. If you want to keep one, mint it as an
NFT on Arc, where gas is USDC. **1,387 universes in total** (13.787 billion years of cosmic age, one NFT
per ten million years); the first 387 are free, one per address; 1 USDC after that. Hard-coded cap, no
function can raise it.

The derivation is integer-only (keccak256 + modular arithmetic), so the same hash produces a
byte-identical universe on every machine. That is the whole point: you never have to trust the site.

```bash
node tools/recompute.js 0x<block hash>     # rebuild that universe from the hash alone, zero dependencies
node tools/verify-onchain.js <tokenId>     # read that NFT back from Arc (two eth_calls) and diff outcome / rarity / cardHash, zero dependencies
```

`verify-onchain.js` takes the contract address and RPC from `web/config.arc.js` (override with `--contract` / `--rpc`
or `ARCBANG_CONTRACT` / `ARCBANG_RPC`); add `--block` to also check the stored hash against the block at that height.
Until `ArcUniverse` is deployed the address is empty and the command says so and exits 0.

**There is no token.** No BANG, no mint rewards, no referral payouts, no naming, no crafting. The only
things on chain are the NFT (`ArcUniverse`) and an optional marketplace (`ArcMarket`).

## 这是什么

一个 32 字节的 Arc 区块哈希被读成一整套物理常数（23 个，包括空间有几个维度），物理引擎把这个宇宙
从奇点推演到热寂。绝大多数宇宙是死的：没有稳定轨道、没有原子、没有化学、没有恒星。约 1.5% 能长出观察者。

引爆免费、不用钱包、全在浏览器里算完。想留下哪一个，就在 Arc 上把它铸成 NFT —— Arc 的 gas 就是 USDC。
**总量 1,387 枚**（宇宙年龄 137.87 亿年，一枚一千万年）；前 387 枚免费，每个地址一枚；之后 1 USDC 一枚。
上限写死在合约里，没有任何函数能改。

推导全程纯整数（keccak256 + 取模），所以同一个哈希在任何机器上算出来逐字节相同 ——
这正是重点：你从头到尾都不需要相信这个站。

**没有代币。** 没有 BANG、没有铸造奖励、没有邀请返利、没有命名、没有造物。
链上只有两个合约：宇宙本身（`ArcUniverse`）和一个可选的市场（`ArcMarket`）。

---

## Run it locally / 本地跑

Node ≥ 18 (20+ recommended). No build server, no framework, no bundler.

```bash
npm i                                     # only devDependency: terser (for the minified build)
node build.js                             # engine + ui + index.html → dist/mirror.html  (single file, zero network)
node web/build-web.js --site arc          # + the ARCBANG layer         → web/dist-arc/   (the actual site)
node tools/check-dist.js                  # pre-publish self-check
```

`dist/mirror.html` is the offline build: one file, no external request of any kind, open it from disk and
it runs. `web/dist-arc/` is the site: same simulator plus block fetching, wallet and minting.

`dist/mirror.html` 是离线版：单个文件，零外部请求，从磁盘直接打开就能跑。
`web/dist-arc/` 是站点版：同一个模拟器，外加取区块、钱包和铸造。

### Tests / 测试

```bash
node engine/test.js               # engine derivation + evolution        313 checks
node engine/planet.test.js        # planet / surface generation          152 checks
node tools/recompute.test.js      # the standalone recompute tool agrees with the server's card builder
node tools/verify-onchain.test.js # selector + struct decoding + end-to-end diff against a fake node (offline)
node tools/check-dist.js          # build artefacts

cd contracts && npm i
node tools/compile.js src/ArcUniverse.sol && node tools/arctest.js        #  47 checks, real bytecode on a local EVM
node tools/compile.js src/ArcMarket.sol   && node tools/arcmarket-test.js #  98 checks

cd server && npm i --omit=dev     # ethers + resvg; needed by the contract tests and the API
node selftest.js                  # server end-to-end (needs a configured api.env)
```

The contract tests are not mocks: `contracts/tools/compile.js` compiles with solc-js and
`contracts/tools/evmlib.js` deploys the real bytecode into a local EVM, then calls it.

合约测试不是桩：`compile.js` 用 solc-js 编译，`evmlib.js` 把**真字节码**部署进本地 EVM 再调用。

### Verification / 验证

Last full run of this tree (2026-09-17, Node 24, Windows):

| Command | Result |
|---|---|
| `node build.js` | ✓ `dist/mirror.html` 3.05 MB · `dist/mirror.min.html` 1.84 MB |
| `node web/build-web.js --site arc` | ✓ `web/dist-arc/` · 13 HTML pages incl. `/en/` |
| `node tools/check-dist.js` | **20 passed, 0 failed** |
| `node engine/test.js` | **313 passed, 0 failed** |
| `node engine/planet.test.js` | **152 passed, 0 failed** |
| `node tools/recompute.test.js` | **10 passed, 0 failed** |
| `node tools/verify-onchain.test.js` | **41 passed, 0 failed** |
| `contracts` · `node tools/arctest.js` | **47 passed, 0 failed** (ArcUniverse, 18,407 B runtime) |
| `contracts` · `node tools/arcmarket-test.js` | **98 passed, 0 failed** (ArcMarket, 5,846 B runtime) |

---

## Contracts / 合约

| | Address | |
|---|---|---|
| `ArcUniverse` (ERC-721 + ERC-2981) | `0x…` **not deployed yet / 尚未部署** | [src/ArcUniverse.sol](contracts/src/ArcUniverse.sol) |
| `ArcMarket` | `0x…` **not deployed yet / 尚未部署** | [src/ArcMarket.sol](contracts/src/ArcMarket.sol) |
| Signer (server) | `0x…` **not deployed yet / 尚未部署** | readable on chain via `signer()` |

Once deployed, the addresses live in exactly one place the site reads — [`web/config.arc.js`](web/config.arc.js) —
and must match `ARCBANG_CONTRACT` in the server's env: the mint signature binds the contract address, so a
mismatch fails on chain rather than silently minting into the wrong place.

部署之后，地址只有一个真相来源：[`web/config.arc.js`](web/config.arc.js)，并且必须和服务端 env 里的
`ARCBANG_CONTRACT` 一致 —— 签名把合约地址绑死了，两边不一致时链上直接拒绝，不会悄悄铸错地方。

No proxy, no upgrade path, no `selfdestruct`, no `delegatecall`, no pause switch. `MINT_CAP = 1387` is
`constant`: **a supply cap you can change is not a supply cap.**

没有代理、没有升级通道、没有 `selfdestruct`、没有 `delegatecall`、没有暂停开关。
`MINT_CAP = 1387` 是 `constant`：**可调的总量上限不是总量上限。**

---

## Deploy / 部署

**Contracts.** Open `deploy.html` on the built site and sign with your own wallet — the private key never
goes into a file, an env var, or this repository. The wizard fetches the bytecode next to the page,
shows you its keccak prefix, and walks the two deployments plus the wiring calls.
Command line alternative: [`contracts/tools/deploy-arc.mjs`](contracts/tools/deploy-arc.mjs).
Measured cost on Arc mainnet: **0.088 USDC** for `ArcUniverse` (4,377,954 gas at the fixed 20 gwei base fee).

**合约**：在站点上打开 `deploy.html`，用自己的钱包签 —— 私钥不进文件、不进环境变量、不进这个仓库。
向导会现取同目录的字节码、显示它的 keccak 前缀，带着走完两次部署和接线。命令行版见
[`contracts/tools/deploy-arc.mjs`](contracts/tools/deploy-arc.mjs)。主网实测部署费 **0.088 USDC**。

**Site.** [`web/nginx-arcbang.xyz.conf`](web/nginx-arcbang.xyz.conf) is the server config;
[`web/deploy-site-arc.sh`](web/deploy-site-arc.sh) ships `web/dist-arc/` to it
(set `ARCBANG_HOST=root@your-server` — the default in the script is a placeholder).

**API.** `server/` is a plain Node HTTP service (no framework) that computes the card, signs the mint and
renders the art. Copy [`server/api.env.example`](server/api.env.example), fill it in, `chmod 600`,
and install [`server/arcbang-api.service`](server/arcbang-api.service). The signing key lives in
its own `600` file outside the repository and is read via `ARCBANG_SIGNER_KEY_FILE` — never from the env
file, never from the code.

**服务端**：`server/` 是一个不用框架的 Node HTTP 服务：算卡、签名、出图。
拷 `server/api.env.example` 填好、`chmod 600`，再装那个 systemd unit。
签名私钥单独放一个 600 权限的文件，在仓库之外，靠 `ARCBANG_SIGNER_KEY_FILE` 读进来 —— 不写 env，不写代码。

---

## Layout / 目录

```
engine/      物理引擎：哈希 → 23 个参数 → 从奇点到热寂。纯整数推导，零依赖，Node 与浏览器共用
ui/          模拟器界面：N 体、行星表面、高维投影、参数面板
index.html   模拟器的底稿（build.js 把 engine/ 与 ui/ 内联进它）
web/         站点层：取块、钱包、铸造、市场、文档页、各语言词典、构建脚本
contracts/   ArcUniverse（NFT）与 ArcMarket，以及跑真字节码的本地 EVM 测试
server/      算卡 / 签名 / 出图的 API（配置全走 ARCBANG_* 环境变量，见 server/api.env.example）
tools/       复算工具、产物自检
specs/       规格：arcbang-v1.md 是这个站的总纲
```

## License

[AGPL-3.0](LICENSE). The engine, the contracts and the site are all under it.

## Security

Vulnerabilities: **admin@arcbang.xyz**. See [SECURITY.md](SECURITY.md).

## 本地开发 · Local development

```bash
npm ci && (cd server && npm ci) && (cd contracts && npm ci)
npm run build     # 单文件模拟器 + Arc 站 + 产物自检
npm run api       # 本地 API（读 Arc 主网区块；合约地址是占位，铸造不可用）
npm run dev       # http://localhost:8795/
npm test          # 引擎 / 服务端 / 两份合约的全部测试
```

This repository is the single source of truth for ARCBANG. It builds and runs on its own.
