/*
 * ui/about-content.js —— "关于与来源"面板的静态内容
 * ------------------------------------------------------------
 * 由 README.md、research/data/SOURCES.md、engine/README.md 摘录，摘录日期：2026-08-16。
 * 手工整理，不新编内容：每一条都能在上述三份文档里找到原文（各条目的 from 字段标了出处小节）。
 * 数据有更新时请重新摘录，不要在这里凭记忆改数字。
 *
 * 只导出数据：window.MirrorAbout.content。面板的打开/关闭与装配在 ui/app.js 里。
 */
(function (root) {
  'use strict';

  var content = {
    excerptDate: '2026-08-16',
    sourceDocs: 'README.md · research/data/SOURCES.md · engine/README.md',

    /* ---- 这是什么、不是什么（README.md §一 诚实原则） ---- */
    what: {
      lede: '给宇宙一组初始条件，从奇点开始把它算一遍，看这样的宇宙会长成什么样，再决定它能不能生出会问这个问题的人。',
      from: 'README.md 开头与 §一',
      points: [
        // 21：Engine.PARAMS.length 的实测值（页脚那行"21 个公认基础参数"取的就是它），原文写的 20 已经对不上
        { k: '一个参数都不编造', v: '默认输入是 21 个物理学界普遍接受的基本参数（标准模型 + ΛCDM + 观测量，PDG 2022 / Planck 2018），每一项都带 status:\'accepted\' 与文献出处 ref。空间维数 D=3 标注为 accepted-fact, no-mechanism——它是事实，但现有物理里没有推导它的机制。' },
        { k: '推测性模块显式标记', v: '弦气维数、弦论景观标 speculative，慢滚暴胀标 mainstream-model；UI 里是显式开关。' },
        /* 这条原来写着"9 个维"——引擎早就换成 18 级维序阶梯了（见 engine.js 的 R_DIM_EMERGE 公式，
           D 最大 18，链上实测确实出现过 D=14、D=18），而且每一维的解开度被量化到 {0, 0.5, 1}，
           所以 D 只会是整数或整数+0.5。这两件事都会直接影响用户怎么读 D，必须写对。 */
        { k: '维数默认由弦气模型（推测）生成', v: '维数默认由弦气模型（推测）生成，而不是直接输入 D：空间维数是 18 个维的解开度之和 D=Σs_i，由 T₀/T_H、n_w、κ 三个参数决定。每一维的解开度量化成"蜷缩 0 / 半开 0.5 / 全开 1"三档，因此 D 只会取整数或整数+0.5（不会出现 3.1749 这种数），范围 0–18。可在参数编辑器里关闭弦气模块，改为直接输入 D（直接输入时范围是 1–11）。这一项标 speculative，请按推测看待。' },
        { k: '每条结论都标注依据等级', v: '演化层每一步给出 {公式, 输入, 数值, 阈值, 判定}，并标 basis。' },
        { k: '镜像里的星球与地表是过程生成的示意，不是模拟结果', v: '星系、恒星系、行星地表由参数 + 种子确定性生成，画面上会标"示意"。3D 视图里，PM N 体那一层标"模拟"，星系与地表那一层标"示意"，本星系群与百光年内亮星那一层标"数据"。' },
        { k: '模拟给出的是"像我们的宇宙"，不可能复现我们这一个宇宙', v: '相同参数一定得到相同结果（决定论：参数哈希即随机种子），但那是同一套统计规律下的另一次实现，不是我们这一个宇宙的历史。' }
      ],
      novel: '界面与文案致敬刘慈欣《镜子》的"创世游戏 / 镜像"体验。小说只提供界面与文案的参考，不提供物理；物理部分全部是真实计算，参数取物理学界公认的测量值。',
      // 固定说明（本条不是从文档摘录，是对单位约定的解释，与分析面板"常数核对"末尾同一句）
      units: '有量纲常数（光速 c、引力常数 G、普朗克常数 ħ、电子电量 e）在不同宇宙里可以给出数值，但数值取决于单位约定：固定哪三个量、让哪两个随 α 与 α_G 变，是约定不是物理。分析面板可在约定 A（固定 e、ħ、m_p）/ B（固定 c、e、m_p）/ C（固定 c、ħ、m_p）之间切换，同一个宇宙会得到不同的 c、G、ħ、e。跨宇宙真正不变的物理内容是无量纲量 α=e²/(4πε₀ħc) 与 α_G=Gm_p²/(ħc)（Duff 2002；Albrecht & Magueijo 1999）。'
    },

    /* ---- 标签图例（README.md §一 + engine/README.md §0/§4/§8） ---- */
    legends: [
      {
        group: '参数与结论的可信度（status）',
        from: 'README.md §一 1–2；engine/README.md §8 状态总表',
        items: [
          { tag: '公认', cls: 'st-accepted', v: 'accepted：物理学界普遍接受的测量值（PDG 2022 / Planck 2018 等），在现有物理里就是"测量而非推导"的量。' },
          { tag: '公认事实 · 无生成机制', cls: 'st-fact', v: 'accepted-fact, no-mechanism：是事实，但现有物理里没有推导它的机制——空间维数 D=3 属于这一类。' },
          { tag: '主流模型 · 未证实', cls: 'st-mainstream', v: 'mainstream-model：主流理论模型，公式是真计算，但模型本身尚未被证实——慢滚暴胀属于这一类。' },
          { tag: '推测', cls: 'st-speculative', v: 'speculative：推测性模块；引文只支持定性机制，定量式是本引擎的玩具延伸——弦气维数（默认开、可关）、弦论景观（默认关）属于这一类。' }
        ]
      },
      {
        group: '每一步计算的依据等级（basis）',
        from: 'engine/README.md §0、§4、§5',
        items: [
          { tag: '计算', cls: 'rp-basis computed', v: 'computed：直接数值计算得到。' },
          { tag: '标度关系', cls: 'rp-basis scaling', v: 'scaling：标度关系 / 量纲估计，只用比值，不保证绝对口径。' },
          { tag: '启发式', cls: 'rp-basis heuristic', v: 'heuristic：启发式判据（文献给出的经验窗口）。' },
          { tag: '玩具', cls: 'rp-basis toy', v: 'toy：玩具模型（推测性模块开启后才会出现）。' }
        ]
      },
      {
        group: '画面这一层是什么（顶部标注）',
        from: 'README.md §一 4',
        items: [
          { tag: '模拟', cls: '', v: 'PM N 体那一层：真实引力 + Friedmann 背景的数值模拟。' },
          { tag: '示意', cls: '', v: '星系、恒星系、行星、地表那一层：由参数 + 种子过程生成的可视化，不是模拟结果。' },
          { tag: '数据', cls: '', v: '本星系群与百光年内亮星那一层：来自公开观测目录（见下方数据来源）。' }
        ]
      }
    ],

    /* ---- 数据来源（research/data/SOURCES.md） ---- */
    sources: {
      from: 'research/data/SOURCES.md（生成脚本 tools/fetch-localdata.js、tools/fetch-cities.js）',
      note: 'ui/localdata.js 里的每一个数值都来自下列公开目录或已发表文献，目录中缺失的字段一律写 null，不做任何估计或补全。',
      rows: [
        { name: 'HYG Database v4.1', use: '百光年内亮星（636 条，其中有专名的 140 条）', license: 'CC BY-SA 2.5', date: '2026-08-16', ref: 'hygdata_v41.csv（Hipparcos + Yale Bright Star Catalog + Gliese），astronexus/HYG-Database' },
        { name: 'McConnachie 2012, AJ 144, 4', use: '本星系群成员（74 条）与银河系形态类型 S(B)bc', license: 'CDS / VizieR 使用条款', date: '2026-08-16', ref: 'VizieR J/AJ/144/4/catalog（论文 tables 1–5 合并表），doi:10.26093/cds/vizier.51440004' },
        { name: 'SIMBAD（M 87）+ Mei et al. 2007', use: '室女座星系团方向与距离（16.5 ± 0.1(ran) ± 1.1(sys) Mpc）', license: 'CDS / SIMBAD 使用条款', date: '2026-08-16', ref: 'Mei et al. 2007, ApJ 655, 144（ACS Virgo Cluster Survey XIII）' },
        { name: 'Natural Earth 1:10m Populated Places', use: '地球夜面灯光与地表附近的示意建筑（3089 条，pop_max ≥ 100000）', license: '公有领域（Free for any use, no permission required）', date: '2026-08-16', ref: 'Made with Natural Earth. Free vector and raster map data @ naturalearthdata.com；城市位置为真实数据，建筑为示意' },
        { name: 'GRAVITY Collaboration 2019, A&A 625, L10', use: '太阳距银心 R₀ = 8.178 kpc（8178 ± 13(stat) ± 22(sys) pc）', license: '已发表文献', date: '—', ref: 'arXiv:1904.05721' },
        { name: 'Bland-Hawthorn & Gerhard 2016, ARA&A 54, 529', use: '银河系盘标长、厚盘标高、棒半长、恒星质量、位力质量、Sgr A* 质量', license: '已发表文献', date: '—', ref: 'arXiv:1602.07702；恒星盘至今没有观测到的截断半径，故 diskRadius_kpc 写 null' },
        { name: 'Bennett & Bovy 2019, MNRAS 482, 1417', use: '太阳距银道面高度 z = 20.8 ± 0.3 pc', license: '已发表文献', date: '—', ref: 'arXiv:1809.03507' },
        { name: 'Xu et al. 2013, ApJ 769, 15', use: '太阳所在旋臂：猎户臂（本地臂）', license: '已发表文献', date: '—', ref: '"On the Nature of the Local Arm"' },
        { name: 'Hipparcos/ESA SP-1200 §1.5.3', use: '赤道坐标 → 银道坐标换算（IAU 1958 银道系常量）', license: '已发表文献', date: '—', ref: '北银极 (192.85948°, +27.12825°)，北天极银经 122.93192°' }
      ],
      cnNames: '中文星名与本星系群条目的中文名均为通用译名（中国星官名或习惯译名），不属于目录字段；目录里没有对应习惯译名的条目写 null。'
    },

    /* ---- 参数出处（engine/README.md §2 基础参数表） ---- */
    params: {
      from: 'engine/README.md §2（20 个基础参数，全部 accepted）',
      rows: [
        { src: 'PDG 2022', v: 'αₛ(M_Z)=0.1179、v=246.22 GeV、m_H=125.25 GeV、mₑ=0.51099895 MeV、m_u=2.16 MeV、m_d=4.67 MeV、δ_CKM=1.196、τ_n=878.4 s、G_F=1.1663788×10⁻⁵ GeV⁻²' },
        { src: 'CODATA 2018', v: 'α = 1/137.035999084' },
        { src: 'Planck 2018', v: 'H₀=67.4 km/s/Mpc、Ω_bh²=0.02237、Ω_ch²=0.1200、Ω_Λ=0.685、A_s=2.1×10⁻⁹、n_s=0.965、Ω_k=0（+BAO：0.0007±0.0019）' },
        { src: 'Fixsen 2009', v: 'T_CMB = 2.7255 K（FIRAS）' },
        { src: 'LEP', v: 'N_gen = 3（N_ν = 2.984 ± 0.008）' },
        { src: 'Froustey 2020 / Bennett 2021', v: 'N_eff = 3.044（标准三代中微子）' },
        { src: 'Tegmark 1997', v: '空间维数 D = 3，标 accepted-fact, no-mechanism（Ehrenfest/Tegmark 判据）' }
      ]
    },

    /* ---- 没有被模拟的东西（engine/README.md §9 诚实清单，摘要） ---- */
    notModeled: {
      from: 'engine/README.md §9 什么没有被模拟（诚实清单）',
      rows: [
        '传递函数是幂律 + 有效谱指数近似；σ(M) 用一个星系尺度校准点外推；坍缩用 Press–Schechter 的 νσ=δ_c。',
        '复合用 Saha 平衡近似（Peebles 非平衡解把去耦推到 z≈1090）。',
        'BBN 用 Steigman 拟合 + n/p 比值修正，不是核反应网络；氘核/双质子阈值是文献标度估计。',
        'Λ_QCD 用一环 n_f=5 口径（≈87 MeV），非 PDG Λ_MS-bar，只用其比值；m_p、α_G、mₑ/mₚ、m_n−m_p 均为标度关系。',
        '恒星用 Adams 2008 的量纲标度，没有恒星结构方程。',
        '弦气维数（默认开、可关）、弦论景观（默认关）是玩具模型（speculative）：引文只支持定性机制，定量式为本引擎玩具延伸；慢滚公式为真计算但模型未证实。',
        '行星地表、生命出现是过程生成的示意：只比较时间尺度、宜居带、重元素供给与 Tegmark–Rees 的 Q 窗口。',
        'N 体是 2D 周期盒 PM 引力，只用于可视化结构形成的相对快慢与团块度。'
      ]
    },

    /* ---- 键盘 / 操作速查（抄自 app.js 的提示条与 universe3d / mirror 的 hint 文案） ---- */
    keys: [
      { scene: '起爆参数页', items: [
        ['↑ ↓ / Home / End', '在下拉目录里移动'],
        ['Enter / 空格', '选中这一行创世参数'],
        ['Esc', '关闭下拉目录 / 参数编辑器'],
        ['下拉目录', '只列"我保存的"（编号 #0001 起）；引擎自带的示例参数组在"参数编辑器 → 加载示例参数组（不入目录）"里，加载后可改再引爆，不占编号']
      ] },
      { scene: '引爆动画', items: [
        ['Enter', '跳过动画；稳定演化阶段按 Enter 或点击进入宇宙'],
        ['Esc', '退回起爆页']
      ] },
      { scene: '进入宇宙（3D）', items: [
        ['WASD / QE', '移动（Shift 加速 · Ctrl 减速）'],
        ['右键拖拽', '转向；右键单击 = 弹出菜单（分析面板是第一项）'],
        ['滚轮', '调速度（Ctrl + 滚轮改视场角）'],
        ['F / H', '飞到最密处 / 飞入随机晕'],
        ['空格', '播放 / 暂停宇宙时间'],
        ['A / F2', '分析面板（长按 A = 相机左平移）'],
        ['M', '进入镜像（仅 D=3 且可能诞生观察者时）'],
        ['R', '随机引爆（分析面板打开时）'],
        ['Esc', '退回起爆页']
      ] },
      { scene: '镜像浏览', items: [
        ['双击', '放大进入下一层（星系 → 恒星系 → 行星 → 地表）'],
        ['Backspace', '返回上一级'],
        ['[ ]', '前后移动时间'],
        ['滚轮', '行星/地表层 = 高度（向下滚动降低）'],
        ['方向键', '地表层平移视点'],
        ['Esc', '退出镜像']
      ] },
      { scene: '任何时候', items: [
        ['Esc', '关闭当前面板'],
        ['页脚"深色/浅色"', '切换主题（记住选择，默认跟随系统）']
      ] }
    ]
  };

  /* ---- 中英双语
   * 这个文件只有数据，面板是 ui/app.js 拼 innerHTML，t() 伸不进去。
   * 所以在导出前把每个字符串过一遍词典（词条见 web/i18n-mirror.js）：
   *   - 没有译文的原样退回中文；cls 名、日期、文献、DOI 不在词典里，过一遍等于没动
   *   - 上面的 content 一个字都没改，翻译只发生在这一层
   * app.js 每次打开面板都重新读 MirrorAbout.content，所以切语言时重建一份就够了。 */
  var TR = function (s) { return (root.MirrorI18n ? root.MirrorI18n.t(s, 'mirror') : s); };
  function translate(v) {
    var i, k, a, o;
    if (typeof v === 'string') return TR(v);
    if (Array.isArray(v)) { a = []; for (i = 0; i < v.length; i++) a.push(translate(v[i])); return a; }
    if (v && typeof v === 'object') { o = {}; for (k in v) if (Object.prototype.hasOwnProperty.call(v, k)) o[k] = translate(v[k]); return o; }
    return v;
  }

  root.MirrorAbout = root.MirrorAbout || {};
  root.MirrorAbout.content = translate(content);
  if (root.document && root.document.addEventListener) {
    root.document.addEventListener('mirror:lang', function () { root.MirrorAbout.content = translate(content); });
  }
})(typeof window !== 'undefined' ? window : this);
