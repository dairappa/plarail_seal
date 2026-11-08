// 色補正のテスト用: プリンタと写真の合成（ページ内で実行する関数を文字列で渡す）
// printer(rgb): 暗く（γ 1.35）、彩度が落ち、青寄りに出るプリンタ。紙は少し黄ばんだ白
// photo: 色見本を少し回転・縮小して灰色の机の上に置き、暖色かぶり・露出 0.9 で撮影
export const SIM_SRC = `
  window.__sim = (() => {
    const printer = ([r, g, b]) => {
      const f = v => 255 * Math.pow(v / 255, 1.35);
      let R = f(r), G = f(g), B = f(b);
      const L = 0.3 * R + 0.59 * G + 0.11 * B;
      R = L + (R - L) * 0.8; G = L + (G - L) * 0.8; B = L + (B - L) * 0.8;   // 彩度 80%
      R = R * 0.95; B = Math.min(255, B * 1.04 + 6);                          // 青寄り
      const paper = [250, 247, 236];
      return [R * paper[0] / 255, G * paper[1] / 255, B * paper[2] / 255];
    };
    const camera = ([r, g, b]) => [Math.min(255, r * 0.9 * 1.04), Math.min(255, g * 0.9), Math.min(255, b * 0.9 * 0.93)];
    /** 色見本キャンバスを「印刷 → 撮影」した写真と、マーク中心の写真座標を返す */
    function shoot(chart, markersPx) {
      const c = document.createElement('canvas'); c.width = chart.width; c.height = chart.height;
      const x = c.getContext('2d'); x.drawImage(chart, 0, 0);
      const im = x.getImageData(0, 0, c.width, c.height); const d = im.data;
      for (let o = 0; o < d.length; o += 4) { const p = camera(printer([d[o], d[o + 1], d[o + 2]])); d[o] = p[0]; d[o + 1] = p[1]; d[o + 2] = p[2]; }
      x.putImageData(im, 0, 0);
      const ph = document.createElement('canvas'); ph.width = Math.round(chart.width * 1.1); ph.height = Math.round(chart.height * 1.05);
      const px = ph.getContext('2d');
      px.fillStyle = '#6f6a62'; px.fillRect(0, 0, ph.width, ph.height);
      const ang = 3 * Math.PI / 180, sc = 0.9, tx = ph.width * 0.08, ty = ph.height * 0.03;
      px.setTransform(sc * Math.cos(ang), sc * Math.sin(ang), -sc * Math.sin(ang), sc * Math.cos(ang), tx, ty);
      px.drawImage(c, 0, 0);
      px.setTransform(1, 0, 0, 1, 0, 0);
      const T = ([u, v]) => [sc * Math.cos(ang) * u - sc * Math.sin(ang) * v + tx, sc * Math.sin(ang) * u + sc * Math.cos(ang) * v + ty];
      return { photo: ph, pts: markersPx.map(T) };
    }
    return { printer, camera, shoot };
  })();
`;
