'use strict';
/* ГЕГЕМОН — Главный цикл, обработчики кнопок, запуск
   Классический <script>: общие переменные и функции живут в глобальной области, порядок подключения см. в index.html. */

// -----------------------------------------------------------------------
// 13. ГЛАВНЫЙ ЦИКЛ (60FPS) И ОБРАБОТЧИКИ СОБЫТИЙ
// -----------------------------------------------------------------------
const panKeys = { w: false, a: false, s: false, d: false };
let lastTs = 0;

function update(dt) {
  game.time += dt;
  const ps = 520 * dt;
  if (panKeys.w) game.cam.y += ps;
  if (panKeys.s) game.cam.y -= ps;
  if (panKeys.a) game.cam.x += ps;
  if (panKeys.d) game.cam.x -= ps;
  if (panKeys.w || panKeys.s || panKeys.a || panKeys.d) clampCamera();

  if (game.phase !== 'playing' || game.speed === 0) return;

  // Время идёт по дням: DAY_SECONDS реальных секунд на день при скорости 1x (battle.js)
  const days = (dt * game.speed) / DAY_SECONDS;
  const prevDay = Math.floor(game.dayFloat);
  game.dayFloat += days;
  if (Math.floor(game.dayFloat) > prevDay) {
    processDay();
    if (game.dayFloat >= 30) { game.dayFloat -= 30; processMonth(); }
  }

  for (let i = game.marches.length - 1; i >= 0; i--) {
    const m = game.marches[i];
    m.progress += days / m.duration;
    if (m.progress >= 1) { game.marches.splice(i, 1); resolveMarch(m); }
  }
  for (let i = game.battles.length - 1; i >= 0; i--) {
    game.battles[i].life -= dt;
    if (game.battles[i].life <= 0) game.battles.splice(i, 1);
  }

}

// Кадр нужен «на полной скорости», только когда на карте что-то движется или пользователь взаимодействует.
// В покое (пауза/ожидание без выделения) карту достаточно перерисовывать ~10 раз в секунду.
let lastRenderTs = 0, lastCamSig = '';
function needsFullRate() {
  if (game.phase === 'loading') return true;
  if (game.marches.length || game.battles.length || game.fights.length) return true;
  if (game.selectedProvId || game.hoveredProvId) return true;
  if (game.phase === 'select' && game.selectedCountryId !== null) return true;
  const c = game.cam;
  const sig = c.x.toFixed(1) + '|' + c.y.toFixed(1) + '|' + c.zoom.toFixed(3);
  if (sig !== lastCamSig) { lastCamSig = sig; return true; }
  return false;
}

function loop(ts) {
  if (!lastTs) lastTs = ts;
  const dt = Math.min((ts - lastTs) / 1000, 0.05);
  lastTs = ts;
  update(dt);
  if (needsFullRate() || ts - lastRenderTs >= 100) {
    lastRenderTs = ts;
    render();
  }
  window.requestAnimationFrame(loop);
}

const SPEED_CYCLE = SPEED_STEPS.concat([0]);
function updateSpeedBtn() {
  const btn = document.getElementById('btn-speed');
  btn.classList.remove('active', 'paused');
  if (game.speed === 0) { btn.textContent = '⏸'; btn.classList.add('paused'); }
  else { btn.textContent = `${game.speed}x`; btn.classList.add('active'); }
}

const MAP_MODES = [
  { id: 'political', label: '🗺️ Полит.' },
  { id: 'diplomatic', label: '🤝 Дипл.' },
  { id: 'blocs', label: '🛡 Блоки', scenarioOnly: true },
  { id: 'opinion', label: '💬 Отнош.', scenarioOnly: true },
  { id: 'military', label: '⚔️ Армии' }
];
function availableMapModes() { return MAP_MODES.filter((m) => !m.scenarioOnly || scenarioActive()); }

function setupInputs() {
  let down = false, dragged = false;
  let dx0 = 0, dy0 = 0, lx = 0, ly = 0;
  let pinchD = 0, pinchMx = 0, pinchMy = 0;

  // Мышь
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 2) { handleTapOrClick(provAtScreen(e.clientX, e.clientY), true); return; }
    if (e.button !== 0) return;
    down = true; dragged = false;
    dx0 = lx = e.clientX; dy0 = ly = e.clientY;
  });

  window.addEventListener('mousemove', (e) => {
    if (down) {
      if (!dragged && Math.hypot(e.clientX - dx0, e.clientY - dy0) > 5) {
        dragged = true; canvas.classList.add('dragging'); tooltipEl.classList.remove('visible');
      }
      if (dragged) { game.cam.x += e.clientX - lx; game.cam.y += e.clientY - ly; clampCamera(); }
      lx = e.clientX; ly = e.clientY;
      return;
    }
    if (e.target === canvas) {
      const pid = provAtScreen(e.clientX, e.clientY);
      game.hoveredProvId = pid || null;
      canvas.classList.toggle('pointer', pid > 0);
      updateTooltip(pid, e.clientX, e.clientY);
    } else {
      game.hoveredProvId = null;
      tooltipEl.classList.remove('visible');
    }
  });

  window.addEventListener('mouseup', (e) => {
    if (!down) return;
    down = false; canvas.classList.remove('dragging');
    if (!dragged && e.target === canvas) handleTapOrClick(provAtScreen(e.clientX, e.clientY), false);
  });

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomAt(Math.exp(-e.deltaY * 0.0014), e.clientX, e.clientY);
  }, { passive: false });

  // Сенсорное управление (1 палец — pan/tap, 2 пальца — pinch-to-zoom вокруг середины)
  canvas.addEventListener('touchstart', (e) => {
    tooltipEl.classList.remove('visible');
    if (e.touches.length === 1) {
      down = true; dragged = false;
      dx0 = lx = e.touches[0].clientX;
      dy0 = ly = e.touches[0].clientY;
    } else if (e.touches.length === 2) {
      down = false; dragged = true;
      const t0 = e.touches[0], t1 = e.touches[1];
      pinchD = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
      pinchMx = (t0.clientX + t1.clientX) * 0.5;
      pinchMy = (t0.clientY + t1.clientY) * 0.5;
    }
  }, { passive: false });

  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (e.touches.length === 1 && down) {
      const t = e.touches[0];
      if (!dragged && Math.hypot(t.clientX - dx0, t.clientY - dy0) > 6) dragged = true;
      if (dragged) {
        game.cam.x += t.clientX - lx;
        game.cam.y += t.clientY - ly;
        clampCamera();
      }
      lx = t.clientX; ly = t.clientY;
    } else if (e.touches.length === 2) {
      const t0 = e.touches[0], t1 = e.touches[1];
      const nd = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
      const mx = (t0.clientX + t1.clientX) * 0.5;
      const my = (t0.clientY + t1.clientY) * 0.5;
      game.cam.x += mx - pinchMx;
      game.cam.y += my - pinchMy;
      if (pinchD > 10) zoomAt(nd / pinchD, mx, my);
      pinchD = nd; pinchMx = mx; pinchMy = my;
    }
  }, { passive: false });

  canvas.addEventListener('touchend', (e) => {
    if (down && !dragged && e.changedTouches.length === 1) {
      const t = e.changedTouches[0];
      handleTapOrClick(provAtScreen(t.clientX, t.clientY), false);
    }
    if (e.touches.length === 0) { down = false; pinchD = 0; }
  });

  // Клавиатура
  window.addEventListener('keydown', (e) => {
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
    if (e.code === 'KeyW' || e.code === 'ArrowUp') panKeys.w = true;
    if (e.code === 'KeyS' || e.code === 'ArrowDown') panKeys.s = true;
    if (e.code === 'KeyA' || e.code === 'ArrowLeft') panKeys.a = true;
    if (e.code === 'KeyD' || e.code === 'ArrowRight') panKeys.d = true;
    if (e.code === 'Space' && game.phase === 'playing') {
      e.preventDefault();
      if (game.speed === 0) game.speed = game.lastSpeed || 1;   // пробел возвращает прежнюю скорость
      else { game.lastSpeed = game.speed; game.speed = 0; }
      sfx.click(); updateSpeedBtn();
    }
    if (e.code === 'Escape') {
      closeModal();
      game.selectedProvId = null;
      if (game.phase === 'playing') drawer.classList.remove('open');
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'KeyW' || e.code === 'ArrowUp') panKeys.w = false;
    if (e.code === 'KeyS' || e.code === 'ArrowDown') panKeys.s = false;
    if (e.code === 'KeyA' || e.code === 'ArrowLeft') panKeys.a = false;
    if (e.code === 'KeyD' || e.code === 'ArrowRight') panKeys.d = false;
  });

  // Кнопки интерфейса
  document.getElementById('btn-toggle-picker').addEventListener('click', () => {
    sfx.click();
    document.getElementById('country-picker').classList.toggle('hidden');
  });
  document.getElementById('country-search').addEventListener('input', (e) => populateCountryList(e.target.value));

  document.getElementById('btn-speed').addEventListener('click', () => {
    const idx = SPEED_CYCLE.indexOf(game.speed);
    game.speed = SPEED_CYCLE[(idx + 1) % SPEED_CYCLE.length];
    sfx.click();
    updateSpeedBtn();
  });

  document.getElementById('btn-mapmode').addEventListener('click', (e) => {
    const modes = availableMapModes();
    const idx = modes.findIndex((m) => m.id === game.mapMode);
    const next = modes[(idx + 1) % modes.length];
    game.mapMode = next.id;
    e.currentTarget.textContent = next.label;
    updateMapLegend();
    sfx.click();
  });

  document.getElementById('btn-sound').addEventListener('click', (e) => {
    sfx.muted = !sfx.muted;
    e.currentTarget.textContent = sfx.muted ? '🔇' : '🔊';
  });
  document.getElementById('btn-help').addEventListener('click', showHelpModal);
  document.getElementById('btn-menu').addEventListener('click', showMenuModal);
  document.getElementById('btn-market').addEventListener('click', () => { if (game.phase === 'playing') showMarketModal(); });
  document.getElementById('btn-state').addEventListener('click', () => showStateModal());
  document.getElementById('btn-world').addEventListener('click', () => showWorldModal());
  document.getElementById('btn-continue').addEventListener('click', showContinueModal);

  document.getElementById('btn-center-cap').addEventListener('click', () => {
    if (game.playerId === null) return;
    const c = game.countries[game.playerId];
    const cap = game.provinces[c.capitalProvId || c.provinces[0]];
    if (cap) { game.selectedProvId = cap.id; focusCamera(cap.cx, cap.cy, 2.4); refreshDrawer(); }
  });

  document.getElementById('btn-zin').addEventListener('click', () => zoomAt(1.34, game.viewW / 2, game.viewH / 2));
  document.getElementById('btn-zout').addEventListener('click', () => zoomAt(0.74, game.viewW / 2, game.viewH / 2));
  document.getElementById('btn-zreset').addEventListener('click', resetCamera);

  document.getElementById('news-toggle').addEventListener('click', () => {
    const box = document.getElementById('news-box');
    box.classList.toggle('collapsed');
    document.getElementById('news-arrow').textContent = box.classList.contains('collapsed') ? '▲' : '▼';
  });

  window.addEventListener('resize', resizeCanvas);
}

window.onload = function () {
  resizeCanvas();
  setupInputs();
  window.requestAnimationFrame(loop);
  buildWorld();
};
