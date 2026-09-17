// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * 镜像宇宙 · ARCBANG
 * ------------------------------------------------------------
 * 一个 Arc 区块哈希 = 一个宇宙 = 一个 token。哈希唯一，token 也唯一。
 *
 * 与 BNBBANG / BTCBANG 的结构性差别（specs/arcbang-v1.md）：**没有代币，也没有拯救系统**。
 * 铸造只收 native（Arc 上的 native 就是 USDC，18 位小数），不发任何奖励币；
 * 一枚 NFT 铸出来之后参数指纹不再改写 —— 沙盒里推参数是免费玩法，不上链。
 *
 * 链上只算两样，都是整数、可被任何人复算：
 *   u_i  = uint256(keccak256(abi.encodePacked(blockHash, uint8(i))))   % 1e9
 *   tier = uint256(keccak256(abi.encodePacked(blockHash, uint8(255)))) % 1000
 *
 * 什么能信、什么不能信：
 *   tier      —— 合约自己从哈希算，不可伪造。
 *   outcome   —— 铸造方提交的**声明值**，链上不验。它被签进摘要，
 *                于是"服务端认过这个结局"是可验证的。
 *   cardHash  —— 参数指纹。**非零 = 走过服务端**，这是"这枚 NFT 带参数"的唯一凭据。
 *   维度      —— 链上**算不出来**（弦气体模型要浮点迭代），所以链上不声称知道它。
 *
 * 铸造只有 bangSigned() 一条路：「必须先玩过」是**合约强制的**，
 * 不是"我们的网站碰巧这么做"。这同时是反女巫的主防线。
 *
 * blockhash() 只认最近 256 个块 —— Arc 出块 0.506 秒，即**约 129 秒**的窗口。
 *
 * 无外部依赖（最小 ERC-721 + Base64 都在本文件内）。
 */
contract ArcUniverse {
    /* ------------------------------------------------------------ 元信息 */
    string public constant name = "Mirror Universe ARCBANG";
    string public constant symbol = "ARCBANG";

    /* ------------------------------------------------------------ 数据 */
    struct Universe {
        bytes32 blockHash;   // 奇点
        uint64 blockNumber;  // 哈希来自哪个区块
        uint64 mintedAt;     // 铸造时间
        address minter;      // 谁引爆的
        uint8 outcome;       // 结局（声明值，见 OUTCOMES 顺序，与引擎一致）
        /* 铸造那一刻，合约用 blockhash(blockNumber) 亲自核对过这个哈希吗？
           EVM 只能回看最近 256 个块（BSC 约 115 秒），所以：
             true  —— 链上自证，这枚哈希百分之百是本链的真区块
             false —— 更老的区块，链上验不了；不代表是假的，需要谁去打一次 RPC 复核
           **verified 放在结构体最后**：universeOf 的 ABI 返回按声明顺序排字，
           追加在末尾才不会挪动前面五个字段的位置，已有的解码代码不用改。 */
        bool verified;
        /* 稀有度 0..4 = S/A/B/C/D，由服务端算并签进摘要。
           **必须存在链上，不能只发事件**：公开 RPC 普遍不让查全量日志
           （实测 data-seed 报 limit exceeded、publicnode 限 5 万块），
           只靠 Minted 事件的话，窗口之外的老 token 在市场页上永远是「? 档」。
           而稀有度决定定价和筛选，是市场必须能读到的字段。
           位置在结构体最后：ABI 返回按声明顺序排字，追加不挪动前面的字段，
           已有的解码代码不用改（和 verified 当初一样的处理）。
           存储上不额外花钱 —— address(20)+uint8(1)+bool(1)=22 字节，
           这个槽还剩 10 字节，rarity 直接塞进去。 */
        uint8 rarity;
    }

    mapping(uint256 => Universe) public universeOf;
    mapping(bytes32 => uint256) public tokenOfHash;  // 0 = 尚未被引爆；tokenId 从 1 开始
    uint256 public totalSupply;

    /* ---- 铸造总量上限（specs/arcbang-v1.md §3.1）----
       **1,387 枚** —— 宇宙年龄 137.87 亿年（Planck 2018: 13.787 Gyr），
       一枚 NFT = 一千万年。供应量本身就是一句话，而不是一个凑整的数字。

       BNBBANG 的 1,707,000 在这里作废：那个数是配着「铸造发币」设计的，
       没有代币之后，170 万枚 NFT 等于没有稀缺。

       写死，没有任何函数能改它：**可调的总量上限不是总量上限。** */
    uint256 public constant MINT_CAP = 1_387;

    /* 付费期价格：**固定 1 USDC**（Arc 的 native 就是 USDC，18 位小数）。
       2026-09-16 链上实测：Arc 上在铸的集合价位是 0 ~ 1.5 USDC，
       一次 mint 的 gas 只要 0.003 USDC（baseFee 固定 20 gwei）。我们有玩法、有画面，站在那个区间的上沿。 */
    uint256 public price = 1 ether;
    /* owner 能调价，但只能在这个区间里。上下限写死：
       没有下限，价格可以调到 0，付费期就成了第二个免费期；
       没有上限，调到天价等于单方面停售。 */
    uint256 public constant MIN_PRICE = 0.1 ether;
    uint256 public constant MAX_PRICE = 20 ether;

    address public owner;

    /* 服务端签名地址。走服务端引爆过的宇宙才拿得到签名，
       合约验过签名才把参数指纹写进 cardOf —— 这是「这枚 NFT 带参数」的唯一凭据。 */
    address public signer;

    /* 参数指纹。0 = 没走服务端（直接调 bang 或别的合约调进来的），不带参数，市场不上架。
       内容 = keccak256(abi.encode(blockHash, uInt[22], outcome, derivationVersion))，
       由服务端算，合约不解释它，只负责证明"这是服务端认过的那一份"。 */
    mapping(uint256 => bytes32) public cardOf;

    /* tokenURI 前缀，owner 可改。**必须可改**：图放在自己的服务器上，
       域名或路径一旦变化，写死进合约就等于所有 NFT 同时变死链。 */
    string public baseURI;

    /* ------------------------------------------------------------ 经济（specs/arcbang-v1.md §3）

       **没有代币，也没有「拯救」。** 铸造收 native USDC，进合约，owner 用 withdraw 取走；
       二级市场靠 ERC-2981 版税。就这两条收入，合约里没有别的钱的去处。

       原来的 BANG 支付路径、按稀有度发币、售币入口、费率开关，以及后来的
       「付 USDC 全额销毁来改写宇宙参数」的干预系统（2026-09-17 用户拍板删除），
       全部不存在于这份合约。链上一枚 NFT 的参数指纹 cardOf 写进去之后就不再变。 */

    /* ---- 免费期（specs/arcbang-v1.md §3.2）----
       前 freeCap 枚只付 gas（Arc 上一次铸造的 gas 约 0.003 USDC），每地址 freePerAddr 次。

       BNBBANG 那一整套「发多少币才不被女巫刷穿」的账在这里**全部作废** ——
       免费铸造不再发任何东西，女巫刷到的只是一枚 NFT，
       而那枚 NFT 要先真的跑完一次引爆流程才拿得到签名（见 bangSigned）。
       换句话说：**防线从"发币经济学"换成了"必须先玩"**，后者硬得多。

       剩下的唯一风险是女巫把 1,387 枚里的免费额度抢光，
       所以免费期只给 387 枚（2026-09-17 用户拍板：387 免费、1,000 收费），每地址 1 次。

       两个开关都**只能收紧不能放松**：调大等于事后给自己开免费额度。
       也就是说部署那一刻填的就是终身上限，改不回来。 */
    /* specs/arcbang-v1.md §3.2：前 387 枚免费，每地址 1 次；其后 1,000 枚 1 USDC。
       BNBBANG 的 10 次不能照搬 —— 那是配着 100 万枚免费额度的，
       放在 1,387 枚的总量下会被几十个地址刷穿。
       两个开关都**只能收紧不能放松**：调大等于事后给自己开免费额度。 */
    uint256 public freeCap = 387;
    uint16 public freePerAddr = 1;
    mapping(address => uint16) public freeMintCount;

    /* 付费期每地址上限（2026-09-17 用户拍板：「1 个地址限量付费 3 个」）。
       不是防撸——付费撸走是收入——是让 1,000 枚付费额度分到更多人手里。
       同 freePerAddr：只能收紧，不能放松；调到 0 等于关掉付费口。 */
    uint16 public paidPerAddr = 3;
    mapping(address => uint16) public paidMintCount;


    /* ------------------------------------------------------------ ERC-721 存储 */
    mapping(uint256 => address) private _ownerOf;
    mapping(address => uint256) private _balanceOf;
    mapping(uint256 => address) public getApproved;
    mapping(address => mapping(address => bool)) public isApprovedForAll;

    event Transfer(address indexed from, address indexed to, uint256 indexed id);
    event Approval(address indexed owner, address indexed spender, uint256 indexed id);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    /// 稀有度与阶段单独发一条：市场和统计要按档筛，从 Bang 里翻 cardHash 太绕
    event Minted(uint256 indexed id, uint8 rarity, bool freeMint);
    event Bang(uint256 indexed id, bytes32 indexed blockHash, address indexed minter, uint8 tier, uint8 outcome, bool verified, bytes32 cardHash);
    event OwnershipTransferred(address indexed from, address indexed to);
    event PriceChanged(uint256 price);
    event FreeCapChanged(uint256 freeCap);
    event FreePerAddrChanged(uint16 freePerAddr);
    event PaidPerAddrChanged(uint16 paidPerAddr);
    event SignerChanged(address signer);
    event BaseURIChanged(string uri);
    event Withdrawn(address indexed to, uint256 amount);

    error AlreadyBanged();      // 这个宇宙已经被别人引爆过了
    error MintCapReached();     // 已经铸满 1,387 枚，不能再铸
    error PaidCapReached();     // 这个地址付费铸造的枚数已到 paidPerAddr
    error WrongPrice();
    error NotOwner();
    error BadOutcome();
    error BadHash();          // 零哈希：既没意义，又会让 blockhash 越界返回的 0 撞出假"已验证"
    error NoToken();          // ERC-721：这个 id 不存在
    error BadSig();           // 签名不是服务端签的 / 格式不对 / cardHash 为零
    error Expired();          // 签名过期了
    error BadRarity();        // 稀有度只能是 0..4
    error BadConfig();        // 参数设置违反了不变量

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /* ============================================================ 派生（与 bnbhash.js 同式） */
    uint256 internal constant U_DEN = 1e9;

    /// u_i ∈ [0, 1e9)
    function uOf(bytes32 blockHash, uint8 i) public pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(blockHash, i))) % U_DEN;
    }

    /// 档位 0..4：微澜 / 偏航 / 剧变 / 狂澜 / 混沌
    function tierOf(bytes32 blockHash) public pure returns (uint8) {
        uint256 n = uint256(keccak256(abi.encodePacked(blockHash, uint8(255)))) % 1000;
        if (n < 500) return 0;
        if (n < 800) return 1;
        if (n < 950) return 2;
        if (n < 995) return 3;
        return 4;
    }

    /* dimOffOf / dimTenthsOf 已删除。
       它们是"按档位掷骰子决定维数"的老做法；维度改由弦气体模型（Brandenberger-Vafa）
       从 T0/T_H、缠绕密度、紧致刚度三个参数解出来之后，这两个函数给出的就是**假数字**，
       而链上 SVG 一直在拿它们印 "D = x.x"。
       维度现在只有一个来源：服务端跑引擎算出来，写进 card，指纹进 cardHash。
       链上没有能力重算它 —— 所以链上也不再声称自己知道维度。 */

    /* ============================================================ 引爆（mint）

       **只有 bangSigned() 一条路。** v4 那个不带签名的 bang() 已删除，理由有两条：

       1. 「铸造必须经过服务端」从此是**合约强制的**。v4 里它只是"我们的网站碰巧
          这么做"，链是公开的，谁都能自己发一笔交易绕过去。
       2. 它是个真实的洞，链上已经有 3 枚是走这条路铸的：bang() 按扁平 price（0.01）
          收费，而分档表里 S 档标价 0.05 —— 而 _bang 会写 tokenOfHash。
          **0.01 BNB 就能永久抢占一个 S 档区块，让它再也没人能铸**，
          而且抢到的那枚不带 cardHash、市场不上架，纯粹是把一个好区块作废掉。

       代价是：没有服务端签名就铸不了。这是有意的 —— 稀有度、结局、参数指纹
       全是引擎算出来的，链上算不了，没有那道签名它们就只是调用者的自称。 */

    /**
     * 走服务端引爆过的宇宙才拿得到签名，验过签名才把参数指纹写进 cardOf。
     * @param cardHash 参数指纹，由服务端算（keccak256(blockHash, uInt[22], 三个专用槽, outcome, 版本)）
     * @param deadline 签名有效期，Unix 秒
     * @param sig      65 字节 (r,s,v)
     */
    function bangSigned(
        bytes32 blockHash,
        uint64 blockNumber,
        uint8 outcome,
        uint8 rarity,
        bytes32 cardHash,
        uint64 deadline,
        bytes calldata sig
    ) external payable returns (uint256 id) {
        if (signer == address(0)) revert BadSig();       // 还没设签名地址：这条路是关着的
        if (cardHash == bytes32(0)) revert BadSig();     // 0 是"没盖章"的标记，不能被当成有效章
        if (rarity > 4) revert BadRarity();
        if (block.timestamp > deadline) revert Expired();

        /* 摘要必须与服务端 server/sign.js 的 digestOf 逐字段同序同类型，否则 ecrecover 对不上。
           chainId 和 address(this) 一定要在里面：少了前者，测试网签的名能拿到主网用；
           少了后者，A 合约的签名能喂给 B 合约。
           **rarity 必须签进去**：它直接决定价格和奖励，不签就等于让调用者自己报价。
           **msg.sender 必须签进去**：不签的话这张签名就是「这个宇宙谁先交谁铸」的能力票，
           服务端签完、用户还没上链的窗口里，任何人（含 MEV）都能拿走。 */
        bytes32 digest = keccak256(
            abi.encode(block.chainid, address(this), blockHash, blockNumber, outcome, rarity, cardHash, deadline, msg.sender)
        );
        bytes32 ethDigest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
        if (_recover(ethDigest, sig) != signer) revert BadSig();

        id = _bang(blockHash, blockNumber, outcome, cardHash, rarity);
        // 先记 NFT 再动钱：中途 revert 整笔回滚，不会留下半成品
        bool wasFree = _settle();
        emit Minted(id, rarity, wasFree);
    }

    /**
     * 收钱。免费期与付费期的差别全在这里，**不发任何东西**。
     * 放在 _bang 之后调用：先把 NFT 记好，再动钱 —— 中途 revert 时整笔回滚，没有半成品。
     *
     * @return wasFree 这一枚是不是走的免费额度（进 Minted 事件，前端和索引器要按它分流）
     */
    function _settle() internal returns (bool wasFree) {
        // 免费期：只付 gas。每个地址 freePerAddr 次。
        if (totalSupply <= freeCap && freeMintCount[msg.sender] < freePerAddr) {
            if (msg.value != 0) revert WrongPrice();
            freeMintCount[msg.sender]++;
            return true;
        }
        if (msg.value != price) revert WrongPrice();      // 付费期：固定价，不分档
        if (paidMintCount[msg.sender] >= paidPerAddr) revert PaidCapReached();   // 每地址最多 paidPerAddr 枚
        paidMintCount[msg.sender]++;
        return false;
    }

    function _bang(
        bytes32 blockHash,
        uint64 blockNumber,
        uint8 outcome,
        bytes32 cardHash,
        uint8 rarity
    ) internal returns (uint256 id) {
        // 收钱不在这里：免费期/付费期规则不同，由 _settle 处理。
        if (blockHash == bytes32(0)) revert BadHash();
        if (tokenOfHash[blockHash] != 0) revert AlreadyBanged();
        if (outcome > 11) revert BadOutcome();
        /* 总量封顶（specs/economy-v5.md §2）。第 1,707,000 枚能铸，第 1,707,001 枚不行。
           放在这里而不是 _settle 里：封顶是"这枚 NFT 存不存在"的事，
           跟用什么付钱无关，两条付款路都得挡。 */
        if (totalSupply >= MINT_CAP) revert MintCapReached();

        /* 能验就验：blockhash 只认最近 256 个块，够到就当场盖章。
           零哈希在上面已经挡掉了 —— 否则 blockhash 越界返回 0 会和它撞出一个假的"已验证"。
           前端只是产品面的收口，直接发交易的人绕得过去；这一行才是链上的那道章。 */
        bool proven = _proven(blockHash, blockNumber);

        id = ++totalSupply;
        tokenOfHash[blockHash] = id;
        universeOf[id] = Universe({
            blockHash: blockHash,
            blockNumber: blockNumber,
            mintedAt: uint64(block.timestamp),
            minter: msg.sender,
            outcome: outcome,
            verified: proven,
            rarity: rarity
        });
        if (cardHash != bytes32(0)) cardOf[id] = cardHash;

        _ownerOf[id] = msg.sender;
        unchecked { _balanceOf[msg.sender]++; }
        emit Transfer(address(0), msg.sender, id);
        emit Bang(id, blockHash, msg.sender, tierOf(blockHash), outcome, proven, cardHash);
    }

    /* ---- 链上自证：两道窗 ----
       blockhash() 只认最近 256 块（Arc 0.5 秒出块 ≈ 2 分钟）。Arc 的 EVM 基线是 Osaka，
       **EIP-2935 历史哈希合约已部署且可用**，能回看 8190 块 ≈ 68 分钟（2026-09-17 主网实测：
       head-8190 以内逐一与真哈希一致，head-8191 起 revert）。
       先走 blockhash（便宜），超窗再问历史合约。两道都够不到才是 verified=false ——
       不代表哈希是假的，只是链上验不了，服务端签名之前已经打过 RPC 复核。 */
    address internal constant HISTORY = 0x0000F90827F1C53a10cb7A02335B175320002935;

    function _proven(bytes32 h, uint64 n) internal view returns (bool) {
        if (blockhash(n) == h) return true;
        if (n >= block.number) return false;
        // 历史合约的读接口：calldata 就是 32 字节的块号，返回 32 字节哈希，超窗 revert
        (bool ok, bytes memory r) = HISTORY.staticcall(abi.encode(uint256(n)));
        return ok && r.length == 32 && abi.decode(r, (bytes32)) == h;
    }

    /// 65 字节签名拆 (r,s,v)。挡掉可锻性：s 必须在低半区，v 只认 27/28。
    function _recover(bytes32 digest, bytes calldata sig) internal pure returns (address) {
        if (sig.length != 65) revert BadSig();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) revert BadSig();
        if (v != 27 && v != 28) revert BadSig();
        address a = ecrecover(digest, v, r, s);
        if (a == address(0)) revert BadSig();
        return a;
    }




    /// 这个区块还没被引爆吗
    function isVirgin(bytes32 blockHash) external view returns (bool) {
        return tokenOfHash[blockHash] == 0;
    }

    /**
     * 铸造封顶了没有。**BangToken.sealRewards() 的触发条件就是这一个 bool**：
     * 铸满 1,707,000 枚之后，任何人都能去把剩余的铸造额度永久作废。
     * 放在这里而不是让代币自己数：只有 NFT 合约知道铸了多少枚，
     * 而 MINT_CAP 只存在于这一处，不复制第二份（specs/economy-v5.md §3.2 的同一条道理）。
     */
    function mintCapReached() external view returns (bool) {
        return totalSupply >= MINT_CAP;
    }

    /// 还能铸多少枚
    function mintLeft() external view returns (uint256) {
        return totalSupply >= MINT_CAP ? 0 : MINT_CAP - totalSupply;
    }

    /// 调价。上下限写死在 MIN_PRICE / MAX_PRICE，owner 也调不出去
    function setPrice(uint256 p) external onlyOwner {
        if (p < MIN_PRICE || p > MAX_PRICE) revert BadConfig();
        price = p;
        emit PriceChanged(p);
    }

    /// 免费期只能提前结束，不能延长 —— 能调大就等于事后给自己开免费额度
    function setFreeCap(uint256 c) external onlyOwner {
        if (c > freeCap) revert BadConfig();
        freeCap = c;
        emit FreeCapChanged(c);
    }

    /// 每地址免费次数同样只能调小，0 也允许（= 关掉免费口）。
    /// 照 setFreeCap / setFreeReward 的先例：能调大就等于事后给自己开免费额度。
    function setFreePerAddr(uint16 n) external onlyOwner {
        if (n > freePerAddr) revert BadConfig();
        freePerAddr = n;
        emit FreePerAddrChanged(n);
    }

    /// 付费期每地址上限同样只能调小（0 = 关掉付费口）。
    function setPaidPerAddr(uint16 n) external onlyOwner {
        if (n > paidPerAddr) revert BadConfig();
        paidPerAddr = n;
        emit PaidPerAddrChanged(n);
    }

    /// 还剩多少枚免费额度
    function freeLeft() external view returns (uint256) {
        return totalSupply >= freeCap ? 0 : freeCap - totalSupply;
    }

    function setSigner(address s_) external onlyOwner {
        signer = s_;
        emit SignerChanged(s_);
    }
    function setBaseURI(string calldata u) external onlyOwner {
        baseURI = u;
        emit BaseURIChanged(u);
    }
    function transferOwnership(address o) external onlyOwner {
        if (o == address(0)) revert BadConfig();
        emit OwnershipTransferred(owner, o);
        owner = o;
    }
    function withdraw(address payable to) external onlyOwner {
        if (to == address(0)) revert BadConfig();
        uint256 amt = address(this).balance;
        (bool ok, ) = to.call{value: amt}("");
        require(ok, "withdraw failed");
        emit Withdrawn(to, amt);
    }

    /* ============================================================ ERC-721 */
    function ownerOf(uint256 id) public view returns (address o) {
        o = _ownerOf[id];
        if (o == address(0)) revert NoToken();
    }

    function balanceOf(address a) public view returns (uint256) {
        return _balanceOf[a];
    }

    function approve(address spender, uint256 id) external {
        address o = _ownerOf[id];
        require(msg.sender == o || isApprovedForAll[o][msg.sender], "not authorized");
        getApproved[id] = spender;
        emit Approval(o, spender, id);
    }

    function setApprovalForAll(address operator, bool approved) external {
        isApprovedForAll[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function transferFrom(address from, address to, uint256 id) public {
        require(from == _ownerOf[id], "wrong from");
        require(to != address(0), "to zero");
        require(
            msg.sender == from || isApprovedForAll[from][msg.sender] || msg.sender == getApproved[id],
            "not authorized"
        );
        unchecked {
            _balanceOf[from]--;
            _balanceOf[to]++;
        }
        _ownerOf[id] = to;
        delete getApproved[id];
        emit Transfer(from, to, id);
    }

    function safeTransferFrom(address from, address to, uint256 id) external {
        transferFrom(from, to, id);
        _checkReceiver(from, to, id, "");
    }

    function safeTransferFrom(address from, address to, uint256 id, bytes calldata data) external {
        transferFrom(from, to, id);
        _checkReceiver(from, to, id, data);
    }

    function _checkReceiver(address from, address to, uint256 id, bytes memory data) internal {
        if (to.code.length == 0) return;
        require(
            IERC721Receiver(to).onERC721Received(msg.sender, from, id, data)
                == IERC721Receiver.onERC721Received.selector,
            "unsafe recipient"
        );
    }

    function supportsInterface(bytes4 x) external pure returns (bool) {
        return x == 0x01ffc9a7      // ERC-165
            || x == 0x80ac58cd      // ERC-721
            || x == 0x5b5e139f      // ERC-721 Metadata
            || x == 0x2a55205a;     // ERC-2981 版税
    }

    /* ============================================================ ERC-2981 版税
       二级市场（OpenSea 在 Arc 主网第一天就支持）按这个接口读版税。
       没有代币之后，运营方的持续收入只有两条：铸造费和这里的版税（specs/arcbang-v1.md §三）。

       上限 10% 写死：版税调到 50% 等于把二级市场关掉，owner 不该有这个能力。
       收款地址空着时退回 owner —— 部署那一刻就有版税，不需要多一步接线；
       之后要分给别的地址（多签、金库）再 setRoyalty。 */
    uint16 public royaltyBps = 500;                  // 5%
    uint16 public constant MAX_ROYALTY_BPS = 1000;   // 10%
    address public royaltyReceiver;
    event RoyaltyChanged(address receiver, uint16 bps);

    function royaltyInfo(uint256, uint256 salePrice) external view returns (address receiver, uint256 amount) {
        receiver = royaltyReceiver == address(0) ? owner : royaltyReceiver;
        amount = (salePrice * royaltyBps) / 10000;
    }

    function setRoyalty(address receiver, uint16 bps) external onlyOwner {
        if (bps > MAX_ROYALTY_BPS) revert BadConfig();
        royaltyReceiver = receiver;
        royaltyBps = bps;
        emit RoyaltyChanged(receiver, bps);
    }

    /* ============================================================ tokenURI */
    /* 名字与配色全部走 pure 函数，不进 storage：省掉构造函数里那一大笔写入 gas，
       也让 tokenURI 的输出只依赖代码本身。结局顺序与 engine/engine.js 的 OUTCOMES 一致。 */
    function outcomeName(uint8 o) public pure returns (string memory) {
        if (o == 0) return "Unstable orbits";
        if (o == 1) return "Big Crunch";
        if (o == 2) return "Big Rip";
        if (o == 3) return "Heat death, no structure";
        if (o == 4) return "Black hole dominated";
        if (o == 5) return "No atoms";
        if (o == 6) return "No chemistry";
        if (o == 7) return "No stars";
        if (o == 8) return "Stars but no life";
        if (o == 9) return "Observers possible";
        if (o == 10) return "No carbon chemistry";
        return "Beyond model (D!=3)";
    }

    function tierName(uint8 t) public pure returns (string memory) {
        if (t == 0) return "Whisper";
        if (t == 1) return "Drift";
        if (t == 2) return "Quake";
        if (t == 3) return "Storm";
        return "Chaos";
    }

    function tierColor(uint8 t) internal pure returns (string memory) {
        if (t == 0) return "#5ad1a0";
        if (t == 1) return "#63b3ff";
        if (t == 2) return "#f0a44a";
        if (t == 3) return "#ff6b6b";
        return "#c77dff";
    }

    function tokenURI(uint256 id) external view returns (string memory) {
        Universe memory u = universeOf[id];
        if (u.blockHash == bytes32(0)) revert NoToken();

        /* 设了 baseURI 就走服务端出的图和 metadata（图片生成已经搬到服务端）。
           **baseURI 必须是 owner 可改的**：图放在自己的服务器上，域名或路径一旦变化，
           写死进合约就等于所有 NFT 同时变死链；留着这个开关，以后也能整体迁到 IPFS。
           没设时退回下面那段链上 SVG —— 服务器还没起来、或者哪天不想要服务器了，
           NFT 也不至于没有图。 */
        if (bytes(baseURI).length != 0) {
            return string(abi.encodePacked(baseURI, _u(id)));
        }
        uint8 t = tierOf(u.blockHash);
        bool alive = u.outcome == 9;

        string memory img = Base64.encode(bytes(_svg(u.blockHash, t, u.outcome, u.verified)));
        string memory attrs = string(
            abi.encodePacked(
                '[{"trait_type":"Tier","value":"', tierName(t),
                '"},{"trait_type":"Outcome","value":"', outcomeName(u.outcome),
                '"},{"trait_type":"Observers","value":"', alive ? "yes" : "no",
                /* 原来这里印 "Spatial dimension"，值来自已删除的 dimOffOf —— 是假的。
                   链上算不出维度，就不要声称知道；改成链上真的知道的事：有没有服务端的章。 */
                '"},{"trait_type":"Parameters","value":"', cardOf[id] != bytes32(0) ? "stamped" : "none",
                '"},{"trait_type":"Block proof","value":"', u.verified ? "on-chain" : "off-chain",
                '"},{"trait_type":"Block","value":', _u(u.blockNumber),
                '},{"trait_type":"Block hash","value":"', _hex(u.blockHash), '"}]'
            )
        );
        bytes memory json = abi.encodePacked(
            '{"name":"Universe #', _u(id),
            '","description":"A universe grown from Arc block ', _u(u.blockNumber),
            '. One block hash, one set of genesis parameters, one outcome. Derived on-chain and off-chain by the same integer formula; anyone can recompute it.',
            '","image":"data:image/svg+xml;base64,', img,
            '","attributes":', attrs, "}"
        );
        return string(abi.encodePacked("data:application/json;base64,", Base64.encode(json)));
    }

    /* ------------------------------------------------------------ 全链 SVG */
    /// 20 条参数轴的顶点，半径 90..250，中心 (300,300)。
    /// 单位向量 ×1000（每 18°）——Solidity 没有三角函数，直接烧表（memory 字面量，不占 storage）
    function _verts(bytes32 h) internal pure returns (int256[20] memory xs, int256[20] memory ys) {
        int256[20] memory cosv = [
            int256(1000), 951, 809, 588, 309, 0, -309, -588, -809, -951,
            -1000, -951, -809, -588, -309, 0, 309, 588, 809, 951
        ];
        int256[20] memory sinv = [
            int256(0), 309, 588, 809, 951, 1000, 951, 809, 588, 309,
            0, -309, -588, -809, -951, -1000, -951, -809, -588, -309
        ];
        for (uint8 i = 0; i < 20; i++) {
            // 内半径抬到 90：原来 60 起步，小值挤在中心，形状糊成一团
            uint256 r = 90 + (uOf(h, i) * 160) / U_DEN;
            xs[i] = 300 + (int256(r) * cosv[i]) / 1000;
            ys[i] = 300 - (int256(r) * sinv[i]) / 1000;
        }
    }

    /// 把 20 个顶点连成**平滑闭合曲线**：经过相邻顶点的中点，用顶点自身作二次贝塞尔控制点。
    /// 原来直接 <polygon> 连折线，20 个随机半径拉出来的形状扎手扎脚，像块碎玻璃。
    function _path(bytes32 h) internal pure returns (bytes memory d) {
        (int256[20] memory xs, int256[20] memory ys) = _verts(h);
        // 起点 = 顶点 19 与 0 的中点
        d = abi.encodePacked("M", _i(_mid(xs[19], xs[0])), " ", _i(_mid(ys[19], ys[0])));
        for (uint8 i = 0; i < 20; i++) {
            uint8 j = (i + 1) % 20;
            d = abi.encodePacked(
                d, "Q", _i(xs[i]), " ", _i(ys[i]),
                " ", _i(_mid(xs[i], xs[j])), " ", _i(_mid(ys[i], ys[j]))
            );
        }
        d = abi.encodePacked(d, "Z");
    }

    function _mid(int256 a, int256 b) internal pure returns (int256) { return (a + b) / 2; }

    /// 坐标都在 0..600，不会为负；单独一个函数是为了让上面的路径拼接读起来短一点
    function _i(int256 v) internal pure returns (string memory) {
        return _u(uint256(v < 0 ? int256(0) : v));
    }

    /// 这个宇宙的指纹：20 个参数拉出的平滑闭合曲线，档位配色，中心一点光
    /* 画的是**一个宇宙**，不是一张雷达图。
       上一版把 20 个参数连成多边形——信息量是有了，但缩到列表里的一寸见方就是一团毛刺，
       谁也看不出那是什么。这一版改成能一眼认出的东西：一个倾斜的星系盘 + 中心光核 + 散布的星点，
       参数仍然全都在（盘的倾角、旋臂弯度、星点位置、核心大小都由 u 向量决定），
       只是换成了"看得懂的形状"而不是"读得出的图表"。 */
    function _svg(bytes32 h, uint8 t, uint8 outcome, bool proven) internal pure returns (string memory) {
        string memory c = tierColor(t);
        bool dead = outcome != 9;                     // 9 = Observers possible
        bytes memory head = abi.encodePacked(_defs(c),
            '<rect width="600" height="600" fill="#05070d"/>',
            _nebula(h, c),                             // 两团模糊色块：梦幻感来源
            _stars(h),                                 // 背景星点
            '<rect width="600" height="600" fill="url(#bg)"/>'
        );
        // 倾斜的盘：倾角与椭率由参数定，死宇宙压得更扁、更暗（结构没长起来）
        uint256 tilt = 12 + (uOf(h, 3) * 56) / U_DEN;              // 12–68 度
        uint256 ry = dead ? 26 + (uOf(h, 5) * 40) / U_DEN          // 死：22–66
                          : 60 + (uOf(h, 5) * 80) / U_DEN;         // 活：60–140
        bytes memory disk = abi.encodePacked(
            '<g transform="rotate(', _u(tilt), ' 300 300)">',
            '<ellipse cx="300" cy="300" rx="215" ry="', _u(ry), '" fill="none" stroke="', c,
            '" stroke-opacity="', dead ? "0.20" : "0.45", '" stroke-width="1.5"/>',
            '<ellipse cx="300" cy="300" rx="150" ry="', _u(ry * 7 / 10), '" fill="none" stroke="', c,
            '" stroke-opacity="', dead ? "0.12" : "0.28", '" stroke-width="1"/>',
            '<ellipse cx="300" cy="300" rx="215" ry="', _u(ry), '" fill="url(#disk)" opacity="',
            dead ? "0.20" : "0.55", '"/></g>'
        );
        bytes memory core = abi.encodePacked(
            '<circle cx="300" cy="300" r="', dead ? "34" : "58", '" fill="url(#core)"/>'
        );
        return string(abi.encodePacked(head, disk, core, _labels(h, t, outcome, c, proven)));
    }

    /// 星云：两团高斯模糊的色块，位置与大小由参数定。SVG 原生滤镜，不引任何外部东西。
    function _nebula(bytes32 h, string memory c) internal pure returns (bytes memory) {
        uint256 x1 = 120 + (uOf(h, 7) * 200) / U_DEN;
        uint256 y1 = 150 + (uOf(h, 11) * 180) / U_DEN;
        uint256 x2 = 260 + (uOf(h, 13) * 220) / U_DEN;
        uint256 y2 = 260 + (uOf(h, 17) * 220) / U_DEN;
        return abi.encodePacked(
            '<g filter="url(#soft)" opacity="0.5">',
            '<ellipse cx="', _u(x1), '" cy="', _u(y1), '" rx="150" ry="110" fill="', c, '" opacity="0.55"/>',
            '<ellipse cx="', _u(x2), '" cy="', _u(y2), '" rx="120" ry="150" fill="#7a5cff" opacity="0.35"/>',
            '</g>'
        );
    }

    /// 背景星点：位置全由 u 向量定，同一个哈希永远是同一片星空
    function _stars(bytes32 h) internal pure returns (bytes memory s) {
        for (uint8 i = 0; i < 20; i++) {
            uint256 x = 20 + (uOf(h, i) * 560) / U_DEN;
            uint256 y = 20 + (uOf(h, uint8(19 - i)) * 560) / U_DEN;
            uint256 r = 1 + (uOf(h, i) % 3);
            s = abi.encodePacked(s, '<circle cx="', _u(x), '" cy="', _u(y), '" r="', _u(r),
                '" fill="#dfe6ff" opacity="0.', _u(3 + (uOf(h, i) % 5)), '"/>');
        }
    }

    /// 渐变定义单独拆出来，同样是为了不把栈压爆
    function _defs(string memory c) internal pure returns (bytes memory) {
        return abi.encodePacked(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" width="600" height="600">',
            '<defs><radialGradient id="bg" cx="50%" cy="46%" r="62%">',
            '<stop offset="0%" stop-color="', c, '" stop-opacity="0.20"/>',
            '<stop offset="55%" stop-color="', c, '" stop-opacity="0.05"/>',
            '<stop offset="100%" stop-color="#05070d" stop-opacity="0"/></radialGradient>',
            '<filter id="soft" x="-50%" y="-50%" width="200%" height="200%">',
            '<feGaussianBlur stdDeviation="46"/></filter>',
            '<radialGradient id="disk" cx="50%" cy="50%" r="50%">',
            '<stop offset="0%" stop-color="', c, '" stop-opacity="0.55"/>',
            '<stop offset="70%" stop-color="', c, '" stop-opacity="0.10"/>',
            '<stop offset="100%" stop-color="', c, '" stop-opacity="0"/></radialGradient>',
            '<radialGradient id="core" cx="50%" cy="50%" r="50%">',
            '<stop offset="0%" stop-color="#ffffff" stop-opacity="0.95"/>',
            '<stop offset="45%" stop-color="', c, '" stop-opacity="0.85"/>',
            '<stop offset="100%" stop-color="', c, '" stop-opacity="0"/></radialGradient></defs>'
        );
    }

    /// 文字单独拆出来：拼在 _svg 里会把栈压爆（stack too deep）
    function _labels(bytes32 h, uint8 t, uint8 outcome, string memory c, bool proven) internal pure returns (bytes memory) {
        return abi.encodePacked(
            '<text x="300" y="52" text-anchor="middle" fill="', c,
            '" font-family="Helvetica,Arial,sans-serif" font-size="13" letter-spacing="6" opacity="0.75">',
            "ARCBANG", "</text>",
            '<text x="300" y="536" text-anchor="middle" fill="#e6e9f5" font-family="Helvetica,Arial,sans-serif" font-size="21">',
            outcomeName(outcome), "</text>",
            /* 这里以前印 "D = x.x"，数字来自已删除的 dimOffOf —— 链上根本算不出维度。
               宁可不印，也不能印一个假的：真的维度在服务端出的图上（baseURI 那条路）。 */
            '<text x="300" y="558" text-anchor="middle" fill="', c,
            '" font-family="Helvetica,Arial,sans-serif" font-size="13" letter-spacing="2">',
            _upper(tierName(t)), "</text>",
            '<text x="300" y="580" text-anchor="middle" fill="#5a6480" font-family="monospace" font-size="11" letter-spacing="1">',
            _short(h), "</text>",
            /* 这枚章是链上自己盖的：铸造时 blockhash 对得上才有。
               够不到 256 块窗口的历史区块没有章 —— 不代表假，只代表链上没验过。 */
            proven
              ? '<g opacity="0.85"><circle cx="300" cy="26" r="9" fill="none" stroke="#5ad1a0" stroke-width="1.5"/>'
                '<path d="M296 26l3 3 5-6" fill="none" stroke="#5ad1a0" stroke-width="2" stroke-linecap="round"/></g>'
              : "",
            "</svg>"
        );
    }

    /// 只取哈希的头尾，整条 64 位在图上是一行看不清的蚂蚁
    function _short(bytes32 v) internal pure returns (string memory) {
        bytes memory full = bytes(_hex(v));           // 0x + 64
        bytes memory out = new bytes(15);             // 0x + 6 + … + 4
        uint256 i;
        for (i = 0; i < 8; i++) out[i] = full[i];     // 0x + 前 6 位
        out[8] = 0xe2; out[9] = 0x80; out[10] = 0xa6; // UTF-8 的省略号
        for (i = 0; i < 4; i++) out[11 + i] = full[62 + i];
        return string(out);
    }

    function _upper(string memory s) internal pure returns (string memory) {
        bytes memory b = bytes(s);
        for (uint256 i = 0; i < b.length; i++) {
            if (b[i] >= 0x61 && b[i] <= 0x7a) b[i] = bytes1(uint8(b[i]) - 32);
        }
        return string(b);
    }

    /* ------------------------------------------------------------ 小工具 */
    function _u(uint256 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        uint256 n = v;
        uint256 len;
        while (n != 0) { len++; n /= 10; }
        bytes memory b = new bytes(len);
        while (v != 0) { b[--len] = bytes1(uint8(48 + v % 10)); v /= 10; }
        return string(b);
    }

    function _hex(bytes32 v) internal pure returns (string memory) {
        bytes memory HEX = "0123456789abcdef";
        bytes memory out = new bytes(66);
        out[0] = "0";
        out[1] = "x";
        for (uint256 i = 0; i < 32; i++) {
            out[2 + i * 2] = HEX[uint8(v[i]) >> 4];
            out[3 + i * 2] = HEX[uint8(v[i]) & 0x0f];
        }
        return string(out);
    }
}

interface IERC721Receiver {
    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4);
}

/// 标准 base64（Brecht Devos 的写法，MIT）
library Base64 {
    string internal constant TABLE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    function encode(bytes memory data) internal pure returns (string memory) {
        if (data.length == 0) return "";
        string memory table = TABLE;
        string memory result = new string(4 * ((data.length + 2) / 3));

        assembly {
            let tablePtr := add(table, 1)
            let resultPtr := add(result, 32)
            for {
                let dataPtr := data
                let endPtr := add(data, mload(data))
            } lt(dataPtr, endPtr) {

            } {
                dataPtr := add(dataPtr, 3)
                let input := mload(dataPtr)

                mstore8(resultPtr, mload(add(tablePtr, and(shr(18, input), 0x3F))))
                resultPtr := add(resultPtr, 1)
                mstore8(resultPtr, mload(add(tablePtr, and(shr(12, input), 0x3F))))
                resultPtr := add(resultPtr, 1)
                mstore8(resultPtr, mload(add(tablePtr, and(shr(6, input), 0x3F))))
                resultPtr := add(resultPtr, 1)
                mstore8(resultPtr, mload(add(tablePtr, and(input, 0x3F))))
                resultPtr := add(resultPtr, 1)
            }
            switch mod(mload(data), 3)
            case 1 {
                mstore8(sub(resultPtr, 1), 0x3d)
                mstore8(sub(resultPtr, 2), 0x3d)
            }
            case 2 {
                mstore8(sub(resultPtr, 1), 0x3d)
            }
        }
        return result;
    }
}
