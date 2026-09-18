/*
 * cardpool —— 把「算一张参数卡」搬到 worker 线程里
 * ------------------------------------------------------------
 * 为什么要这东西：一张卡 = 一次完整的引擎模拟（本机实测 3.5–8 ms，
 * VPS 的 E3-1230 单核约 15–20 ms）。它原来在**请求线程**上同步跑，
 * 意味着 4 核的机器上只有 1 核在算，而且这几十毫秒里整个进程
 * 连一个 /api/health 都答不了 —— 限流、签名、出图、市场索引全被堵住。
 *
 * 分工（这条线不许含糊）：
 *   主线程   HTTP、限流（ratelimit.js 的内存桶）、缓存落盘、签名、链上调用
 *   worker   纯计算：blockHash → derive → simulate → card + cardHash
 * worker 一个字节都不写盘、不认识 req/res、不碰限流桶 —— 它只是一台算卡机器。
 *
 * **结果必须与主线程同步算逐字节相同**。为此 worker 返回的不是对象而是
 * JSON.stringify 之后的**字符串**：
 *   · postMessage 走结构化克隆，虽然 Node 的实现保序，但那是实现细节不是契约；
 *     缓存文件是要按字节比对的（cardHash 签在里头），不能押在实现细节上。
 *   · 主线程拿到字符串直接 cachePut，再 JSON.parse 给调用方 ——
 *     落盘的字节 = worker 里 JSON.stringify 的字节，与同步路径同一行代码产出。
 * 浮点在同一个进程版本、同一台机器上是确定的，worker 与主线程用的是同一份 V8。
 *
 * 关掉它：ARCBANG_CARD_WORKERS=0 → 退回主线程同步算，老行为逐字节不变。
 * 这条退路不是摆设 —— 崩溃自保、线程起不来、池子被判定不健康时都会自动走它。
 */
'use strict';
const os = require('os');
const { Worker, isMainThread, parentPort } = require('worker_threads');
const { envInt } = require('./envint.js');

/* ================================================================ worker 端
   new Worker(__filename) 把这个文件本身当入口再加载一遍，靠 isMainThread 分岔。
   单独开一个 cardworker.js 也行，但两个文件必须同时改、同时对齐协议，
   而协议只有三个字段 —— 放一起更难写歪。 */
if (!isMainThread && parentPort) {
  /* 只在 worker 里 require 引擎：主线程那份是 index.js 顶上已经加载好的，
     这里再 require 一次会白白多占一份内存（每个 worker 自己一个 V8 隔离区，
     引擎 + 参数表实测约 60–80 MB，见 README 的部署一节）。 */
  const { buildCard } = require('./card.js');
  parentPort.on('message', (msg) => {
    if (!msg || typeof msg !== 'object' || msg.id == null) return;
    /* 测试钩子：空转 N 毫秒，用来验「超时 → 杀线程 → 重建」这条路真的能走通。
       必须 ARCBANG_CARD_TEST_HOOKS=1 才认，而且 dispatch 只在 _spin() 提交的
       任务上带这个字段 —— HTTP 那头的请求体永远碰不到它。 */
    if (msg.__spinMs && process.env.ARCBANG_CARD_TEST_HOOKS === '1') {
      const until = Date.now() + Number(msg.__spinMs);
      while (Date.now() < until) { /* 就是要占死这条线程 */ }
      parentPort.postMessage({ id: msg.id, ok: true, json: 'spun' });
      return;
    }
    try {
      const built = buildCard(msg.blockHash, msg.blockNumber == null ? null : msg.blockNumber);
      parentPort.postMessage({ id: msg.id, ok: true, json: JSON.stringify(built) });
    } catch (e) {
      /* 抛错不许把 worker 带走：坏哈希是常事（比如引擎给出合约不认的结局），
         报回主线程让它照旧答 500/400，线程继续服务下一个。 */
      parentPort.postMessage({ id: msg.id, ok: false, error: String((e && e.message) || e) });
    }
  });
  parentPort.postMessage({ ready: true });
  return;                                    // CommonJS 的模块包装是个函数，顶层 return 合法
}

/* ================================================================ 主线程端 */

/** 默认线程数：留一个核给主线程（HTTP + 签名 + 索引），再封到 4 个 —— 4 核机器上刚好。 */
const DEFAULT_WORKERS = Math.min(4, Math.max(1, os.cpus().length - 1));
/** 0 = 关掉线程池，退回主线程同步算（老行为）。上限 16，防止有人手抖写个 999。 */
const WORKERS = envInt(process.env.ARCBANG_CARD_WORKERS, DEFAULT_WORKERS, 0, 16);
/** 排队上限。满了直接 503「服务器正忙」——排到天荒地老的请求对谁都没好处：
    客户端早断了，我们还在为它烧 CPU，后面正常的人继续排。 */
const QUEUE_MAX = envInt(process.env.ARCBANG_CARD_QUEUE_MAX, 500, 1, 100000);
/** 单张卡超时。正常 3–20 ms，30 s 意味着线程真的卡死了（死循环 / 被换页拖垮）。 */
const TASK_TIMEOUT_MS = envInt(process.env.ARCBANG_CARD_TIMEOUT_MS, 30000, 1000, 600000);
/** 一分钟内崩这么多次就判定池子不健康，整池关掉退回同步 —— 宁可慢，不要循环重启。 */
const CRASH_FUSE = 8;

/** 主线程同步算（关池 / 自保退回 / 线程起不来时走这条）。与 worker 里同一行代码。 */
let _buildCard = null;
function buildHere(blockHash, blockNumber) {
  if (!_buildCard) _buildCard = require('./card.js').buildCard;
  return JSON.stringify(_buildCard(blockHash, blockNumber == null ? null : blockNumber));
}

/** slot = 一个 worker 的位置：{ worker, task, timer }。task 非空 = 正在算。 */
const slots = [];
/** 等着进 worker 的任务。长度 >= QUEUE_MAX 时新请求直接 503。 */
const queue = [];
let disabled = WORKERS === 0;
let seq = 0;
const crashTimes = [];
const stats = { built: 0, failed: 0, timeouts: 0, crashes: 0, fallback: 0, queuePeak: 0, spawned: 0 };

function poolError(msg, code) {
  const e = new Error(msg);
  e.code = code;
  return e;
}

/* ---------------------------------------------------------------- 线程的生死 */

function spawnSlot() {
  const slot = { worker: null, task: null, timer: null };
  let w;
  try {
    w = new Worker(__filename);
  } catch (e) {
    noteCrash('线程起不来：' + ((e && e.message) || e));
    return null;
  }
  stats.spawned++;
  slot.worker = w;
  /* 闲着的 worker 必须 unref：否则它会把事件循环钉住，`node selftest.js`
     跑完不退出（自检末尾有言在先：不许用 process.exit 强杀）。
     派活时再 ref 回来 —— 有任务在算的时候进程当然不能退。 */
  w.unref();
  w.on('message', (m) => onMessage(slot, m));
  w.on('error', (e) => onDown(slot, '线程出错：' + ((e && e.stack) || (e && e.message) || e)));
  w.on('exit', (code) => onDown(slot, '线程退出（code ' + code + '）'));
  slots.push(slot);
  return slot;
}

function dropSlot(slot) {
  const i = slots.indexOf(slot);
  if (i >= 0) slots.splice(i, 1);
}

/** 线程没了（崩溃 / 被超时杀掉 / 自己退出）。手上那份活**回队重来一次**。 */
function onDown(slot, why) {
  if (slot.gone) return;                      // error 之后必然跟一个 exit，只处理一次
  slot.gone = true;
  dropSlot(slot);
  if (slot.timer) { clearTimeout(slot.timer); slot.timer = null; }
  const task = slot.task;
  slot.task = null;
  if (task) {
    /* 只重试一次。这活本身要是能把线程弄死（比如喂出 OOM），
       无限重排会把整池挨个拖死 —— 第二次就如实报错。 */
    if (!task.retried) {
      task.retried = true;
      queue.unshift(task);
      noteCrash(why + '  正在算的那张卡回队重算：' + String(task.blockHash).slice(0, 12) + '…');
    } else {
      stats.failed++;
      noteCrash(why + '  这张卡重试过一次仍然崩，放弃：' + String(task.blockHash).slice(0, 12) + '…');
      task.reject(poolError('算这张参数卡时线程崩了，请稍后再试', 'CARD_WORKER_DOWN'));
    }
  } else if (!slot.killed) {
    noteCrash(why);
  }
  /* 重建是惰性的：pump() 发现没空闲线程、且数量没到上限时自己会起新的。
     这里不主动补 —— 没活的时候不需要线程，省得崩溃风暴里疯狂起线程。 */
  pump();
}

function noteCrash(why) {
  stats.crashes++;
  const now = Date.now();
  crashTimes.push(now);
  while (crashTimes.length && now - crashTimes[0] > 60000) crashTimes.shift();
  console.error('[cardpool] ' + why + (crashTimes.length > 1 ? '（近一分钟第 ' + crashTimes.length + ' 次）' : ''));
  if (!disabled && crashTimes.length >= CRASH_FUSE) {
    disabled = true;
    console.error('[cardpool] 一分钟内崩了 ' + crashTimes.length + ' 次，关闭线程池，退回主线程同步算卡'
      + '（老行为，慢但稳）。重启进程可恢复。');
    for (const s of slots.slice()) killSlot(s);
    flushSyncSoon();
  }
}

function killSlot(slot) {
  slot.killed = true;
  /* **立刻**把它从 slots 里摘掉，不能等 exit 事件。terminate() 是异步的，
     这中间 pump() 会把它当成「空闲线程」再派一张卡过去，那张卡跟着一起陪葬
     （能靠回队重算救回来，但白烧一次往返，日志里还多一条吓人的崩溃）。 */
  dropSlot(slot);
  try { slot.worker.terminate(); } catch (e) { /* 已经没了就算了 */ }
}

/* ---------------------------------------------------------------- 派活 */

function onMessage(slot, m) {
  if (!m || m.ready) return;                  // 启动握手，不是结果
  const task = slot.task;
  if (!task || task.id !== m.id) return;      // 超时已经收尾过的迟到答复，丢掉
  if (slot.timer) { clearTimeout(slot.timer); slot.timer = null; }
  slot.task = null;
  slot.worker.unref();
  if (m.ok) { stats.built++; task.resolve(m.json); }
  else { stats.failed++; task.reject(new Error(m.error || '算卡失败')); }
  pump();
}

function dispatch(slot, task) {
  task.id = ++seq;
  slot.task = task;
  slot.worker.ref();
  slot.timer = setTimeout(() => {
    stats.timeouts++;
    const t = slot.task;
    slot.task = null;
    slot.timer = null;
    console.error('[cardpool] 算卡超过 ' + Math.round(TASK_TIMEOUT_MS / 1000) + ' s，杀掉线程重建：'
      + String(t && t.blockHash).slice(0, 12) + '…');
    /* 线程卡在同步计算里，除了 terminate 没有别的办法把它叫醒。
       杀掉会触发 exit → onDown，但 slot.task 已经清了，不会重排这张卡
       （它已经烧过 30 秒，再排一次只是把下一个人也拖下水）。 */
    killSlot(slot);
    if (t) t.reject(poolError('算这张参数卡超时了，请稍后再试', 'CARD_TIMEOUT'));
  }, TASK_TIMEOUT_MS);
  if (slot.timer.unref) slot.timer.unref();   // 有 worker 被 ref 着，进程不会提前退
  const msg = { id: task.id, blockHash: task.blockHash, blockNumber: task.blockNumber };
  if (task.spinMs) msg.__spinMs = task.spinMs;              // 只有 _spin() 提交的任务才有
  slot.worker.postMessage(msg);
}

function pump() {
  while (queue.length) {
    if (disabled) return flushSyncSoon();
    let slot = null;
    for (const s of slots) if (!s.task) { slot = s; break; }
    if (!slot && slots.length < WORKERS) slot = spawnSlot();
    if (!slot) {
      /* 一个线程都起不来（容器把 worker_threads 禁了之类）→ 关池退回同步，
         绝不能让请求永远排在一条没人取的队上。 */
      if (!slots.length) {
        disabled = true;
        console.error('[cardpool] 一个算卡线程都起不来，退回主线程同步算卡');
        return flushSyncSoon();
      }
      return;                                 // 全忙，等谁算完了再 pump
    }
    dispatch(slot, queue.shift());
  }
}

/** 退回同步时把队里积压的算掉。一次一个、夹在 setImmediate 之间，
    别在一个 tick 里连算 500 张（那等于把服务停几秒）。 */
let flushing = false;
function flushSyncSoon() {
  if (flushing) return;
  flushing = true;
  const step = () => {
    const t = queue.shift();
    if (!t) { flushing = false; return; }
    stats.fallback++;
    try { t.resolve(buildHere(t.blockHash, t.blockNumber)); }
    catch (e) { stats.failed++; t.reject(e); }
    setImmediate(step);
  };
  setImmediate(step);
}

/* ---------------------------------------------------------------- 对外 */

/**
 * 算一张卡，拿到的是 **JSON 字符串**（不是对象）——落盘的字节与它逐字节相同。
 * @param {string} blockHash
 * @param {number|null} blockNumber 不参与派生；缓存里一律存 null（见 index.js cardFor 的长注释）
 * @returns {Promise<string>}
 */
function buildCardJSON(blockHash, blockNumber) {
  if (disabled) {
    /* 老行为：就在这儿同步算完，只是包了个 resolved promise 交出去。 */
    stats.fallback++;
    try { return Promise.resolve(buildHere(blockHash, blockNumber)); }
    catch (e) { return Promise.reject(e); }
  }
  if (queue.length >= QUEUE_MAX) {
    return Promise.reject(poolError('服务器正忙（排队算的宇宙太多了），十几秒后再试', 'POOL_BUSY'));
  }
  return new Promise((resolve, reject) => {
    queue.push({
      blockHash, blockNumber: blockNumber == null ? null : blockNumber,
      resolve, reject, retried: false, id: 0
    });
    if (queue.length > stats.queuePeak) stats.queuePeak = queue.length;
    pump();
  });
}

/** 配置的线程数（0 = 关）。启动日志和 /api/health 用它。 */
function size() { return disabled ? 0 : WORKERS; }
/** 现在是不是真的在用线程池（崩溃自保之后会变 false）。 */
function enabled() { return !disabled; }
function snapshot() {
  return {
    workers: size(), configured: WORKERS, alive: slots.length, busy: slots.filter((s) => s.task).length,
    queued: queue.length, queueMax: QUEUE_MAX, timeoutMs: TASK_TIMEOUT_MS, enabled: !disabled,
    built: stats.built, failed: stats.failed, timeouts: stats.timeouts, crashes: stats.crashes,
    fallback: stats.fallback, queuePeak: stats.queuePeak, spawned: stats.spawned
  };
}
/** 收尾（压测脚本 / 将来做优雅退出时用）。线程本来就是 unref 的，不叫它也不挡进程退出。 */
async function shutdown() {
  const all = slots.slice();
  for (const s of all) killSlot(s);
  await Promise.all(all.map((s) => s.worker.terminate().catch(() => {})));
}

/* ---------------------------------------------------------------- 测试钩子
   崩溃重建与超时这两条路只有把线程真的弄死才测得到，所以留两个下划线开头的入口。
   btc.js 的 _setFetch / _reset 是同一个路数：生产代码不碰，自检拿它造现场。 */
/** 随便杀掉一个还活着的线程，模拟 OOM / 段错误。返回杀没杀到。 */
function _killOne(busyOnly) {
  const s = slots.find((x) => (busyOnly ? !!x.task : true));
  if (!s) return false;
  s.killed = false;                          // 当成真崩溃处理：走 onDown 的重排与计数
  try { s.worker.terminate(); } catch (e) { return false; }
  return true;
}
/** 提交一个「空转 ms 毫秒」的假任务（要 ARCBANG_CARD_TEST_HOOKS=1）。 */
function _spin(ms) {
  return new Promise((resolve, reject) => {
    queue.push({ blockHash: '0x' + '00'.repeat(32), blockNumber: null, spinMs: ms, resolve, reject, retried: true, id: 0 });
    pump();
  });
}

module.exports = {
  buildCardJSON, size, enabled, stats: snapshot, shutdown,
  WORKERS, QUEUE_MAX, TASK_TIMEOUT_MS,
  _killOne, _spin
};
