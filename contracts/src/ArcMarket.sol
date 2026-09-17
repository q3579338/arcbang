// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * ARCBANG · 宇宙 NFT 挂单簿（Arc 主网 chainId 5042）
 * ------------------------------------------------------------
 * MirrorMarket 的**无币版**。BANG 在这份合约里一个字都不存在 ——
 * 没有 inBang、没有代币地址、没有「BANG 单抽 5%」那一档，也没有 ERC-20 那条支付路径。
 * ARCBANG 只卖 NFT（specs/arcbang-v1.md），一个不发行的代币不该在市场合约里留半个字段：
 * 留着就意味着「以后也许会有」，而那是句假话。
 *
 * **只有一种计价：native**。Arc 的 native 就是 USDC（18 位小数），
 * 所以挂单的 price 是 wei，1 USDC = 1e18；buy 时 msg.value 必须**精确等于** price。
 * 不多收也不少收：多收的那点钱合约没有退款路径（退款要么多一次外部调用、
 * 要么在合约里留余额），少收则是卖家吃亏。精确匹配是这两个坑之间唯一不用解释的选择。
 *
 * ---- 为什么是「不托管」（lazy），而不是把 NFT 押进合约 ----
 * 照抄 MirrorMarket 的选择：卖家先 approve / setApprovalForAll，成交时才 transferFrom。
 *   · 挂单期间 NFT 留在卖家钱包里 —— 钱包、二级市场、本站的「我的宇宙」都照常看得见它，
 *     不会出现「我的 NFT 去哪了」这种只能靠客服回答的问题；
 *   · 挂单和撤单各省一次 721 转账的 gas；
 *   · 合约不持有任何人的资产，被攻破时也没有一池子 NFT 可偷。
 * 代价是挂单会失效（卖家转走了 token，或撤了授权）。这条代价我们正面接住：
 *   · buy 在成交前再查一次，失效就带着明确原因 revert（不是一个看不懂的 "call failed"）；
 *   · checkListing() 让前端提前把这类挂单标灰，用户不用撞一次 revert 才知道；
 *   · cancelStale() 让**任何人**都能把失效挂单清掉 —— 卖家把 NFT 卖去别处之后
 *     通常不会回来撤单，挂单簿上那些买不成的单只能靠别人清。它只对真正失效的单开放，
 *     有效的单谁也撤不了，所以这不是一个「别人能撤我的单」的后门。
 *
 * ---- 版税：尊重 ERC-2981，但不无条件相信它 ----
 * 成交时先问 NFT 合约 royaltyInfo(tokenId, price)，把版税打给它指定的 receiver。
 * **上限 10%，超过按 10% 截断**：这个市场的 nft 地址虽然是 immutable 的 ArcUniverse
 * （它自己的 MAX_ROYALTY_BPS 就是 10%），但截断这一道仍然要有 ——
 * 合约该防的是「被调用方坑」这一类，而不是「我信任的那个地址不会坑我」。
 * royaltyInfo 调不通 / 返回值不成形 / receiver 是 0 地址，一律按**没有版税**处理，
 * 成交照常：一个二级市场不该因为版税接口抽风就整个停摆。
 *
 * 分账（全部在同一笔交易里转出，合约一分钱都不留）：
 *     版税   → royaltyInfo 给的 receiver（≤ 10%）
 *     手续费 → treasury（feeBps，默认 1%，硬上限 10%）
 *     其余   → 卖家
 * 三笔任意一笔转账失败就整笔 revert：与其让 NFT 转走了而钱卡住，不如什么都不发生。
 * 最坏情况卖家仍能拿到 80%（10% + 10% 两个硬上限相加），所以那个减法不会下溢。
 *
 * 合约里没有 receive()、没有 withdraw()：没有任何路径让钱停在这里，
 * 也就不需要一个「把钱取出来」的函数 —— 而那种函数恰恰是 rug 的标准形状。
 * owner 能做的只有三件事：改收款地址、改费率（守 10% 上限）、交出 owner。
 * 不能改价、不能撤别人的单、没有暂停、没有代理升级。
 *
 * 无外部依赖（防重入是本文件里自写的一把锁，不引 OpenZeppelin）。
 */

interface IERC721Like {
    function ownerOf(uint256 id) external view returns (address);
    function getApproved(uint256 id) external view returns (address);
    function isApprovedForAll(address owner, address operator) external view returns (bool);
    function transferFrom(address from, address to, uint256 id) external;
}

interface IERC2981Like {
    function royaltyInfo(uint256 tokenId, uint256 salePrice)
        external
        view
        returns (address receiver, uint256 royaltyAmount);
}

contract ArcMarket {
    /* ------------------------------------------------------------ 挂单
       字段顺序就是 ABI 里的字段顺序，前端有手写解码（web/market.html decListingStruct）
       按下标读，**只能往后加字段，不能往中间插**。

       token / amount / is1155 三个字段在这份合约里是**恒定值**
       （分别恒为 nft、1、false）—— 挂单只收 ArcUniverse 这一个 ERC-721 合约。
       照抄 MirrorMarket 保留它们，是为了让前端与索引器的解码与主线**同形**：
       market.html 的 decListingStruct / decActivePage 按下标和步长读结构体，
       少一个字段就要重写整段解码，而那段解码同时服务 bnb / btc 两站。
       多出来的两格 storage 在 Arc 上是 0.0008 USDC 的事（baseFee 固定 20 gwei），
       拿它换「三站共用一份解码代码」很划算。 */
    struct Listing {
        address seller;
        address token;     // 恒等于 nft
        uint256 id;        // tokenId
        uint256 amount;    // 恒为 1（ERC-721）
        uint256 price;     // 总价，wei（1 USDC = 1e18）
        bool is1155;       // 恒为 false
        bool active;
    }

    Listing[] public listings;                          // listingId = 下标，从 0 开始
    mapping(address => uint256[]) private _bySeller;

    /* ------------------------------------------------------------ 只收这一个 NFT 合约
       immutable：可改的话，owner 随时能把市场指到一个自己造的假 ArcUniverse 上，
       让买家以为买到的是宇宙 NFT。部署那一刻填的就是终身的那一个。 */
    address public immutable nft;

    /* ------------------------------------------------------------ 费率与治理 */
    uint16 public constant MAX_FEE_BPS = 1000;          // 手续费硬上限 10%，改不动
    uint16 public constant MAX_ROYALTY_BPS = 1000;      // 版税截断线 10%，改不动

    address public owner;
    address public treasury;
    /// 成交抽 1%，全额进国库
    uint16 public feeBps = 100;

    uint256 private _lock = 1;                          // 防重入

    event Listed(
        uint256 indexed listingId,
        address indexed seller,
        address indexed token,
        uint256 id,
        uint256 amount,
        uint256 price
    );
    /// by = 谁撤的。卖家自己撤时 by == seller；失效挂单被路人清掉时 by 是那个路人
    event Cancelled(uint256 indexed listingId, address indexed seller, address indexed by);
    event PriceChanged(uint256 indexed listingId, address indexed seller, uint256 oldPrice, uint256 newPrice);
    event Sold(
        uint256 indexed listingId,
        address indexed buyer,
        address indexed seller,
        uint256 price,
        uint256 fee,
        uint256 royalty,
        address royaltyReceiver
    );
    event FeeChanged(uint16 feeBps);
    event TreasuryChanged(address treasury);
    event OwnershipTransferred(address indexed from, address indexed to);

    /**
     * @param nft_      ArcUniverse 的地址。只有这一个合约的 token 能在这里挂单。
     *        这里就要求它是个**有代码的地址** —— 打错成 EOA 的话所有挂单都会失败，
     *        而 immutable 修不回来。
     * @param treasury_ 手续费收款地址（传 0 就用部署者）。**抽成直接打到这里**，
     *        合约里没有提取函数，也不需要有。
     */
    constructor(address nft_, address treasury_) {
        require(nft_ != address(0), "market: nft is zero");
        require(nft_.code.length != 0, "market: nft is not a contract");
        nft = nft_;
        owner = msg.sender;
        treasury = treasury_ == address(0) ? msg.sender : treasury_;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "market: not owner");
        _;
    }

    modifier nonReentrant() {
        require(_lock == 1, "market: reentrant");
        _lock = 2;
        _;
        _lock = 1;
    }

    /* ============================================================ 挂单 */
    /**
     * 挂一个单。不收 token 参数 —— 这个市场只认 nft 那一个合约，
     * 收一个「必须等于某个常量」的参数只会让人以为它可以是别的。
     *
     * 挂单时就把「持有 + 已授权」检查一遍，早失败早知道；成交时再查一遍，因为中间可能变。
     * 同一枚 token 被挂多次不拦：拦它要多一张 mapping，而重复挂单的后果只是
     * 「成交一单之后其余几单失效」，失效挂单本来就有 cancelStale 兜底。
     *
     * @param price 总价，wei。1 USDC = 1e18。
     */
    function list(uint256 id, uint256 price) external returns (uint256 listingId) {
        require(price != 0, "market: price is zero");

        uint8 status = _status(msg.sender, id);
        require(status != 2, "market: seller does not own token");
        require(status != 3, "market: market not approved");

        listingId = listings.length;
        listings.push(
            Listing({
                seller: msg.sender,
                token: nft,
                id: id,
                amount: 1,
                price: price,
                is1155: false,
                active: true
            })
        );
        _bySeller[msg.sender].push(listingId);
        emit Listed(listingId, msg.sender, nft, id, 1, price);
    }

    /// 改价。只有卖家能改，改的只是自己那一单的 price，别的什么都不动。
    function updatePrice(uint256 listingId, uint256 newPrice) external {
        require(listingId < listings.length, "market: no such listing");
        Listing storage l = listings[listingId];
        require(l.seller == msg.sender, "market: not the seller");
        require(l.active, "market: listing not active");
        require(newPrice != 0, "market: price is zero");
        uint256 old = l.price;
        l.price = newPrice;
        emit PriceChanged(listingId, msg.sender, old, newPrice);
    }

    function cancel(uint256 listingId) external {
        require(listingId < listings.length, "market: no such listing");
        Listing storage l = listings[listingId];
        require(l.seller == msg.sender, "market: not the seller");
        require(l.active, "market: listing not active");
        l.active = false;
        emit Cancelled(listingId, msg.sender, msg.sender);
    }

    /**
     * 清掉一条**已经失效**的挂单：卖家已不再持有那枚 token，或者撤了给市场的授权。
     * 任何人都能调 —— 卖家把 NFT 卖到别处之后通常不会回来撤单，
     * 挂单簿上那些点了必然 revert 的单只能靠别人清。
     *
     * 有效的单在这里一律 revert，所以这**不是**一条「别人能撤我的单」的路：
     * 想让自己的单不被清掉，只要保持持有和授权 —— 那本来就是挂单成立的前提。
     */
    function cancelStale(uint256 listingId) external {
        require(listingId < listings.length, "market: no such listing");
        Listing storage l = listings[listingId];
        require(l.active, "market: listing not active");
        require(_status(l.seller, l.id) != 0, "market: listing is still valid");
        address seller = l.seller;
        l.active = false;
        emit Cancelled(listingId, seller, msg.sender);
    }

    /**
     * 买。msg.value 必须**精确等于** price。
     *
     * checks-effects-interactions：先把 active 置 false，再转 NFT，最后付款。
     * 付款放在转移之后：卖家的 receive() 触发时他已经不是持有人了，手里没有可动的东西。
     * nonReentrant 挡住任何一笔回调里的重入。
     */
    function buy(uint256 listingId) external payable nonReentrant {
        require(listingId < listings.length, "market: no such listing");
        Listing storage l = listings[listingId];

        // ---- checks（挂单字段读一次，后面 effects / interactions 共用）
        require(l.active, "market: listing not active");
        address seller = l.seller;
        uint256 id = l.id;
        uint256 price = l.price;
        require(msg.value == price, "market: wrong price");
        uint8 status = _status(seller, id);
        require(status != 2, "market: seller no longer owns token");
        require(status != 3, "market: seller revoked approval");

        // ---- effects
        l.active = false;

        (address rcv, uint256 royalty) = _royalty(id, price);
        uint256 fee = (price * feeBps) / 10000;
        /* royalty ≤ 10%、fee ≤ 10%，两者相加最多 20% —— 这个减法不会下溢。
           上限不是靠注释保证的：royalty 在 _royalty 里截断，fee 由 MAX_FEE_BPS 夹死。 */
        uint256 toSeller = price - royalty - fee;

        // ---- interactions：先交货，再付钱
        IERC721Like(nft).transferFrom(seller, msg.sender, id);
        _pay(rcv, royalty);
        _pay(treasury, fee);
        _pay(seller, toSeller);

        emit Sold(listingId, msg.sender, seller, price, fee, royalty, rcv);
    }

    /**
     * 转 native。金额为 0 就什么都不做（省一次外部调用，也免得给 0 地址打款）。
     * 失败就 revert 整笔：NFT 已经在上一行转走了，这里吞掉失败等于白送。
     */
    function _pay(address to, uint256 amount) internal {
        if (amount == 0) return;
        require(to != address(0), "market: payee is zero");
        (bool ok,) = to.call{value: amount}("");
        require(ok, "market: transfer failed");
    }

    /**
     * 问 NFT 合约的 ERC-2981 版税，并**把结果当成不可信输入处理**：
     *   · 调不通（不支持 2981 / 函数 revert）→ 没有版税，成交照常
     *   · 返回值不成形（少于两个字）→ 同上
     *   · receiver 是 0 地址 → 版税归零（打给 0 地址等于烧掉卖家的钱）
     *   · 金额超过 price 的 10% → **截断到 10%**，而不是 revert：
     *     revert 会让一个版税配错的 NFT 永远卖不出去，截断则是「照规矩最多这么多」。
     */
    function _royalty(uint256 id, uint256 price) internal view returns (address rcv, uint256 amount) {
        (bool ok, bytes memory ret) =
            nft.staticcall(abi.encodeWithSelector(IERC2981Like.royaltyInfo.selector, id, price));
        if (!ok || ret.length < 64) return (address(0), 0);
        (rcv, amount) = abi.decode(ret, (address, uint256));
        if (rcv == address(0)) return (address(0), 0);
        uint256 cap = (price * MAX_ROYALTY_BPS) / 10000;
        if (amount > cap) amount = cap;
        if (amount == 0) rcv = address(0);
    }

    /* ============================================================ 视图 */
    function listingCount() external view returns (uint256) {
        return listings.length;
    }

    /// 这个卖家挂过的所有单（含已取消/已售出，用 listings(id) 查各自状态）
    function listingsOf(address seller) external view returns (uint256[] memory) {
        return _bySeller[seller];
    }

    /**
     * 从 offset 开始扫，最多返回 limit 条仍然 active 的挂单。
     * @return ids        对应的 listingId
     * @return items      挂单内容
     * @return nextOffset 下一页从这里接着扫；等于 listingCount() 表示扫完了
     */
    function activeListings(uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory ids, Listing[] memory items, uint256 nextOffset)
    {
        uint256 total = listings.length;
        if (offset > total) offset = total;
        uint256[] memory buf = new uint256[](limit);
        uint256 n;
        uint256 i = offset;
        while (i < total && n < limit) {
            if (listings[i].active) {
                buf[n++] = i;
            }
            i++;
        }
        ids = new uint256[](n);
        items = new Listing[](n);
        for (uint256 j = 0; j < n; j++) {
            ids[j] = buf[j];
            items[j] = listings[buf[j]];
        }
        nextOffset = i;
    }

    /**
     * 这个单现在还买得成吗 —— 前端拿它把失效的挂单标灰，而不是让用户撞一次 revert。
     * 0 = 可买  1 = 已取消或已售出  2 = 卖家已不持有  3 = 卖家撤了授权
     * （2 / 3 也正是 cancelStale 认的那两种「失效」。）
     */
    function checkListing(uint256 listingId) external view returns (uint8) {
        require(listingId < listings.length, "market: no such listing");
        Listing storage l = listings[listingId];
        if (!l.active) return 1;
        return _status(l.seller, l.id);
    }

    /**
     * 这一单成交时钱怎么分 —— 前端在「确认买入」那一步照着它显示明细，
     * 免得卖家事后才发现到手的不是挂单价。三项之和恒等于 price。
     */
    function quote(uint256 listingId)
        external
        view
        returns (uint256 price, address royaltyReceiver, uint256 royalty, uint256 fee, uint256 toSeller)
    {
        require(listingId < listings.length, "market: no such listing");
        Listing storage l = listings[listingId];
        price = l.price;
        (royaltyReceiver, royalty) = _royalty(l.id, price);
        fee = (price * feeBps) / 10000;
        toSeller = price - royalty - fee;
    }

    /* ============================================================ 治理 */
    function setTreasury(address t) external onlyOwner {
        require(t != address(0), "market: treasury is zero");
        treasury = t;
        emit TreasuryChanged(t);
    }

    function setFeeBps(uint16 bps) external onlyOwner {
        require(bps <= MAX_FEE_BPS, "market: fee above 10%");
        feeBps = bps;
        emit FeeChanged(bps);
    }

    function transferOwnership(address o) external onlyOwner {
        require(o != address(0), "market: owner is zero");
        emit OwnershipTransferred(owner, o);
        owner = o;
    }

    /* ============================================================ 内部 */
    /// 0 = 一切就绪  2 = 不持有  3 = 没授权给市场
    function _status(address seller, uint256 id) internal view returns (uint8) {
        /* ownerOf 对不存在的 token 会 revert（ArcUniverse 抛 NoToken()），
           所以这里走 staticcall 而不是直接调 —— 调用失败也是一种「不持有」，
           不该让整笔交易带着一个看不懂的自定义错误炸掉。 */
        (bool ok, bytes memory ret) =
            nft.staticcall(abi.encodeWithSelector(IERC721Like.ownerOf.selector, id));
        if (!ok || ret.length < 32 || abi.decode(ret, (address)) != seller) return 2;
        if (
            !IERC721Like(nft).isApprovedForAll(seller, address(this))
                && IERC721Like(nft).getApproved(id) != address(this)
        ) return 3;
        return 0;
    }
}
