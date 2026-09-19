/*
 * 服务端 API 客户端
 * ------------------------------------------------------------
 * 爆炸的计算和出图都在服务端。
 * 浏览器不再持有 engine/archash.js —— 它只负责问、显示、发交易。
 *
 * 三个端点：
 *   GET  /api/card/<hash>  幂等，只算不签名，用来在页面上展示这个宇宙是什么
 *   POST /api/bang         会签名，拿到的 sig 才能让合约把 cardHash 写上链
 *   POST /api/intervene    干预。preview:true 时只算不签名、不落盘，给沙盒用（intervenePreview）；
 *                          不带 preview 时要 tokenId + oldCardHash，回来的 sig 能上链（intervene）
 * 分开是有意的：光看看不该消耗签名额度，也不该留下"引爆过"的痕迹。
 */
(function (root) {
  'use strict';
  var CFG = root.ARCBANG_CONFIG || {};
  var BASE = (CFG.apiBase != null ? CFG.apiBase : '/api').replace(/\/$/, '');

  function req(path, opts) {
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 15000);
    var o = opts || {};
    if (ctl) o.signal = ctl.signal;
    return fetch(BASE + path, o).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) {
          var e = new Error((j && j.error) || ('HTTP ' + r.status));
          e.status = r.status;
          /* 机读的错误码要带上来。沙盒要靠它把"这一格推不动"（NO_MOVE）
             和"真出错了"分开说 —— 只看中文消息就得靠正则猜，改一个字就散架。 */
          if (j && j.code) e.code = j.code;
          throw e;
        }
        return j;
      });
    }).then(function (v) { clearTimeout(timer); return v; },
            function (e) { clearTimeout(timer); throw e; });
  }

  var cache = {};                                   // card 对同一版本是纯函数
  /* 版本号必须进 URL。服务端对带对版本的请求发 immutable 缓存头，
     所以升级推导之后旧 URL 自然失效，客户端不会抱着旧宇宙不放。
     启动时问一次 /health 拿版本，拿不到就先按 '0' 走（服务端会回 no-cache）。 */
  var VER = null;
  function withVer(path) {
    return path + (path.indexOf('?') >= 0 ? '&' : '?') + 'v=' + (VER || '0');
  }
  var verReady = null;
  function ensureVer() {
    if (VER) return Promise.resolve(VER);
    if (!verReady) {
      verReady = req('/health').then(function (h) {
        VER = h.derivationVersion + '-' + h.cardShape;
        return VER;
      }, function () { return '0'; });
    }
    return verReady;
  }

  /* v2 摘要绑 msg.sender：地址一律小写 0x + 40 hex。非法就当没带，不把脏值发出去。 */
  function putMinter(body, v) {
    var m = String(v == null ? '' : v).toLowerCase();
    if (/^0x[0-9a-f]{40}$/.test(m)) body.minter = m;
  }

  root.MirrorBnbApi = {
    base: BASE,
    health: function () { return req('/health'); },

    /** 只看不签：拿这个哈希对应的宇宙是什么 */
    card: function (hash) {
      var k = String(hash).toLowerCase();
      if (cache[k]) return Promise.resolve(cache[k]);
      return ensureVer().then(function () {
        return req(withVer('/card/' + k)).then(function (j) { cache[k] = j; return j; });
      });
    },

    /** 真引爆：服务端会核对这是不是 BNB 链上的区块，通过才签名。
        extra：可选的附加字段（目前只有推广留痕的 {ref, minter}，
）。服务端对不认识/不合法的字段一律静默忽略，
        所以这里也不做校验——校验做两遍只会两边漂移。

        **两个调用点，返回的 cardHash 有两种用途**：
          web/arc-ui.js  起爆页的铸造按钮 —— 拿 sig 去 bangSigned()，铸完就结束
          web/intervene.js「铸下并拯救」—— 铸完之后
            **同一个 cardHash 直接当下一步的 oldCardHash** 交给 /api/intervene。
            那一步刻意不去链上 cardOf(tokenId) 现读：铸造那笔刚上链，
            公开节点的最新块未必跟上，读回来可能还是零章。 */
    bang: function (hash, extra) {
      var body = { blockHash: hash };
      if (extra) for (var k in extra) {
        if (!extra.hasOwnProperty(k) || extra[k] == null) continue;
        if (k === 'minter') putMinter(body, extra[k]);
        else body[k] = extra[k];
      }
      return req('/bang', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
    },

    /**
     * 干预预览：把「推了哪些格」发过去，服务端算新参数、新结局和费用。
     * @param hash        区块哈希（基准宇宙）
     * @param ops         [{key, dir, steps}]，dir 是 ±1
     * @param wantSuggest 顺带要一条「下一格该推谁」
     *
     * 为什么非得走服务端：一格的长度 = 步长 × 该参数的生存半径，
     * 而半径表是整套推导里唯一藏得住的东西。
     * 客户端自己算就得在站点包里带一份表，等于原样发给每个访客。
     *
     * preview:true —— 服务端只算不签名、不落盘。沙盒本来就是"不花钱、不上链"，
     * 真要烧币时走的是另一条路（带 tokenId + oldCardHash，回来的 sig 才能上链）。
     * 费用**永远**用服务端返回的 costBang，客户端不许自报。
     */
    intervenePreview: function (hash, ops, wantSuggest) {
      return req('/intervene', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          blockHash: String(hash).toLowerCase(),
          ops: ops || [],
          preview: true,
          suggest: !!wantSuggest
        })
      }).then(function (j) {
        return {
          params: (j.card && j.card.params) || null,
          outcome: (j.card && j.card.outcome) || null,
          card: j.card || null,
          costBang: j.costBang || '0',
          /* 上链用的位移记录（0x hex，5 字节一条）。真烧币时它要**原样**传给
             合约 intervene(…, ops, sig)：合约不解析它，只把 keccak256(ops) 签进摘要，
             所以这里改一个字节，链上就 BadSig。
             它跟 costBang 走同一条路回来，顺手接住 —— 客户端只负责搬运，不负责解释。 */
          ops: j.ops || null,
          suggest: j.suggest || null
        };
      });
    },

    /**
     * 真干预（**拯救**）：把沙盒里推出来的这串位移，写到你已经持有的那枚原生 NFT 上。
     * 与 intervenePreview 是**两条路**，差别不是一个开关那么轻：
     *   预览   不带 tokenId、不签名、不落盘 —— 拿它上不了链，所以随便点
     *   这条   带 tokenId + oldCardHash，回来的 sig 才是合约认的那份，
     *          前端把它转给 MirrorUniverse.intervene()，费用 100% 销毁、
     *          烧量永久累加进 burnedOn[id]（合约里那个唯一稀缺的指标）
     *
     * @param hash        区块哈希（这枚 NFT 的宇宙）
     * @param tokenId     要改写哪一枚。**必须是数字或数字字符串** —— 服务端明着挡 null，
     *                    因为 BigInt(null) 会安安静静给出 0n，等于替用户挑了 token #0 去签名
     * @param oldCardHash 这枚 NFT **此刻链上的**参数章，从 cardOf(tokenId) 现读。
     *                    服务端会验它必须能从这个 blockHash 复算出来（原生指纹或干预存档），
     *                    对不上就 400 + code:'CARD_MISMATCH' —— 那是修过的嫁接洞，别绕
     *                    （绕过去等于「一次最便宜的干预把废卡刷成 S」）
     * @param ops         [{key, dir, steps}]，与预览同一份，服务端自己查半径算距离
     *
     * 返回原样透出：{card, cardHash, costBang, deadline, sig, ops, rarity, signer, art}。
     * 其中 ops 是**上链用的**位移记录（0x hex，5 字节一条），必须一字不差地转给合约 ——
     * 合约不解析它，只把 keccak256(ops) 签进摘要，改一个字节就 BadSig。
     * 费用**绝不带上**：服务端对带 cost / costBang 的请求明着 400
     * 。
     */
    intervene: function (hash, tokenId, oldCardHash, ops, extra) {
      var body = {
        blockHash: String(hash).toLowerCase(),
        tokenId: String(tokenId),
        oldCardHash: String(oldCardHash).toLowerCase(),
        ops: ops || []
      };
      if (extra && extra.minter != null) putMinter(body, extra.minter);
      return req('/intervene', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
    },

    /* ---------------------------------------------------------------- 积分榜与白名单
       四条路都在 server/allowlist.js。要点：
         · **名单是积分榜算出来的**（登记 / 转发 / 邀请 / 分享四项），不是人工一个个批；
         · board 只给地址缩写 —— 名次和分数是公开规则，完整地址不是；
         · status 的积分明细 / 登记码 / 下一步只回**问的那个地址自己的**；
         · 要签的那句话由 status 给（message 字段），**客户端绝不自己拼** ——
           两边各拼一次早晚差一个换行，然后 verifyMessage 恢复出另一个地址，
           用户看到的是「签名是另一个地址签的」，从签名本身完全看不出错在哪。 */
    allowlistStatus: function (addr) {
      var q = /^0x[0-9a-fA-F]{40}$/.test(String(addr || '')) ? '?addr=' + String(addr).toLowerCase() : '';
      return req('/allowlist/status' + q);
    },

    /** 公开积分榜。top 最多 1000，服务端和这里都夹一道。 */
    allowlistBoard: function (top) {
      var n = Math.max(1, Math.min(Math.floor(Number(top)) || 50, 1000));
      return req('/allowlist/board?top=' + n);
    },

    /** @param sig 对 status().message **原文**的 personal_sign 结果 */
    allowlistRegister: function (address, xHandle, sig, ref) {
      var body = { address: String(address).toLowerCase(), xHandle: String(xHandle || ''), sig: sig };
      if (ref) body.ref = String(ref).toUpperCase();
      return req('/allowlist/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
    },

    /**
     * 「引爆并分享」那一分。站内广播按钮生成链接时打一发，同地址同一天只计一次。
     * sig 是**登记时那一次**签名（浏览器留着复用），不再弹钱包 —— 用户拍板「别每次弹」。
     * 拿不到 sig（没登记过 / 换了浏览器）就根本不该调这条：调了只会 400/403。
     */
    allowlistShare: function (address, sig, hash) {
      return req('/allowlist/share', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          address: String(address).toLowerCase(),
          sig: sig,
          hash: String(hash).toLowerCase()
        })
      });
    },

    /**
     * 引爆计分：真引爆出一张卡就打一发，每次 +1 分（每日与预热期各有上限，服务端夹）。
     * 和 allowlistShare 用的是同一把会话签名，不弹钱包。
     * 服务端会**回头找链核这个哈希**，所以调用方不必也不能自己判真假。
     */
    allowlistBang: function (address, sig, hash) {
      return req('/allowlist/bang', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          address: String(address).toLowerCase(),
          sig: sig,
          hash: String(hash).toLowerCase()
        })
      });
    },

    /** NFT 图的地址。图也在服务端出，浏览器不画 */
    artUrl: function (hash, withParams) {
      return BASE + withVer('/art/' + String(hash).toLowerCase() + '.svg' + (withParams ? '?p=1' : ''));
    },
    version: function () { return ensureVer(); }
  };
}(typeof self !== 'undefined' ? self : this));
