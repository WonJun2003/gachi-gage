// 사진 처리 (브라우저에서 바로, 무료): 인스타 규격 변환, 자동 보정, 홍보 카드 만들기
(function () {
  const MAX = 1440;

  async function toBitmap(src) {
    if (src instanceof HTMLCanvasElement || src instanceof ImageBitmap) return src;
    if (typeof src === 'string') src = await (await fetch(src)).blob();
    return createImageBitmap(src);
  }

  // 세로 4:5 ~ 가로 1.91:1 범위로 가운데 자르고 긴 변 1440px로
  async function fitInsta(src) {
    const img = await toBitmap(src);
    let sw = img.width, sh = img.height, sx = 0, sy = 0;
    const r = sw / sh;
    if (r < 0.8) { const nh = sw / 0.8; sy = (sh - nh) / 2; sh = nh; }
    else if (r > 1.91) { const nw = sh * 1.91; sx = (sw - nw) / 2; sw = nw; }
    const scale = Math.min(1, MAX / Math.max(sw, sh));
    const c = document.createElement('canvas');
    c.width = Math.round(sw * scale);
    c.height = Math.round(sh * scale);
    c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c;
  }

  const PRESETS = {
    auto: { label: '자동 보정', gamma: 1, sat: 1.12, warm: 0, sharpen: 0.25 },
    bright: { label: '밝게', gamma: 0.82, sat: 1.08, warm: 0, sharpen: 0.15 },
    warm: { label: '따뜻하게', gamma: 0.92, sat: 1.18, warm: 0.06, sharpen: 0.2 },
    vivid: { label: '선명하게', gamma: 0.96, sat: 1.25, warm: 0, sharpen: 0.6 },
  };

  // 밝기 범위 자동 맞춤(레벨) + 감마 + 채도 + 색온도 + 선명도
  async function enhance(src, presetKey = 'auto') {
    const p = PRESETS[presetKey] || PRESETS.auto;
    const c = await fitInsta(src);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const im = ctx.getImageData(0, 0, c.width, c.height);
    const d = im.data;
    const n = d.length / 4;

    const hist = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) hist[(d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8]++;
    let lo = 0, hi = 255, acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > n * 0.005) { lo = v; break; } }
    acc = 0;
    for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > n * 0.005) { hi = v; break; } }
    if (hi - lo < 40) { lo = Math.max(0, lo - 20); hi = Math.min(255, hi + 20); }

    const lut = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) {
      const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
      lut[v] = Math.round(Math.pow(t, p.gamma) * 255);
    }
    for (let i = 0; i < d.length; i += 4) {
      let r = lut[d[i]], g = lut[d[i + 1]], b = lut[d[i + 2]];
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      r = l + (r - l) * p.sat;
      g = l + (g - l) * p.sat;
      b = l + (b - l) * p.sat;
      if (p.warm) { r *= 1 + p.warm; b *= 1 - p.warm; }
      d[i] = r; d[i + 1] = g; d[i + 2] = b;
    }

    if (p.sharpen > 0) {
      const w = c.width, h = c.height;
      const src2 = new Uint8ClampedArray(d);
      const a = p.sharpen;
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = (y * w + x) * 4;
          for (let k = 0; k < 3; k++) {
            const v = 5 * src2[i + k] - src2[i - 4 + k] - src2[i + 4 + k] - src2[i - w * 4 + k] - src2[i + w * 4 + k];
            d[i + k] = src2[i + k] + (v - src2[i + k]) * a;
          }
        }
      }
    }
    ctx.putImageData(im, 0, 0);
    return c;
  }

  // ---------- 홍보 카드 ----------
  const FONT = "'Pretendard', 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif";
  const TEMPLATES = {
    bottom: '사진 + 아래 글',
    frame: '포스터형',
    text: '글자만',
  };

  function wrapText(ctx, text, maxW) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    for (const w of words) {
      const t = line ? `${line} ${w}` : w;
      if (ctx.measureText(t).width <= maxW) { line = t; continue; }
      if (line) lines.push(line);
      // 한 단어가 너무 길면 글자 단위로 자르기
      if (ctx.measureText(w).width > maxW) {
        let part = '';
        for (const ch of w) {
          if (ctx.measureText(part + ch).width > maxW) { lines.push(part); part = ch; } else part += ch;
        }
        line = part;
      } else line = w;
    }
    if (line) lines.push(line);
    return lines;
  }

  function cover(ctx, img, x, y, w, h) {
    const r = Math.max(w / img.width, h / img.height);
    const sw = w / r, sh = h / r;
    ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  async function makeCard({ photo, headline, subline, storeName, template = 'bottom', color = '#e8590c' }) {
    const W = 1080, H = 1350;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const img = photo ? await toBitmap(photo) : null;
    if (!img) template = 'text';

    const drawTexts = (x, yBottom, maxW, align, colorMain, colorSub) => {
      ctx.textAlign = align;
      ctx.textBaseline = 'alphabetic';
      ctx.font = `800 96px ${FONT}`;
      const hl = wrapText(ctx, headline, maxW).slice(0, 3);
      ctx.font = `600 46px ${FONT}`;
      const sl = subline ? wrapText(ctx, subline, maxW).slice(0, 2) : [];
      let y = yBottom - sl.length * 62 - (sl.length ? 20 : 0) - (hl.length - 1) * 112;
      ctx.fillStyle = colorMain;
      ctx.font = `800 96px ${FONT}`;
      for (const l of hl) { ctx.fillText(l, x, y); y += 112; }
      y += sl.length ? 6 : 0;
      ctx.fillStyle = colorSub;
      ctx.font = `600 46px ${FONT}`;
      for (const l of sl) { ctx.fillText(l, x, y); y += 62; }
    };

    if (template === 'bottom') {
      cover(ctx, img, 0, 0, W, H);
      const g = ctx.createLinearGradient(0, H * 0.45, 0, H);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.78)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      drawTexts(72, H - 150, W - 144, 'left', '#ffffff', 'rgba(255,255,255,0.9)');
      ctx.fillStyle = color;
      ctx.font = `700 36px ${FONT}`;
      const tw = ctx.measureText(storeName).width;
      roundRect(ctx, 72, H - 112, tw + 56, 64, 32);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'left';
      ctx.fillText(storeName, 100, H - 68);
    } else if (template === 'frame') {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      roundRect(ctx, 60, 60, W - 120, 860, 36);
      ctx.clip();
      cover(ctx, img, 60, 60, W - 120, 860);
      ctx.restore();
      drawTexts(W / 2, H - 150, W - 160, 'center', '#ffffff', 'rgba(255,255,255,0.92)');
      ctx.font = `700 36px ${FONT}`;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.textAlign = 'center';
      ctx.fillText(storeName, W / 2, H - 70);
    } else {
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, '#fff4e6');
      g.addColorStop(1, '#ffd8a8');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, W, 24);
      drawTexts(W / 2, H / 2 + 120, W - 180, 'center', '#1d1d1b', '#5c5a55');
      ctx.font = `800 40px ${FONT}`;
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.fillText(storeName, W / 2, H - 110);
    }
    return c;
  }

  const toJpeg = (canvas, q = 0.9) => new Promise((res) => canvas.toBlob(res, 'image/jpeg', q));

  window.Imaging = { fitInsta, enhance, makeCard, toJpeg, PRESETS, TEMPLATES };
})();
