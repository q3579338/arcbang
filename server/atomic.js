/*
 * 原子写盘 —— 一份实现，三个地方用
 * ------------------------------------------------------------
 * 原来这段只在 index.js 里有一份。分享图缓存（png.js）和短码映射表（refcode.js）
 * 也必须原子写，抄第三遍不如提出来：抄出来的那几份迟早会漏掉 unlink 或者
 * 少一次 rename，而这类 bug 只在"同一秒两个请求写同一个文件"时才露头。
 *
 * writeFileSync 是「先把文件截成 0 再往里灌」，中间那一小段时间文件是半截的。
 * 先写临时文件再 rename：rename 在同一个文件系统上是原子的（Windows 上 Node 走
 * MoveFileEx + REPLACE_EXISTING，同样是原子替换），读的人要么看到旧的完整内容、
 * 要么看到新的完整内容，永远看不到半截。
 *
 * 临时文件名带 pid + 自增序号：同一个进程里两个请求同时写同一个目标文件时，
 * 两份临时文件不能重名，否则 A 的 rename 会把 B 写了一半的内容搬过去。
 */
'use strict';
const fs = require('fs');

let tmpSeq = 0;

/**
 * @param {string} file 目标路径（目录必须已经存在）
 * @param {string|Buffer} val
 */
function writeAtomic(file, val) {
  const tmp = file + '.' + process.pid + '-' + (tmpSeq++) + '.tmp';
  fs.writeFileSync(tmp, val);
  try { fs.renameSync(tmp, file); }
  catch (e) { try { fs.unlinkSync(tmp); } catch (_) { /* 临时文件清不掉就算了 */ } throw e; }
}

module.exports = { writeAtomic };
