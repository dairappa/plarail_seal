// データモデル・プリセット定義

export const PAPERS = [
  // k.border: 「フチあり」印刷時の縮小を打ち消す事前拡大 %。
  //   L判  103.6 … 実機（ローソン系シャープ機）で 108% 書き出し → 50 mm が 52.1 mm に印刷された実測から算出
  //   2L判 104   … Gigamix Online の実測（80 mm → 77 mm）
  //   スクエア 104 … 実測なし。上記から推定
  { id: 'L',   name: 'L判 89×127 mm（コンビニ シール紙）',       w: 89,  h: 127, cvs: true,  k: { border: 103.6, borderless: 96 } },
  { id: 'SQ',  name: 'スクエア 127×127 mm（コンビニ シール紙）', w: 127, h: 127, cvs: true,  k: { border: 104, borderless: 97 } },
  { id: '2L',  name: '2L判 127×178 mm（コンビニ シール紙）',     w: 127, h: 178, cvs: true,  k: { border: 104, borderless: 97 } },
  { id: 'A4',  name: 'A4 210×297 mm（家庭用シール台紙）',       w: 210, h: 297, cvs: false },
  { id: 'A5',  name: 'A5 148×210 mm',                          w: 148, h: 210, cvs: false },
  { id: 'HG',  name: 'はがき 100×148 mm',                       w: 100, h: 148, cvs: false },
  { id: 'custom', name: 'カスタム（任意寸法）', w: 89, h: 127, cvs: false },
];

export const FONTS = [
  { id: 'DotGothic16',        name: 'DotGothic16（LED ドット風）', weights: [400] },
  { id: 'Noto Sans JP',       name: 'Noto Sans JP（ゴシック）',     weights: [400, 700, 900] },
  { id: 'BIZ UDPGothic',      name: 'BIZ UDPゴシック',             weights: [400, 700] },
  { id: 'M PLUS 1p',          name: 'M PLUS 1p',                   weights: [500, 800] },
  { id: 'Zen Kaku Gothic New',name: 'Zen 角ゴシック New',           weights: [500, 900] },
  { id: 'sans-serif',         name: '端末の標準ゴシック',           weights: [400, 700] },
];

export const LED_SWATCHES = ['#ffffff', '#ff9a00', '#ff2d2d', '#2ee05a', '#3b8dff', '#ffe600', '#00d5d5', '#000000'];

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function defaultProject() {
  const p = PAPERS[0];
  return {
    version: 1,
    paper: { preset: p.id, w: p.w, h: p.h, margin: 1 },
    printMode: 'cvs-border',
    scaleK: p.k.border,
    calib: {},          // 用紙×印刷方法ごとに覚えたサイズ補正 %（例: { 'L:cvs-border': 103.6 }）
    colorCorr: defaultColorCorr(),
    dpi: 300,
    gap: 1.5,
    bleed: 0.3,
    marks: 'corner',
    ruler: true,
    showUnprintable: true,
    items: [
      makeItem('sign', PRESETS[0].item),
    ],
  };
}

/** 背景（塗り）: 帯のリスト。mode が solid なら bands[0] だけを使う */
export function solidFill(color) {
  return { mode: 'solid', bands: [{ weight: 1, color, grad: false, color2: '#ffffff', gradDir: 'v' }] };
}
export function makeBand(color, weight = 1) {
  return { weight, color, grad: false, color2: '#ffffff', gradDir: 'v' };
}
/** 項目の塗りを返す（旧データは bg から生成） */
export function fillOf(item) {
  const f = item.fill;
  if (!f || !Array.isArray(f.bands) || f.bands.length === 0) return solidFill(item.bg || '#ffffff');
  return f;
}

const SIGN_BASE = {
  type: 'sign', name: '', w: 10, h: 2.5, copies: 2,
  bg: '#000000', fill: solidFill('#000000'), font: 'Noto Sans JP', weight: 700,
  padding: 8, colGap: 6, letterSpacing: 0,
  ledDots: false, ledRows: 24,
  kind: { enabled: true, text: '普通', color: '#ffffff', textColor: '#000000', style: 'plain', ratio: 32, radius: 0, en: 'Local' },
  dest: { enabled: true, text: '名古屋', color: '#ff9a00', en: 'Nagoya', style: 'plain', boxColor: '#ffffff', radius: 0 },
  station: { enabled: true, text: '', twoLine: true, style: 'box', color: '#2f4fd0', textColor: '#ffffff', size: 95, radius: 18 },
  enRatio: 36, enColor: '#ffffff', enLayout: 'below',
};

const TEXT_BASE = {
  type: 'text', name: '', w: 8, h: 2, copies: 2,
  bg: '#ffffff', fill: solidFill('#ffffff'), color: '#000000', text: 'モ1101',
  font: 'Noto Sans JP', weight: 700, align: 'center', padding: 8, letterSpacing: 0,
};

const IMAGE_BASE = {
  type: 'image', name: '', w: 10, h: 3, copies: 1,
  bg: '#ffffff', fill: solidFill('#ffffff'), src: '', fit: 'contain', edits: null,
};

// 前照灯・尾灯。ケース（台座）の中にランプを横か縦に並べる。寸法の % はケースの内側の高さに対する割合
export const LAMP_COLORS = {
  head: '#fff6d8',     // 前照灯（電球色寄りの白）
  led: '#f2f8ff',      // LED 前照灯（青白い）
  tail: '#e4261c',     // 尾灯
  marker: '#ff9a1f',   // 標識灯・通過標識灯
};
export function makeLamp(color = LAMP_COLORS.head) {
  return { color };
}
const LAMP_HOUSING = { enabled: true, shape: 'rect', topRatio: 70, skew: 15, color: '#1a1a1a', radius: 30, inset: 0, border: 0, borderColor: '#c0c0c0' };
const housing = o => ({ ...LAMP_HOUSING, ...o });
const LAMP_BASE = {
  type: 'lamp', name: '', w: 6, h: 3, copies: 1, pair: 'single',
  bg: '#ffffff', fill: solidFill('#ffffff'),
  // shape: rect 長方形 / trapezoid 台形 / slant 片側が斜め / parallelogram 平行四辺形
  housing: housing({}),
  lampShape: 'round', lampSize: 70, lampAspect: 1, lampRadius: 20,
  lampStyle: 'glow', ring: 0, ringColor: '#c0c0c0', lampSkew: true,
  arrange: 'row', distribute: 'spread', gap: 20, padding: 12, rotate: 0,
  lamps: [makeLamp(LAMP_COLORS.head), makeLamp(LAMP_COLORS.head)],
};

export const PRESETS = [
  {
    id: 'kintetsu-1a-led',
    name: '近鉄 1A系 / 8A系 側面 LED 表示（普通 名古屋 E01）',
    item: {
      ...SIGN_BASE, name: '近鉄 側面LED 普通 名古屋',
      kind: { text: '普通', color: '#2f4fd0', textColor: '#ffffff', style: 'fill', ratio: 30, radius: 0, en: '' },
      dest: { text: '名古屋', color: '#ffffff', en: 'Nagoya' },
      station: { text: 'E01', twoLine: true, style: 'box', color: '#2f4fd0', textColor: '#ffffff', size: 95, radius: 18 },
    },
  },
  {
    id: 'kintetsu-1a-led-exp',
    name: '近鉄 側面 LED 表示（急行 大阪難波）',
    item: {
      ...SIGN_BASE, name: '近鉄 側面LED 急行 大阪難波',
      kind: { text: '急行', color: '#ff2d2d', textColor: '#000000', style: 'plain', ratio: 32, radius: 0, en: 'Express' },
      dest: { text: '大阪難波', color: '#ff9a00', en: 'Osaka-Namba' },
    },
  },
  {
    id: 'kintetsu-exp-orange',
    name: '近鉄 側面 LED 表示（急行 宇治山田・橙塗り種別）',
    item: {
      ...SIGN_BASE, name: '近鉄 側面LED 急行 宇治山田',
      kind: { text: '急行', color: '#f08a1a', textColor: '#000000', style: 'fill', ratio: 34, radius: 12, en: 'Express' },
      dest: { text: '宇治山田', color: '#ffffff', en: 'Ujiyamada' },
    },
  },
  {
    id: 'kintetsu-en-right',
    name: '近鉄 側面 LED 表示（英字を横に・急行 五十鈴川）',
    item: {
      ...SIGN_BASE, name: '近鉄 側面LED 急行 五十鈴川（英字横）',
      kind: { enabled: true, text: '急行', color: '#ff2d2d', textColor: '#000000', style: 'plain', ratio: 26, radius: 0, en: '' },
      dest: { enabled: true, text: '五十鈴川', color: '#ffffff', en: 'Isuzugawa', style: 'plain', boxColor: '#ffffff', radius: 0 },
      enRatio: 45, enLayout: 'right',
    },
  },
  {
    id: 'dest-box',
    name: '行先を枠付きに（幕式・賢島）',
    item: {
      ...SIGN_BASE, name: '幕式 枠付き行先', bg: '#ffffff', fill: solidFill('#ffffff'),
      kind: { enabled: false, text: '', color: '#000000', textColor: '#000000', style: 'plain', ratio: 0, radius: 0, en: '' },
      dest: { enabled: true, text: '賢島', color: '#000000', en: 'Kashikojima', style: 'box', boxColor: '#000000', radius: 10 },
      enRatio: 30, enColor: '#000000',
    },
  },
  {
    id: 'led-dots',
    name: 'LED ドット風（DotGothic16・ドット効果あり）',
    item: {
      ...SIGN_BASE, name: 'LED ドット風', font: 'DotGothic16', weight: 400, ledDots: true, ledRows: 24,
      kind: { text: '快速急行', color: '#ffe600', textColor: '#000000', style: 'plain', ratio: 36, radius: 0, en: 'Rapid Exp.' },
      dest: { text: '鳥羽', color: '#ff9a00', en: 'Toba' },
    },
  },
  {
    id: 'roll-sign',
    name: '幕式 方向幕（白地・黒文字）',
    item: {
      ...SIGN_BASE, name: '幕式 方向幕', bg: '#ffffff', fill: solidFill('#ffffff'),
      kind: { text: '急行', color: '#d40000', textColor: '#ffffff', style: 'fill', ratio: 30, radius: 0, en: '' },
      dest: { text: '大阪上本町', color: '#000000', en: 'Osaka-Uehommachi' },
      enRatio: 30, enColor: '#000000',
    },
  },
  {
    id: 'roll-sign-simple',
    name: '幕式 行先のみ（英字なし）',
    item: {
      ...SIGN_BASE, name: '幕式 行先のみ', bg: '#ffffff', fill: solidFill('#ffffff'),
      kind: { text: '', color: '#000000', textColor: '#000000', style: 'plain', ratio: 0, radius: 0, en: '' },
      dest: { text: '賢島', color: '#000000', en: '' },
      enRatio: 0,
    },
  },
  {
    id: 'stripe-band',
    name: '車両帯（3 色ストライプ・文字なし）',
    item: {
      ...SIGN_BASE, name: '車両帯 ストライプ', w: 20, h: 3, copies: 2, bg: '#c8102e',
      fill: { mode: 'rows', bands: [makeBand('#c8102e', 40), makeBand('#ffffff', 20), makeBand('#1d3f8f', 40)] },
      kind: { enabled: false, text: '', color: '#ffffff', textColor: '#000000', style: 'plain', ratio: 30, radius: 0, en: '' },
      dest: { enabled: false, text: '', color: '#ffffff', en: '', style: 'plain', boxColor: '#ffffff', radius: 0 },
      station: { enabled: false, text: '', twoLine: true, style: 'box', color: '#2f4fd0', textColor: '#ffffff', size: 95, radius: 18 },
    },
  },
  {
    id: 'gradient-plate',
    name: '車番（グラデーション地）',
    item: {
      ...TEXT_BASE, name: '車番 グラデ地', text: '1101', color: '#ffffff', bg: '#1d3f8f',
      fill: { mode: 'solid', bands: [{ weight: 1, color: '#1d3f8f', grad: true, color2: '#7fb2ff', gradDir: 'v' }] },
    },
  },
  {
    id: 'lamp-round2',
    name: '前照灯: 丸目 2 灯',
    item: { ...LAMP_BASE, name: '前照灯 丸目 2 灯', w: 6, h: 3 },
  },
  {
    id: 'lamp-round1-ring',
    name: '前照灯: 丸目 1 灯（銀の縁）',
    item: {
      ...LAMP_BASE, name: '前照灯 丸目 1 灯', w: 3.5, h: 3.5, copies: 2,
      housing: housing({ enabled: false, color: '#1a1a1a', radius: 50 }),
      lampSize: 100, ring: 14, ringColor: '#c8c8c8', lampStyle: 'lens', padding: 0, lamps: [makeLamp(LAMP_COLORS.head)],
    },
  },
  {
    id: 'lamp-square2',
    name: '前照灯: 角型 2 灯（黒ケース）',
    item: {
      ...LAMP_BASE, name: '前照灯 角型 2 灯', w: 7, h: 2.6,
      housing: housing({ enabled: true, color: '#111111', radius: 12 }),
      lampShape: 'rect', lampAspect: 1.5, lampRadius: 15, lampSize: 68,
    },
  },
  {
    id: 'lamp-head-tail-row',
    name: '前照灯・尾灯: 横並び（左右ペア）',
    item: {
      ...LAMP_BASE, name: '前照灯・尾灯 横並び', w: 5.5, h: 2.5, pair: 'mirror',
      housing: housing({ enabled: true, color: '#111111', radius: 50 }),
      lamps: [makeLamp(LAMP_COLORS.tail), makeLamp(LAMP_COLORS.head)],
    },
  },
  {
    id: 'lamp-head-tail-col',
    name: '前照灯・尾灯: 縦並び',
    item: {
      ...LAMP_BASE, name: '前照灯・尾灯 縦並び', w: 2.6, h: 5, copies: 2, arrange: 'column',
      housing: housing({ enabled: true, color: '#111111', radius: 30 }),
      lampSize: 80, lamps: [makeLamp(LAMP_COLORS.head), makeLamp(LAMP_COLORS.tail)],
    },
  },
  {
    id: 'lamp-trapezoid',
    name: '前照灯: 台形ケース 2 灯',
    item: {
      ...LAMP_BASE, name: '前照灯 台形ケース 2 灯', w: 7, h: 3,
      housing: housing({ shape: 'trapezoid', topRatio: 72, color: '#111111', radius: 14 }),
      lampSize: 62,
    },
  },
  {
    id: 'lamp-slant-pair',
    name: '前照灯・尾灯: 片側が斜めのケース（左右ペア）',
    item: {
      ...LAMP_BASE, name: '前照灯・尾灯 斜めケース', w: 6, h: 2.6, pair: 'mirror',
      housing: housing({ shape: 'slant', topRatio: 78, color: '#111111', radius: 16 }),
      lampSize: 64, distribute: 'center', gap: 30,
      lamps: [makeLamp(LAMP_COLORS.tail), makeLamp(LAMP_COLORS.head)],
    },
  },
  {
    id: 'lamp-led-slanted',
    name: '前照灯: 傾いた LED ライン（左右ペア）',
    item: {
      ...LAMP_BASE, name: '前照灯 傾いた LED ライン', w: 7, h: 2, pair: 'mirror',
      housing: housing({ shape: 'parallelogram', skew: 25, color: '#111111', radius: 30 }),
      lampShape: 'pill', lampAspect: 5, lampSize: 55, padding: 16, lamps: [makeLamp(LAMP_COLORS.led)],
    },
  },
  {
    id: 'lamp-led-line',
    name: '前照灯: LED ライン（細長い帯）',
    item: {
      ...LAMP_BASE, name: '前照灯 LED ライン', w: 8, h: 1.6, copies: 2,
      housing: housing({ enabled: true, color: '#111111', radius: 50 }),
      lampShape: 'pill', lampAspect: 6, lampSize: 55, padding: 18, lamps: [makeLamp(LAMP_COLORS.led)],
    },
  },
  {
    id: 'lamp-tail2',
    name: '尾灯: 丸 2 灯（赤）',
    item: { ...LAMP_BASE, name: '尾灯 丸 2 灯', w: 5, h: 2.5, lamps: [makeLamp(LAMP_COLORS.tail), makeLamp(LAMP_COLORS.tail)] },
  },
  {
    id: 'car-number',
    name: '車番（文字シール）',
    item: { ...TEXT_BASE, name: '車番' },
  },
];

function baseOf(type) {
  return type === 'sign' ? SIGN_BASE : type === 'text' ? TEXT_BASE : type === 'lamp' ? LAMP_BASE : IMAGE_BASE;
}

export function makeItem(type, overrides = {}) {
  const base = baseOf(type);
  // 深いコピー（kind/dest オブジェクトを共有しないように）
  const item = JSON.parse(JSON.stringify({ ...base, ...overrides }));
  item.id = uid();
  return item;
}

export function itemLabel(item) {
  if (item.name) return item.name;
  if (item.type === 'sign') {
    const parts = [];
    if (item.kind?.enabled !== false) parts.push(item.kind?.text);
    if (item.dest?.enabled !== false) parts.push(item.dest?.text);
    if (item.station?.enabled !== false) parts.push(item.station?.text);
    return parts.filter(Boolean).join(' ') || '行先表示';
  }
  if (item.type === 'text') return (item.text || '文字').split('\n')[0];
  if (item.type === 'lamp') return '前照灯・尾灯';
  return '画像';
}

/** シート上に並ぶ枚数（左右ペアは 1 組で 2 枚） */
export function sheetCount(item) {
  const n = Math.max(0, Math.floor(item.copies ?? 1));
  return item.type === 'lamp' && item.pair === 'mirror' ? n * 2 : n;
}

/** 行先表示に描かれる文字が 1 つもないか */
export function signIsBlank(item) {
  if (item.type !== 'sign') return false;
  const k = item.kind || {}, d = item.dest || {}, st = item.station || {};
  const kindOn = k.enabled !== false && !!(k.text || k.en);
  const destOn = d.enabled !== false && !!(d.text || d.en);
  const stOn = st.enabled !== false && !!(st.text && String(st.text).trim());
  return !kindOn && !destOn && !stOn;
}

export function paperById(id) {
  return PAPERS.find(p => p.id === id) || PAPERS[PAPERS.length - 1];
}

/** 印刷方法と用紙から既定のサイズ補正 % を返す */
export function defaultScaleK(project) {
  const p = paperById(project.paper.preset);
  if (project.printMode === 'home' || !p.cvs || !p.k) return 100;
  return project.printMode === 'cvs-borderless' ? p.k.borderless : p.k.border;
}

/** 色補正の設定。profile は色見本の写真から作る（colorcal.js の fitProfile） */
export function defaultColorCorr() {
  return { enabled: false, strength: 100, preview: false, profile: null };
}

/** 用紙×印刷方法のキー（キャリブレーション結果の保存先） */
export function calibKey(project) {
  return `${project.paper.preset}:${project.printMode}`;
}
/** 覚えている補正があればそれ、なければ既定値 */
export function scaleKFor(project) {
  const k = project.calib?.[calibKey(project)];
  return Number.isFinite(k) ? k : defaultScaleK(project);
}

/** 有効な印刷領域（true mm）: 用紙 / max(1, k) を中央配置 */
export function usableArea(project) {
  const k = Math.max(1, (project.scaleK || 100) / 100);
  const w = project.paper.w / k, h = project.paper.h / k;
  return { x: (project.paper.w - w) / 2, y: (project.paper.h - h) / 2, w, h };
}

/** 古い保存データの穴埋め */
export function normalizeProject(raw) {
  const d = defaultProject();
  const p = { ...d, ...raw };
  p.paper = { ...d.paper, ...(raw.paper || {}) };
  p.calib = { ...(raw.calib || {}) };
  p.colorCorr = { ...defaultColorCorr(), ...(raw.colorCorr || {}) };
  p.items = (raw.items || []).map(it => {
    const base = baseOf(it.type);
    const m = JSON.parse(JSON.stringify({ ...base, ...it }));
    if (it.type === 'lamp') {
      m.housing = { ...LAMP_BASE.housing, ...(it.housing || {}) };
      m.lamps = Array.isArray(it.lamps) ? it.lamps.map(l => ({ ...makeLamp(), ...l })) : JSON.parse(JSON.stringify(LAMP_BASE.lamps));
    }
    if (it.type === 'sign') {
      m.kind = { ...SIGN_BASE.kind, ...(it.kind || {}) };
      if (it.kind && it.kind.textColor == null) m.kind.textColor = it.kind.style === 'fill' ? (it.bg || '#000000') : m.kind.color;
      m.dest = { ...SIGN_BASE.dest, ...(it.dest || {}) };
      m.station = { ...SIGN_BASE.station, ...(it.station || {}) };
      if (!m.enLayout) m.enLayout = 'below';
    }
    if (!it.fill || !Array.isArray(it.fill.bands) || !it.fill.bands.length) m.fill = solidFill(it.bg || base.bg || '#ffffff');
    else m.fill = { mode: it.fill.mode || 'solid', bands: it.fill.bands.map(b => ({ ...makeBand('#ffffff'), ...b })) };
    m.bg = m.fill.bands[0].color;
    if (!m.id) m.id = uid();
    return m;
  });
  return p;
}
