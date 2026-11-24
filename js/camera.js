'use strict';
/* ГЕГЕМОН — Камера, жесты, мышь и клавиатура, тултип
   Классический <script>: общие переменные и функции живут в глобальной области, порядок подключения см. в index.html. */

// -----------------------------------------------------------------------
// 12. КАМЕРА, ЖЕСТЫ (IPHONE PINCH-TO-ZOOM + PAN), МЫШЬ И КЛАВИАТУРА
// -----------------------------------------------------------------------
function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  game.viewW = window.innerWidth;
  game.viewH = window.innerHeight;
  canvas.width = Math.floor(game.viewW * dpr);
  canvas.height = Math.floor(game.viewH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  game.cam.minZoom = Math.max(0.24, Math.min(game.viewW / WORLD_W, game.viewH / WORLD_H) * 0.92);
  if (game.cam.zoom < game.cam.minZoom) game.cam.zoom = game.cam.minZoom;
  clampCamera();
}

function clampCamera() {
  const z = game.cam.zoom;
  const mw = WORLD_W * z, mh = WORLD_H * z;
  if (mw <= game.viewW) game.cam.x = (game.viewW - mw) / 2;
  else game.cam.x = Math.min(90, Math.max(game.viewW - mw - 90, game.cam.x));
  if (mh <= game.viewH) game.cam.y = (game.viewH - mh) / 2;
  else game.cam.y = Math.min(90, Math.max(game.viewH - mh - 90, game.cam.y));
}

function resetCamera() {
  // На вертикальном экране iPhone начинаем с комфортного вида Европы/Евразии, чтобы карта была крупной и чёткой
  const isPortrait = game.viewH > game.viewW * 1.1;
  if (isPortrait) {
    focusCamera(1120, 440, Math.max(game.cam.minZoom * 2.1, game.viewW / 900));
  } else {
    game.cam.zoom = Math.max(game.cam.minZoom, Math.min(game.viewW / WORLD_W, game.viewH / WORLD_H) * 1.04);
    game.cam.x = (game.viewW - WORLD_W * game.cam.zoom) / 2;
    game.cam.y = (game.viewH - WORLD_H * game.cam.zoom) / 2;
    clampCamera();
  }
}

function focusCamera(wx, wy, targetZ = 2.2) {
  game.cam.zoom = Math.max(game.cam.minZoom, Math.min(game.cam.maxZoom, targetZ));
  game.cam.x = game.viewW / 2 - wx * game.cam.zoom;
  game.cam.y = game.viewH * (window.innerWidth < 820 ? 0.38 : 0.5) - wy * game.cam.zoom;
  clampCamera();
}

function zoomAt(factor, sx, sy) {
  const oldZ = game.cam.zoom;
  const newZ = Math.max(game.cam.minZoom, Math.min(game.cam.maxZoom, oldZ * factor));
  const wx = (sx - game.cam.x) / oldZ;
  const wy = (sy - game.cam.y) / oldZ;
  game.cam.zoom = newZ;
  game.cam.x = sx - wx * newZ;
  game.cam.y = sy - wy * newZ;
  clampCamera();
}

function provAtScreen(sx, sy) {
  const wx = (sx - game.cam.x) / game.cam.zoom;
  const wy = (sy - game.cam.y) / game.cam.zoom;
  return findProvinceAtWorld(wx, wy);
}

function handleTapOrClick(pid, isRightClick = false) {
  if (game.phase === 'select') {
    if (pid > 0) { sfx.click(); inspectCountryPreGame(game.provinces[pid].ownerId); }
    return;
  }
  if (game.phase !== 'playing') return;

  if (pid === 0) {
    if (!isRightClick) { game.selectedProvId = null; drawer.classList.remove('open'); }
    return;
  }

  const clicked = game.provinces[pid];
  const sel = game.selectedProvId ? game.provinces[game.selectedProvId] : null;

  // Если выбрана СВОЯ провинция и нажали на достижимого соседа -> переброска или атака!
  if (sel && sel.ownerId === game.playerId && sel.id !== clicked.id && canReach(sel.id, clicked.id)) {
    if (clicked.ownerId === game.playerId) {
      if (sendTroops(sel.id, clicked.id, game.sendPercent / 100)) { refreshDrawer(); return; }
    } else if (isAtWar(game.playerId, clicked.ownerId)) {
      if (sendTroops(sel.id, clicked.id, game.sendPercent / 100)) { refreshDrawer(); return; }
    } else {
      if (isAllied(game.playerId, clicked.ownerId)) {
        pushToast('Нельзя атаковать союзника! Сначала разорвите союз.');
        return;
      }
      if (hasPact(game.playerId, clicked.ownerId)) {
        pushToast('Действует пакт о ненападении!');
        return;
      }
      const tc = game.countries[clicked.ownerId];
      showModal(
        `Объявить войну ${tc.flag} ${tc.name}?`,
        `Отправить <strong>${game.sendPercent}%</strong> войск из <strong>${sel.name}</strong> на захват <strong>${clicked.name}</strong>?`,
        '⚔️ В атаку!', 'btn-crimson',
        () => {
          declareWar(game.playerId, clicked.ownerId);
          sendTroops(sel.id, clicked.id, game.sendPercent / 100);
          refreshDrawer();
        }
      );
      return;
    }
  }

  if (!isRightClick) {
    sfx.click();
    game.selectedProvId = pid;
    refreshDrawer();
  }
}

// Обновление тултипа (только для мыши)
const tooltipEl = document.getElementById('tooltip');
function updateTooltip(pid, cx, cy) {
  if (!pid || game.phase === 'loading') { tooltipEl.classList.remove('visible'); return; }
  const p = game.provinces[pid], c = game.countries[p.ownerId];
  tooltipEl.innerHTML = `
    <div class="tt-c"><span>${c.flag}</span><span>${c.name}</span></div>
    <div class="tt-p">${p.isCapital ? '★ ' : ''}${p.name}</div>
    <div class="tt-s"><span>⚔️ ${fmtNum(provPower(p))}${p.tanks > 0 || p.air > 0 ? ` (${armyBreakdownText(p)})` : ''}</span><span>🛡 +${p.fort * 45 + (p.isCapital ? 20 : 0)}%</span><span>💰 +${p.economy * 13}</span></div>
  `;
  tooltipEl.classList.add('visible');
  const tw = tooltipEl.offsetWidth || 180, th = tooltipEl.offsetHeight || 68;
  tooltipEl.style.left = (cx + 14 + tw > window.innerWidth ? cx - tw - 12 : cx + 14) + 'px';
  tooltipEl.style.top = (cy + 14 + th > window.innerHeight ? cy - th - 12 : cy + 14) + 'px';
}
