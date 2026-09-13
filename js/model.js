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
  bg: '#ffffff', src: '', fit: 'cover',
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
    id: 'car-number',
    name: '車番（文字シール）',
    item: { ...TEXT_BASE, name: '車番' },
  },
];

export function makeItem(type, overrides = {}) {
  const base = type === 'sign' ? SIGN_BASE : type === 'text' ? TEXT_BASE : IMAGE_BASE;
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
  return '画像';
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
  p.items = (raw.items || []).map(it => {
    const base = it.type === 'sign' ? SIGN_BASE : it.type === 'text' ? TEXT_BASE : IMAGE_BASE;
    const m = JSON.parse(JSON.stringify({ ...base, ...it }));
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
