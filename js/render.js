'use strict';
/* ГЕГЕМОН — Отрисовка карты на canvas
   Классический <script>: общие переменные и функции живут в глобальной области, порядок подключения см. в index.html. */

// -----------------------------------------------------------------------
// 11. ВЕКТОРНЫЙ РЕНДЕРИНГ КАРТЫ (60FPS, RETINA CRISP)
// -----------------------------------------------------------------------
function getProvinceFillColor(p) {
  if (game.mapMode === 'political') return game.countries[p.ownerId].color;
  if (game.mapMode === 'diplomatic') {
    const ref = game.playerId !== null ? game.playerId : game.selectedCountryId;
    if (ref === null) return '#3f4f63';
    if (p.ownerId === ref) return '#12a86c';
    if (isAtWar(ref, p.ownerId)) return '#dc3038';
    if (isAllied(ref, p.ownerId)) return '#2680e0';
    if (hasPact(ref, p.ownerId)) return '#2aa8c4';
    return '#3e4a5c';
  }
  // Военная тепловая карта
  const t = Math.min(1, Math.log10(Math.max(10, provPower(p))) / 4.2);
  if (t < 0.5) {
    const k = t * 2;
    return `rgb(${Math.round(36 + k * 194)},${Math.round(54 + k * 116)},${Math.round(80 - k * 50)})`;
  }
  const k = (t - 0.5) * 2;
  return `rgb(${Math.round(230 + k * 22)},${Math.round(170 - k * 130)},${Math.round(30 - k * 10)})`;
}

const view = { x0: 0, y0: 0, x1: 0, y1: 0 };
function bboxVisible(b) { return b.maxX >= view.x0 && b.minX <= view.x1 && b.maxY >= view.y0 && b.minY <= view.y1; }
function pointVisible(x, y, pad) { return x >= view.x0 - pad && x <= view.x1 + pad && y >= view.y0 - pad && y <= view.y1 + pad; }

function render() {
  ctx.fillStyle = '#0b1628';
  ctx.fillRect(0, 0, game.viewW, game.viewH);
  if (game.phase === 'loading') return;

  const z = game.cam.zoom;
  ctx.save();
  ctx.translate(game.cam.x, game.cam.y);
  ctx.scale(z, z);
  // видимая область в мировых координатах — по ней отсекаем то, чего не видно
  view.x0 = -game.cam.x / z; view.y0 = -game.cam.y / z;
  view.x1 = view.x0 + game.viewW / z; view.y1 = view.y0 + game.viewH / z;

  // 1. Тонкая штабная координатная сетка океана
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.065)';
  ctx.lineWidth = 1 / z;
  ctx.beginPath();
  for (let gx = 0; gx <= WORLD_W; gx += WORLD_W / 18) { ctx.moveTo(gx, 0); ctx.lineTo(gx, WORLD_H); }
  for (let gy = 40; gy <= WORLD_H; gy += 110) { ctx.moveTo(0, gy); ctx.lineTo(WORLD_W, gy); }
  ctx.stroke();

  // 2. Морские переправы (пунктирные синие маршруты)
  const selId = game.selectedProvId;
  ctx.save();
  ctx.setLineDash([5 / z, 5 / z]);
  for (const r of game.seaRoutes) {
    const hi = selId && (r.a === selId || r.b === selId);
    if (!hi && z < 0.72) continue;
    ctx.strokeStyle = hi ? 'rgba(56, 189, 248, 0.92)' : 'rgba(96, 165, 250, 0.25)';
    ctx.lineWidth = (hi ? 2.4 : 1.05) / z;
    ctx.beginPath();
    ctx.moveTo(r.x1, r.y1);
    ctx.quadraticCurveTo(r.mx, r.my, r.x2, r.y2);
    ctx.stroke();
  }
  ctx.restore();

  // 3. Заливка всех векторных провинций
  for (let i = 1; i < game.provinces.length; i++) {
    const p = game.provinces[i];
    if (!bboxVisible(p.bbox)) continue;
    ctx.fillStyle = getProvinceFillColor(p);
    ctx.fill(p.path);
  }

  // 4. Внутренние границы провинций (тонкие) и государственные границы (чёткие)
  if (game.internalBorderPath) {
    ctx.strokeStyle = 'rgba(8, 14, 26, 0.42)';
    ctx.lineWidth = 0.75 / z;
    ctx.stroke(game.internalBorderPath);
  }
  if (game.countryBorderPath) {
    ctx.strokeStyle = '#070d18';
    ctx.lineWidth = 1.65 / z;
    ctx.lineJoin = 'round';
    ctx.stroke(game.countryBorderPath);
  }

  const pulse = 0.62 + Math.sin(game.time * 4.8) * 0.28;

  // 5. Подсветка выбранной страны в режиме старта
  if (game.phase === 'select' && game.selectedCountryId !== null) {
    const sc = game.countries[game.selectedCountryId];
    ctx.save();
    ctx.fillStyle = `rgba(253, 224, 71, ${0.14 + pulse * 0.1})`;
    ctx.strokeStyle = `rgba(253, 224, 71, ${0.7 + pulse * 0.25})`;
    ctx.lineWidth = 2.2 / z;
    for (const pid of sc.provinces) {
      ctx.fill(game.provinces[pid].path);
      ctx.stroke(game.provinces[pid].path);
    }
    ctx.restore();
  }

  // 6. Подсветка выбранной провинции и доступных соседей
  if (game.phase === 'playing' && selId) {
    const selP = game.provinces[selId];
    if (selP) {
      if (selP.ownerId === game.playerId) {
        for (const { id: nbId } of getReachableNeighbors(selId)) {
          const nb = game.provinces[nbId];
          let fillC = null, strokeC = null;
          if (nb.ownerId === game.playerId) {
            fillC = `rgba(16, 185, 129, ${0.16 + pulse * 0.1})`;
            strokeC = `rgba(52, 211, 153, ${0.7 + pulse * 0.25})`;
          } else if (isAtWar(game.playerId, nb.ownerId)) {
            fillC = `rgba(239, 68, 68, ${0.22 + pulse * 0.14})`;
            strokeC = `rgba(248, 113, 113, ${0.78 + pulse * 0.22})`;
          } else if (!isAllied(game.playerId, nb.ownerId) && !hasPact(game.playerId, nb.ownerId)) {
            fillC = `rgba(245, 158, 11, ${0.12 + pulse * 0.08})`;
            strokeC = `rgba(251, 191, 36, ${0.58 + pulse * 0.22})`;
          }
          if (fillC) {
            ctx.fillStyle = fillC;
            ctx.strokeStyle = strokeC;
            ctx.lineWidth = 1.9 / z;
            ctx.fill(nb.path);
            ctx.stroke(nb.path);
          }
        }
      }
      // Белая рамка активной провинции
      ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.4 / z;
      ctx.fill(selP.path);
      ctx.stroke(selP.path);
    }
  }

  // 7. Подсветка при наведении (десктоп)
  if (game.hoveredProvId && game.hoveredProvId !== selId) {
    const hp = game.provinces[game.hoveredProvId];
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = 1.4 / z;
    ctx.fill(hp.path);
    ctx.stroke(hp.path);
  }

  // 8. Названия государств
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const c of game.countries) {
    if (!c.alive || !c.labelPos.visible) continue;
    const lp = c.labelPos;
    if (lp.size * z < 7.5) continue;
    const alpha = z > 4.2 ? 0.3 : 0.88;
    ctx.font = `700 ${lp.size}px "Oswald", "Inter", sans-serif`;
    ctx.lineWidth = Math.max(1.3, lp.size * 0.22);
    ctx.strokeStyle = `rgba(6, 12, 22, ${alpha * 0.92})`;
    ctx.fillStyle = `rgba(248, 250, 252, ${alpha})`;
    ctx.strokeText(c.name.toUpperCase(), lp.x, lp.y);
    ctx.fillText(c.name.toUpperCase(), lp.x, lp.y);
  }

  // 9. Бейджи гарнизонов провинций (умная плотность по зуму)
  drawBadges(z);

  // 10. Стрелки маршей и морских десантов
  drawMarches(z);

  // 11. Вспышки боёв
  drawBattles(z);

  ctx.restore();
}

// Ширина текста бейджа при базовом шрифте 10.5px (текст часто повторяется, измерять каждый кадр дорого)
const badgeWidthCache = new Map();
function badgeTextWidth(txt) {
  let w = badgeWidthCache.get(txt);
  if (w === undefined) {
    ctx.font = '700 10.5px "Inter", sans-serif';
    w = ctx.measureText(txt).width;
    if (badgeWidthCache.size > 3000) badgeWidthCache.clear();
    badgeWidthCache.set(txt, w);
  }
  return w;
}

function drawBadges(z) {
  const selId = game.selectedProvId;
  const hovId = game.hoveredProvId;
  const adj = (selId && game.provinces[selId]?.ownerId === game.playerId)
    ? new Set([...game.provinces[selId].neighbors, ...game.provinces[selId].seaNeighbors])
    : null;
  const fz = 10.5 / z;
  const bh = 15.5 / z;
  const pad = 70 / z;
  const fontMain = '700 ' + fz + 'px "Inter", sans-serif';
  const fontMark = (12 / z) + 'px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 1.15 / z;

  for (let i = 1; i < game.provinces.length; i++) {
    const p = game.provinces[i];
    if (!pointVisible(p.cx, p.cy, pad)) continue;
    const imp = i === selId || i === hovId || (adj && adj.has(i));
    const isPlayer = p.ownerId === game.playerId;

    const show =
      imp ||
      (z >= 2.0 && p.area >= 160) ||
      (z >= 1.3 && (isPlayer || p.isCapital || p.area >= 1100)) ||
      (z >= 0.8 && p.isCapital && (isPlayer || p.area >= 1800));
    if (!show) continue;

    const txt = (p.isCapital ? '★' : '') + (p.fort > 0 ? '🛡' : '') + (p.tanks > 0 || p.air > 0 ? '⚙' : '') + fmtNum(provPower(p));
    const bw = badgeTextWidth(txt) / z + 10 / z;

    let bg = 'rgba(10, 17, 30, 0.84)', brd = 'rgba(148, 163, 184, 0.38)', tc = '#f1f5f9';
    if (isPlayer) { bg = 'rgba(6, 78, 59, 0.9)'; brd = 'rgba(52, 211, 153, 0.78)'; tc = '#ecfdf5'; }
    else if (game.playerId !== null && isAtWar(game.playerId, p.ownerId)) {
      bg = 'rgba(127, 29, 29, 0.92)'; brd = 'rgba(248, 113, 113, 0.85)'; tc = '#fef2f2';
    } else if (adj && adj.has(i)) { brd = 'rgba(251, 191, 36, 0.85)'; }
    if (i === selId) brd = '#ffffff';

    ctx.fillStyle = bg;
    ctx.strokeStyle = brd;
    drawRoundRect(ctx, p.cx - bw / 2, p.cy - bh / 2, bw, bh, 4 / z);
    ctx.fill();
    ctx.stroke();

    ctx.font = fontMain;
    ctx.fillStyle = tc;
    ctx.fillText(txt, p.cx, p.cy + 0.4 / z);

    if (adj && adj.has(i) && !isPlayer && game.phase === 'playing') {
      ctx.font = fontMark;
      ctx.fillText(isAtWar(game.playerId, p.ownerId) ? '⚔️' : '🎯', p.cx, p.cy - bh / 2 - 7 / z);
    }
  }
}

function drawMarches(z) {
  for (const m of game.marches) {
    const pA = game.provinces[m.fromId], pB = game.provinces[m.toId];
    if (!pA || !pB) continue;

    const cx = pA.cx + (pB.cx - pA.cx) * m.progress;
    const cy = pA.cy + (pB.cy - pA.cy) * m.progress;
    const ang = Math.atan2(pB.cy - pA.cy, pB.cx - pA.cx);
    const col = m.isAttack
      ? (m.ownerId === game.playerId ? '#ef4444' : '#fb7185')
      : (m.ownerId === game.playerId ? '#34d399' : '#38bdf8');

    ctx.save();
    // Лёгкое тактическое свечение стрелки
    ctx.strokeStyle = col;
    ctx.lineWidth = 2.8 / z;
    ctx.setLineDash([7 / z, 4 / z]);
    ctx.lineDashOffset = -game.time * (26 / z);
    ctx.beginPath();
    ctx.moveTo(pA.cx, pA.cy);
    ctx.lineTo(cx, cy);
    ctx.stroke();
    ctx.setLineDash([]);

    const hl = 8.5 / z;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx - hl * Math.cos(ang - 0.5), cy - hl * Math.sin(ang - 0.5));
    ctx.lineTo(cx - hl * Math.cos(ang + 0.5), cy - hl * Math.sin(ang + 0.5));
    ctx.closePath();
    ctx.fill();

    const lbl = `${m.isSea ? '⚓' : ''}${fmtNum(rawPower(m))}`;
    ctx.font = `800 ${9.5 / z}px "Inter", sans-serif`;
    const tw = ctx.measureText(lbl).width + 8 / z;
    const bh = 13.5 / z;
    ctx.fillStyle = 'rgba(9, 15, 26, 0.88)';
    drawRoundRect(ctx, cx - tw / 2, cy - bh - 5 / z, tw, bh, 3.5 / z);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(lbl, cx, cy - bh / 2 - 5 / z);
    ctx.restore();
  }
}

function drawBattles(z) {
  for (const b of game.battles) {
    const alpha = Math.min(1, b.life / 0.5);
    const prog = 1 - b.life / b.maxLife;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = b.captured ? '#fde047' : '#ef4444';
    ctx.lineWidth = 2.2 / z;
    ctx.beginPath();
    ctx.arc(b.x, b.y, (6 + prog * 22) / z, 0, Math.PI * 2);
    ctx.stroke();

    ctx.font = `${15 / z}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(b.captured ? '🚩' : '💥', b.x, b.y);

    ctx.font = `800 ${10 / z}px "Inter", sans-serif`;
    ctx.lineWidth = 2.6 / z;
    ctx.strokeStyle = 'rgba(0,0,0,0.88)';
    const loss = `-${fmtNum(b.atkLoss)} / -${fmtNum(b.defLoss)}`;
    ctx.strokeText(loss, b.x, b.y - (13 + prog * 15) / z);
    ctx.fillStyle = '#fca5a5';
    ctx.fillText(loss, b.x, b.y - (13 + prog * 15) / z);
    ctx.restore();
  }
}
