/*
 * web/arc-chain.js —— BNB 链访问层（只在站点版加载，离线单文件版没有这一层）
 * ------------------------------------------------------------
 * 零依赖：不引 ethers/web3，只用 fetch + window.ethereum，
 * ABI 编解码手写（我们只需要 5 个函数和 1 个事件，不值得为此拖进一个库）。
 * keccak256 复用 engine/archash.js 里那份（函数选择器和事件 topic 都要它）。
 *
 * 读链走公开 RPC（不需要钱包，未连钱包也能浏览）；写链走小狐狸。
 *
 * API：
 *   CHAIN                       链参数（全部从 web/config.arc.js 的 chain 块派生）
 *   chainName()                 界面上给人看的链名（跟随当前语言）
 *   rpc(method, params)         直连公开 RPC
 *   latestBlockNumber()  blockHashOf(n)  blockAt(n)
 *   hasWallet()  connect()  account()  ensureChain()
 *   call(sig, args)             eth_call（只读，走公开 RPC）
 *   tokenOfHash(h)  price()  totalSupply()  ownerOf(id)
 *   bang(h, blockNumber, outcome, cid, valueWei)   写链，返回 txHash
 *   waitTx(hash)                轮询回执
 *   recentBangs(limit)          最近铸造的宇宙（按 totalSupply 倒序枚举，不查日志）
 */
(function (root) {
  'use strict';

  var K = root.MirrorKeccak;                        // 只要 keccak256 算选择器；推导在服务端，不打进站点包
  var CFG = root.ARCBANG_CONFIG || {};

  /* ---------------------------------------------------------- 链身份
     唯一真相来源是 web/config.arc.js 的 chain 块。
     这一层只做派生：id → hex、currency 字符串 → 钱包要的 nativeCurrency 结构、
     isTestnet → 水龙头给不给。**这个文件里不再有任何写死的链名或浏览器域名。**
     老的 config.js 没有 chain 块时：rpc 像主网就按主网身份兜底，否则按测试网；
     isTestnet 另行推断，不用测试网兜底对象上的 true 去给主网贴标签。
     控制台要喊一句 —— 换链的人必须看得见。 */
  var CHAIN_FALLBACK = {
    id: 97, name: 'BSC 测试网', nameEn: 'BSC Testnet',
    explorer: 'https://testnet.bscscan.com', currency: 'tBNB', isTestnet: true
  };
  var CHAIN_MAINNET_FALLBACK = {
    id: 56, name: 'BSC 主网', nameEn: 'BSC Mainnet',
    explorer: 'https://bscscan.com', currency: 'BNB', isTestnet: false
  };
  function rpcJoin(cfg) {
    var rpcs = (cfg && cfg.rpc) || [];
    return (rpcs && rpcs.join) ? rpcs.join(' ') : String(rpcs || '');
  }
  function rpcLooksTestnet(cfg) { return /testnet/i.test(rpcJoin(cfg)); }
  function rpcLooksMainnet(cfg) {
    var s = rpcJoin(cfg);
    return /bsc-dataseed|bsc-mainnet/i.test(s) && !/testnet/i.test(s);
  }
  /* isTestnet 门控：主网不能误显示「测试资产无价值」，测试网也不能把提示丢掉。
     字面 true/false 永远优先；漏写时按 id / 货币 / 浏览器 / 链名推断；
     整块缺席时再看 rpc —— 绝不用测试网兜底对象上的 isTestnet:true 去给主网贴标签。 */
  function resolveIsTestnet(c, missing, cfg) {
    if (c && c.isTestnet === true) return true;
    if (c && c.isTestnet === false) return false;
    var id = c && c.id != null ? Number(c.id) : NaN;
    if (id === 56) return false;
    if (id === 97) return true;
    if (c && String(c.currency || '') === 'tBNB') return true;
    if (c && /testnet/i.test(String(c.explorer || ''))) return true;
    if (c && /测试网|testnet/i.test(String(c.name || '') + ' ' + String(c.nameEn || ''))) return true;
    if (missing) {
      if (rpcLooksTestnet(cfg)) return true;
      if (rpcLooksMainnet(cfg)) return false;
    }
    return false;
  }
  function chainCfg() {
    var raw = CFG.chain;
    var missing = !raw;
    if (missing && !root.__bnbbangChainWarned) {
      root.__bnbbangChainWarned = 1;
      if (root.console && root.console.warn) {
        root.console.warn('[config] web/config.arc.js 里没有 chain 块，按 RPC 推断链身份 —— 换链请改那一块');
      }
    }
    var c = raw || {};
    var fb = (missing && rpcLooksMainnet(CFG) && !rpcLooksTestnet(CFG))
      ? CHAIN_MAINNET_FALLBACK : CHAIN_FALLBACK;
    return {
      id: c.id != null ? Number(c.id) : fb.id,
      name: c.name || fb.name,
      nameEn: c.nameEn || c.name || fb.nameEn,
      explorer: String(c.explorer || fb.explorer).replace(/[/]+$/, ''),
      currency: c.currency || fb.currency,
      isTestnet: resolveIsTestnet(c, missing, CFG)
    };
  }
  var CC = chainCfg();

  var CHAIN = {
    id: CC.id,
    hex: '0x' + CC.id.toString(16),
    /* name 是**钱包注册用的规范链名**（wallet_addEthereumChain 的 chainName），
       所以取英文名：小狐狸的网络列表是全局的，不跟着页面语言走，摆个中文名字很怪。
       给人看的那个名字走 chainName()。 */
    name: CC.nameEn,
    currency: { name: CC.currency, symbol: CC.currency, decimals: 18 },
    /* rpc 是 config.js 里独立的一个键，chain 块不管它 —— 换链两处都要改。
       这份兜底只在 config.js 整个读不到时才轮得上。 */
    rpc: (CFG.rpc && CFG.rpc.length) ? CFG.rpc : [
      'https://data-seed-prebsc-1-s1.bnbchain.org:8545',
      'https://data-seed-prebsc-2-s1.bnbchain.org:8545',
      'https://bsc-testnet-rpc.publicnode.com'
    ],
    explorer: CC.explorer,
    isTestnet: CC.isTestnet,
    /* 水龙头只有测试网才有。主网上摆一个「免费领币」的链接就是诈骗话术。 */
    faucet: CC.isTestnet ? 'https://www.bnbchain.org/en/testnet-faucet' : ''
  };

  /** 界面上给人看的链名：中文态用 chain.name，英文态用 chain.nameEn。 */
  function chainName() {
    return (root.MirrorI18n && root.MirrorI18n.lang() === 'en') ? CC.nameEn : CC.name;
  }
  var CONTRACT = CFG.contract || '';                // 部署后填进 web/config.arc.js

  /* ============================================================ RPC
     2026-09-02 改：① 每次 fetch 8 秒超时 —— 国内被 DNS 污染的节点一挂就是十几秒，页面整段「读不到」；
     ② 同一时刻发出的调用合并成一个 JSON-RPC 批量请求（最多 40 条）—— 市场页首屏几十个 eth_call
     原来是几十个请求，publicnode 按 IP 限流，一被拒就整页翻车；
     ③ 失败转移按**条**做：节点打不通 → 整批换下一个节点；节点答了但某条是 revert → 那条直接报错
     （换节点也是同样答案）；其它错误（limit exceeded 之类）→ 只把那几条送去下一个节点。
     节点表里可以有相对地址（'/api/rpc'，同源中继），fetch 原样吃。 */
  var rpcId = 0, rpcIdx = 0;
  var RPC_TIMEOUT_MS = 8000, RPC_BATCH_MAX = 40;
  var rpcPending = [], rpcFlushTimer = null;
  /* 合并窗口：setTimeout(0) 能把同一轮事件循环里（含 await 之后）发出的调用都收进一批；
     没有 setTimeout 的环境（自检的 vm 沙箱）退到微任务，语义一样只是窗口更窄。 */
  var rpcDefer = (typeof setTimeout === 'function')
    ? function (f) { return setTimeout(f, 0); }
    : function (f) { Promise.resolve().then(f); return 1; };
  function rpc(method, params) {
    return new Promise(function (resolve, reject) {
      rpcPending.push({ method: method, params: params || [], resolve: resolve, reject: reject });
      if (!rpcFlushTimer) rpcFlushTimer = rpcDefer(rpcFlush);
    });
  }
  function rpcFlush() {
    rpcFlushTimer = null;
    var batch = rpcPending.splice(0, RPC_BATCH_MAX);
    if (rpcPending.length) rpcFlushTimer = rpcDefer(rpcFlush);
    if (batch.length) rpcSend(batch, 0);
  }
  function rpcFetch(url, payload) {
    var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = (ctl && typeof setTimeout === 'function') ? setTimeout(function () { ctl.abort(); }, RPC_TIMEOUT_MS) : null;
    var opt = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) };
    if (ctl) opt.signal = ctl.signal;
    return fetch(url, opt).then(function (r) {
      if (!r.ok) throw new Error('RPC HTTP ' + r.status);
      return r.json();
    }).then(function (j) { if (timer) clearTimeout(timer); return j; },
            function (e) { if (timer) clearTimeout(timer); throw e; });
  }
  function rpcErr(e) {
    var er = new Error((e && e.message) || 'RPC 出错');
    er.rpc = true; er.rpcCode = e && e.code; er.rpcData = e && e.data;
    return er;
  }
  /* revert 是节点**答了**的错：换节点也是同样答复，不转移 */
  function rpcIsRevert(e) {
    return !!e && (e.code === 3 || /execution reverted|revert/i.test(String(e.message || '')));
  }
  function rpcSend(batch, n) {
    var tries = CHAIN.rpc.length;
    var url = CHAIN.rpc[(rpcIdx + n) % tries];
    var single = batch.length === 1;
    var payload = batch.map(function (it) {
      it.id = ++rpcId;
      return { jsonrpc: '2.0', id: it.id, method: it.method, params: it.params };
    });
    rpcFetch(url, single ? payload[0] : payload).then(function (j) {
      if (!single && !Object.prototype.toString.call(j).match(/Array/)) throw new Error('节点不接批量');
      var arr = single ? [j] : j;
      var byId = {}, k;
      for (k = 0; k < arr.length; k++) if (arr[k] && arr[k].id != null) byId[arr[k].id] = arr[k];
      if (single && arr[0] && !byId[batch[0].id]) byId[batch[0].id] = arr[0];   // 单条答复可以不带 id
      rpcIdx = (rpcIdx + n) % tries;                       // 记住这个能用的节点
      var retry = [];
      batch.forEach(function (it) {
        var r = byId[it.id];
        if (!r) { retry.push(it); return; }                // 节点少答了这条：换节点再问
        if (r.error) {
          if (rpcIsRevert(r.error)) it.reject(rpcErr(r.error));
          else { it.lastErr = r.error; retry.push(it); }
          return;
        }
        it.resolve(r.result);
      });
      if (retry.length) {
        if (n + 1 < tries) rpcSend(retry, n + 1);
        else retry.forEach(function (it) { it.reject(rpcErr(it.lastErr || { message: 'RPC 没回这一条' })); });
      }
    }).catch(function (e) {
      if (n + 1 < tries) return rpcSend(batch, n + 1);     // 这个节点打不通，整批换下一个
      /* 所有节点都没接住这一批：拆成单条再走一遍（有的节点不吃批量；单条这条路自己会到头就拒） */
      if (!single) { batch.forEach(function (it) { rpcSend([it], 0); }); return; }
      batch[0].reject(rpcErr({ message: e && e.message }));
    });
  }

  function latestBlockNumber() {
    return rpc('eth_blockNumber', []).then(function (h) { return parseInt(h, 16); });
  }
  function blockAt(n) {
    return rpc('eth_getBlockByNumber', ['0x' + Number(n).toString(16), false]);
  }
  /** 这个哈希是不是本链上真实存在的区块？是则返回区块，不是则返回 null。
      「一个区块一个宇宙」全靠这一步兜底 —— 不验的话随手编一串十六进制也能炸出宇宙。 */
  function blockByHash(hash) {
    return rpc('eth_getBlockByHash', [hash, false]).then(function (b) {
      return (b && b.hash) ? b : null;
    });
  }
  function blockHashOf(n) {
    return blockAt(n).then(function (b) {
      if (!b || !b.hash) throw new Error('区块 ' + n + ' 还不存在');
      return b.hash;
    });
  }

  /* ============================================================ ABI 编解码 */
  function padHex(h) { return h.replace(/^0x/, '').toLowerCase().padStart(64, '0'); }
  function encUint(v) { return padHex(BigInt(v).toString(16)); }
  function encBytes32(h) { return padHex(h); }
  function encAddress(a) { return padHex(a); }
  function encString(s) {
    var bytes = new TextEncoder().encode(s);
    var hex = '';
    for (var i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
    var chunks = Math.ceil(bytes.length / 32) * 64;
    return encUint(bytes.length) + hex.padEnd(chunks, '0');
  }
  /* 动态 bytes 的编码：长度槽 + 数据右填充到 32 字节的整数倍。
     签名是 65 字节 —— 正好跨两个槽还余 1 字节，不填满的话后面的参数会错位。 */
  function encBytes(hex) {
    var body = String(hex || '').replace(/^0x/, '').toLowerCase();
    if (body.length % 2) throw new Error('bytes 长度不是整字节：' + hex);
    var chunks = Math.ceil(body.length / 64) * 64;
    return encUint(body.length / 2) + body.padEnd(chunks, '0');
  }
  function selector(sig) { return K.keccak256(sig).slice(0, 10); }

  function decUint(hex, i) { return BigInt('0x' + hex.substr(2 + (i || 0) * 64, 64)); }
  function decAddress(hex, i) { return '0x' + hex.substr(2 + (i || 0) * 64 + 24, 40); }
  function decString(hex) {
    var body = hex.replace(/^0x/, '');
    var off = Number(BigInt('0x' + body.substr(0, 64))) * 2;
    var len = Number(BigInt('0x' + body.substr(off, 64)));
    var data = body.substr(off + 64, len * 2);
    var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) bytes[i] = parseInt(data.substr(i * 2, 2), 16);
    return new TextDecoder().decode(bytes);
  }

  /* ============================================================ 合约读 */
  function needContract() {
    if (!CONTRACT) throw new Error('合约地址还没配置（web/config.arc.js 里的 contract）');
    return CONTRACT;
  }
  function call(sig, argsHex) {
    return rpc('eth_call', [{ to: needContract(), data: selector(sig) + (argsHex || '') }, 'latest']);
  }

  function tokenOfHash(h) {
    return call('tokenOfHash(bytes32)', encBytes32(h)).then(function (r) { return decUint(r); });
  }
  function price() {
    return call('price()', '').then(function (r) { return decUint(r); });
  }
  function totalSupply() {
    return call('totalSupply()', '').then(function (r) { return decUint(r); });
  }
  /* 免费期还剩多少枚。合约里是 freeCap - totalSupply（发完返回 0）。
     v5 起 price() 就是付费期的一口价——
     签名路和 bang() 那条不带签名的路收的是同一个数。 */
  function freeLeft() {
    return call('freeLeft()', '').then(function (r) { return decUint(r); });
  }
  /** 旧合约的免费闸：这个地址用掉它那一次名额了吗。**只给回退用**——
      现网这版字节码还是「每地址一次」的 usedFree bool；重发后的新合约
      改成了 freeMintCount 计数器（每地址 10 次），走下面的 freeStatus()。 */
  function usedFree(addr) {
    return call('usedFree(address)', encAddress(addr)).then(function (r) { return decUint(r) === 1n; });
  }
  /** eth_call 的失败分两种，下面的 freeStatus 必须分开对待：
      revert / 空返回数据 = 「这版字节码没有这个方法」；网络/节点失败 = 「这次没读到」。
      rpc() 给前一种打了 er.rpc 标（带 rpcData）；空数据在 callUint 里打 emptyData 标
      （有 fallback 的合约对不存在的选择器会回 0x，不 revert）。 */
  function isRevertErr(e) {
    if (!e) return false;
    if (e.emptyData) return true;
    if (!e.rpc) return false;                        // 节点根本没答话：网络问题
    if (e.rpcData !== undefined && e.rpcData !== null) return true;
    return /revert|invalid opcode|vm exception|execution/i.test(String(e.message || ''));
  }
  function callUint(sig, argsHex) {
    return call(sig, argsHex).then(function (r) {
      var body = String(r || '').replace(/^0x/, '');
      if (body.length < 64) {
        var e = new Error('eth_call 返回了空数据（' + sig + '）');
        e.emptyData = true;
        throw e;
      }
      return BigInt('0x' + body.slice(0, 64));
    });
  }
  /** 免费口状态（新合约的 freeMintCount 计数器，每地址 freePerAddr 次）。
      现网那版旧字节码**没有这两个 getter**，eth_call 直接 revert ——
      revert / 空数据返回 { supported:false }，调用方据此隐藏计数、回退 usedFree 的旧判定。
      **网络失败不许冒充旧合约**（原来任一失败都当旧合约：一次 RPC 抖动，
      已用满次数的地址就被静默走旧闸报价成 0，随后合约 WrongPrice）：
      重试一轮（rpc() 内部已轮换过节点），仍失败就往上抛一个说清楚原因的错误 ——
      mintValueFor 会把它带给铸造入口，比拿错报价发一笔必败交易强。 */
  function freeStatus(addr) {
    function ask() {
      return Promise.all([
        callUint('freeMintCount(address)', encAddress(addr)),
        callUint('freePerAddr()', '')
      ]).then(function (v) { return { supported: true, used: v[0], cap: v[1] }; });
    }
    return ask().then(null, function (e) {
      if (isRevertErr(e)) return { supported: false, used: null, cap: null };
      return ask().then(null, function (e2) {
        if (isRevertErr(e2)) return { supported: false, used: null, cap: null };
        var err = new Error('免费口状态读不到（网络或节点问题，不是旧合约）：' + ((e2 && e2.message) || e2));
        err.rpcDown = true;
        throw err;
      });
    });
  }
  /* 这一枚该付多少 wei。**付费口是一口价 price()** —— 原来这里问的是 v4 的分档价
     priceBnb[rarity]，而 v5 字节码里根本没有那个函数，eth_call 一律 revert 0x，
     用户看到的就是「铸造失败: execution reverted: 0x」（2026-08-21 币安钱包实测）。
     免费口必须**正好 0**（合约 _settleBnb 里是 msg.value != 0 就 revert，
     多给一分钱也过不去）。免费资格分两代合约：新合约看 freeMintCount < freePerAddr
     （每地址 10 次），旧合约（现网在跑的）没有这两个 getter，回退 usedFree 的一次判定。
     第二个参数（rarity）留着不接：两个调用方还在传，而 v5 的价格已与稀有度无关。 */
  function mintValueFor(addr) {
    return freeLeft().then(function (left) {
      if (left <= 0n) return price();
      return freeStatus(addr).then(function (st) {
        if (st.supported) return st.used < st.cap ? 0n : price();
        return usedFree(addr).then(function (used) {
          return used ? price() : 0n;
        });
      });
    });
  }
  function ownerOf(id) {
    return call('ownerOf(uint256)', encUint(id)).then(function (r) { return decAddress(r); });
  }
  function tokenURI(id) {
    return call('tokenURI(uint256)', encUint(id)).then(decString);
  }

  /** 并发上限的 map。公开 RPC 打太狠会被限流，6 条并发既够快又不踩线。 */
  function mapLimit(items, limit, fn) {
    var out = new Array(items.length), next = 0;
    function worker() {
      if (next >= items.length) return Promise.resolve();
      var k = next++;
      return Promise.resolve().then(function () { return fn(items[k], k); })
        .then(function (v) { out[k] = v; }, function () { out[k] = null; })
        .then(worker);
    }
    var runners = [];
    for (var j = 0; j < Math.min(limit, items.length); j++) runners.push(worker());
    return Promise.all(runners).then(function () { return out; });
  }

  /** universeOf(id) 一次拿到这枚 NFT 的全部链上事实。
      返回的字数**不是固定的**：`verified` 是后来追加在结构体末尾的字段，
      2026-08-18 部署的那版合约上没有它（实测 universeOf(1) 只回 5 个字）。
      所以只硬性要求前 5 个字，第 6 个字有就读、没有就是 null —— 不猜。 */
  function universeAt(id) {
    return call('universeOf(uint256)', encUint(id)).then(function (raw) {
      var body = String(raw || '').replace(/^0x/, '');
      if (body.length < 5 * 64) return null;                  // 字段顺序对不上，宁可不显示
      return {
        tokenId: id,
        blockHash: '0x' + body.substr(0, 64),
        blockNumber: Number(decUint(raw, 1)),
        mintedAt: Number(decUint(raw, 2)),
        minter: decAddress(raw, 3),
        /* 注意：这是**铸造者填进 bang() 的声称值**，合约不核对。
           要显示结局请拿 blockHash 去问服务端重算（web/arc-ui.js 的 galFill）。 */
        outcome: Number(decUint(raw, 4)),
        verified: body.length >= 6 * 64 ? decUint(raw, 5) === 1n : null,
        /* 稀有度就在结构体第 7 个字段（Universe.rarity），直接解得出来。
           这里原来写着"只存在于 Bang 事件里"并且恒返回 null —— 那是老合约的事实：
           当时确实没这个字段。合约后来把 rarity 挪进了结构体，正是因为公开 RPC
           普遍不让查全量日志，只靠事件的话老 token 在市场页上永远是「? 档」。
           解码器没跟着改，于是链上明明有值、页面照旧显示 null。
           5 = 未知：走 bang() 不带签名铸的那条路没有稀有度可言，合约统一记 5。 */
        rarity: body.length >= 7 * 64 ? Number(decUint(raw, 6)) : null,
        tier: body.length >= 7 * 64 ? (function (r) {
          return r <= 4 ? ['S', 'A', 'B', 'C', 'D'][r] : null;
        })(Number(decUint(raw, 6))) : null
      };
    });
  }

  /** 最近铸造的宇宙，按 tokenId 倒着数。
      **不走 eth_getLogs**：BSC 约 0.45 秒一个块，公开节点只让回看几千个块 ——
      实测 5000 块正好 37 分钟，半小时前铸的宇宙就查不到了，这个列表几乎永远是空的
      （实测：链上有 3 枚，日志窗口里 0 枚）。合约有 totalSupply()，tokenId 从 1
      连续递增，倒着枚举既准又与节点的日志策略无关。市场页早就改过来了
      （web/market.html 的 loadRecent），这里跟上。 */
  function recentBangs(limit) {
    var want = Math.max(1, Math.min(limit || 12, 24));
    return totalSupply().then(function (total) {
      var n = Number(total), ids = [];
      for (var id = n; id > 0 && ids.length < want; id--) ids.push(id);
      if (!ids.length) return [];
      return mapLimit(ids, 6, universeAt).then(function (list) { return list.filter(Boolean); });
    });
  }

  /* ============================================================ 钱包 */
  /* 走 web/wallet.js 选中的那个 provider，而不是直接抓 window.ethereum。
     装了两个以上钱包扩展时，window.ethereum **是谁抢到算谁** —— 用户想用
     币安钱包却连上小狐狸，而且界面上没有任何办法改。wallet.js 用 EIP-6963
     把它们一个个列出来，这里只负责用选中的那个。
     wallet.js 没加载时原样退回旧行为，不让页面挂掉。 */
  function eth() {
    var W = root.MirrorWallet;
    return (W && W.provider()) || root.ethereum;
  }
  function hasWallet() { return !!eth(); }

  function account() {
    if (!hasWallet()) return Promise.resolve(null);
    return eth().request({ method: 'eth_accounts' }).then(function (a) { return (a && a[0]) || null; });
  }

  /* 切链 / 加链的**实现在 web/wallet.js**（MirrorWallet.ensureChain）——
     那一份按最严的钱包（币安：rpcUrls 必须 https、symbol 2–6 位）清洗参数，
     加完还会重核 chainId（币安会「加上了但没切过去」），失败分得清「用户拒绝」
     和「钱包不支持自定义网络」。链参数全部从这里现读传过去，wallet.js 里一个链号都不写死。
     wallet.js 没加载的老页面照旧走下面那段原样保留的退路。 */
  function ensureChain() {
    var W = root.MirrorWallet;
    if (W && W.ensureChain) {
      return W.ensureChain(eth(), {
        hex: CHAIN.hex, id: CHAIN.id, name: CHAIN.name, label: chainName(),
        currency: CHAIN.currency, rpcUrls: CHAIN.rpc, explorer: CHAIN.explorer
      });
    }
    return ensureChainLegacy();
  }
  function ensureChainLegacy() {
    return eth().request({ method: 'eth_chainId' }).then(function (id) {
      if (String(id).toLowerCase() === CHAIN.hex) return true;
      return eth().request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN.hex }] })
        .then(function () { return true; })
        .catch(function (e) {
          if (e && (e.code === 4902 || e.code === -32603)) {       // 钱包里还没有这条链，加进去
            return eth().request({
              method: 'wallet_addEthereumChain',
              params: [{
                chainId: CHAIN.hex,
                chainName: CHAIN.name,
                nativeCurrency: CHAIN.currency,
                /* 给钱包的必须是绝对地址：节点表里的 '/api/rpc' 是同源中继，钱包用不了 */
                rpcUrls: [CHAIN.rpc.filter(function (u) { return /^https?:/i.test(u); })[0] || CHAIN.rpc[0]],
                blockExplorerUrls: [CHAIN.explorer]
              }]
            }).then(function () { return true; });
          }
          throw e;
        });
    });
  }

  function connect() {
    if (!hasWallet()) return Promise.reject(new Error('没有检测到钱包扩展（MetaMask / 币安钱包 等）'));
    return eth().request({ method: 'eth_requestAccounts' })
      .then(function (a) { return ensureChain().then(function () { return (a && a[0]) || null; }); });
  }

  /** 引爆并铸造。outcome 是结局 id（0..11），cid 可空。返回 txHash。 */
  function bang(blockHash, blockNumber, outcome, cid, valueWei) {
    return connect().then(function (from) {
      var data = selector('bang(bytes32,uint64,uint8,string)')
        + encBytes32(blockHash)
        + encUint(blockNumber)
        + encUint(outcome)
        + encUint(128)                     // string 参数的偏移：4 个头槽
        + encString(cid || '');
      return eth().request({
        method: 'eth_sendTransaction',
        params: [{ from: from, to: needContract(), data: data, value: '0x' + BigInt(valueWei || 0).toString(16) }]
      });
    });
  }

  /**
   * 带服务端签名的引爆 —— **正经那条路**。验过签名合约才把 cardHash 写进 cardOf，
   * 而 cardOf 非零是"这枚 NFT 带参数"的唯一凭据：市场只上架带章的，
   * 干预、按档发 BANG 也都认它。不带签名的 bang() 铸出来的是个空壳。
   *
   * 八个参数全部必须与服务端签名时用的完全一致（尤其 outcome 和 rarity
   * 要用服务端返回的那个，不能用页面自己算的）—— 差一个字段 ecrecover
   * 就恢复出别的地址，合约直接 BadSig，而链上报错看不出是哪一项错了。
   */
  /* ArcUniverse 没有 payWithBang（没有代币），bangSigned 是 7 个参数：
     选择器与 sig 的偏移都不一样，按旧的 8 参编码发过去会 revert（2026-09-18 上线第一枚撞上）。 */
  function isArcSite() {
    var c = root.ARCBANG_CONFIG || {};
    return String(root.ARCBANG_SITE || c.site || '') === 'arc';
  }
  function bangSignedData(o) {
    if (isArcSite()) {
      return selector('bangSigned(bytes32,uint64,uint8,uint8,bytes32,uint64,bytes)')
        + encBytes32(o.blockHash)
        + encUint(o.blockNumber)
        + encUint(o.outcome)
        + encUint(o.rarity)
        + encBytes32(o.cardHash)
        + encUint(o.deadline)
        + encUint(7 * 32)                  // sig 是第 7 个参数，头部 7 个槽 → 偏移 224
        + encBytes(o.sig);
    }
    return selector('bangSigned(bytes32,uint64,uint8,uint8,bytes32,uint64,bytes,bool)')
      + encBytes32(o.blockHash)
      + encUint(o.blockNumber)
      + encUint(o.outcome)
      + encUint(o.rarity)
      + encBytes32(o.cardHash)
      + encUint(o.deadline)
      + encUint(8 * 32)                    // sig 是第 7 个参数，头部 8 个槽 → 偏移 256
      + encUint(o.payWithBang ? 1 : 0)
      + encBytes(o.sig);
  }
  /** 发交易前的模拟总检（照拯救路径 intervene.js mintRescueGo 的先例）：
      同一个 from / value / calldata 先 eth_call 一遍，回滚就 reject ——
      报价与上链之间不是原子的（最后一枚全局免费、或该地址第 10 次免费，
      并发下 msg.value==0 会撞 WrongPrice），必败的交易该死在弹钱包**之前**。 */
  function simulateBangSigned(o, from) {
    return rpc('eth_call', [{
      from: from, to: needContract(), data: bangSignedData(o),
      value: '0x' + BigInt(o.valueWei || 0).toString(16)
    }, 'latest']);
  }
  function bangSigned(o) {
    return connect().then(function (from) {
      return eth().request({
        method: 'eth_sendTransaction',
        params: [{
          from: from, to: needContract(), data: bangSignedData(o),
          value: '0x' + BigInt(o.valueWei || 0).toString(16)
        }]
      });
    });
  }

  /** 轮询回执，直到上链或超时（默认 3 分钟） */
  function waitTx(hash, timeoutMs) {
    var t0 = Date.now(), limit = timeoutMs || 180000;
    return new Promise(function (resolve, reject) {
      (function poll() {
        rpc('eth_getTransactionReceipt', [hash]).then(function (r) {
          if (r) return resolve(r);
          if (Date.now() - t0 > limit) return reject(new Error('等待回执超时'));
          setTimeout(poll, 3000);
        }).catch(function () {
          if (Date.now() - t0 > limit) return reject(new Error('等待回执超时'));
          setTimeout(poll, 3000);
        });
      })();
    });
  }

  function fmtBNB(wei) {
    var v = BigInt(wei || 0), whole = v / 10n ** 18n, frac = (v % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, '');
    return whole.toString() + (frac ? '.' + frac : '');
  }

  root.MirrorChain = {
    CHAIN: CHAIN,
    chainName: chainName,
    contract: function () { return CONTRACT; },
    setContract: function (a) { CONTRACT = a; },
    rpc: rpc,
    latestBlockNumber: latestBlockNumber,
    blockAt: blockAt,
    blockByHash: blockByHash,
    blockHashOf: blockHashOf,
    hasWallet: hasWallet,
    connect: connect,
    account: account,
    ensureChain: ensureChain,
    tokenOfHash: tokenOfHash,
    price: price,
    totalSupply: totalSupply,
    freeLeft: freeLeft,
    usedFree: usedFree,
    freeStatus: freeStatus,
    mintValueFor: mintValueFor,
    ownerOf: ownerOf,
    tokenURI: tokenURI,
    recentBangs: recentBangs,
    bang: bang,
    bangSigned: bangSigned,
    simulateBangSigned: simulateBangSigned,
    waitTx: waitTx,
    fmtBNB: fmtBNB,
    selector: selector
  };
})(typeof window !== 'undefined' ? window : this);
