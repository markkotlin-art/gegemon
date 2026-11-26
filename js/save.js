'use strict';
/* ГЕГЕМОН — Сохранение и загрузка (localStorage)
   Классический <script>: общие переменные и функции живут в глобальной области, порядок подключения см. в index.html. */

// -----------------------------------------------------------------------
// 12б. СОХРАНЕНИЕ И ЗАГРУЗКА (localStorage)
// Мир (карта, провинции, границы) строится заново, поэтому в сохранение
// попадает только изменяемое состояние. Новые поля добавляйте в списки ниже
// и при необходимости увеличивайте SAVE_VERSION с миграцией в migrateSave().
// -----------------------------------------------------------------------
const SAVE_KEY = 'gegemon.save';
const PREV_KEY = 'gegemon.save.prev'; // предыдущая партия: не затирается, когда начинаешь новую
const SAVE_VERSION = 8;
const PROV_SAVE_FIELDS = ['ownerId', 'isCapital', 'troops', 'tanks', 'air', 'fort', 'economy', 'draft', 'gdp', 'pop', 'bld', 'bq'];
const COUNTRY_SAVE_FIELDS = ['money', 'diplo', 'alive', 'isAI', 'capitalProvId', 'aiAggression', 'res', 'starving', 'noFuel', 'honor', 'grudge', 'warPlan', 'offerUntil', 'blocs', 'regime', 'stmtCd', 'un', 'nukes', 'mods', 'applyBlock', 'ceasefireUntil', 'interventionUntil'];
const MARCH_SAVE_FIELDS = ['ownerId', 'fromId', 'toId', 'troops', 'tanks', 'air', 'isAttack', 'isSea', 'progress', 'duration'];

function pickFields(obj, fields) {
  const out = {};
  for (const f of fields) out[f] = obj[f];
  return out;
}

function worldSignature() {
  return `${game.countries.length}:${game.provinces.length - 1}`;
}

function buildSaveData() {
  return {
    v: SAVE_VERSION,
    world: worldSignature(),
    savedAt: Date.now(),
    playerId: game.playerId,
    year: game.year,
    month: game.month,
    dayFloat: game.dayFloat,
    totalMonths: game.totalMonths,
    speed: game.speed,
    sendPercent: game.sendPercent,
    mapMode: game.mapMode,
    victoryShown: game.victoryShown,
    scenario: game.scenario || null,
    countries: game.countries.map((c) => pickFields(c, COUNTRY_SAVE_FIELDS)),
    provinces: game.provinces.map((p) => (p ? pickFields(p, PROV_SAVE_FIELDS) : null)),
    // нейтральные пары без истории не пишем: getRelation создаст их заново (сохранение в разы меньше)
    relations: [...game.relations.entries()].filter(([, r]) => !(r.status === 'neutral' && r.lastWar === undefined && !r.allyBlockUntil &&
      !r.pactBlockUntil && !r.warScoreA && !r.warScoreB && !r.aggressor && !r.pactUntil)),
    // Мир 2010: торговые соглашения, след событий в отношениях, эмбарго
    trade: game.trade ? [...game.trade] : null,
    opDelta: game.opDelta ? [...game.opDelta.entries()] : null,
    tradeBlock: game.tradeBlock ? [...game.tradeBlock.entries()] : null,
    // мировая политика: заявки, ООН, кризисы, кредиты
    politics: game.un ? { applications: game.applications, un: game.un, crises: game.crises, crisisLog: game.crisisLog,
      crisisSeeds: game.crisisSeeds, crisisNext: game.crisisNext, loans: game.loans } : null,
    marches: game.marches.map((m) => pickFields(m, MARCH_SAVE_FIELDS)),
    fights: game.fights,
    nextFightId: game.nextFightId,
    totalDays: game.totalDays,
    events: game.events
  };
}

// silent = автосохранение без уведомления
function saveGame(silent) {
  if (game.phase !== 'playing' || game.playerId === null) return false;
  if (silent && game.autosaveOff) return false;   // сохранение удалено вручную: пока игрок сам не сохранит, не воскрешаем его
  game.autosaveOff = false;
  const data = buildSaveData();
  let ok = false;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    ok = true;
  } catch (_) {}
  if (serverOk) { pushRemoteSave(SAVE_KEY, data); ok = true; }
  if (!silent) pushToast(ok ? '💾 Игра сохранена' : 'Не удалось сохранить (браузер запретил хранилище)', ok ? 'good' : 'war');
  return ok;
}

// Сохранения лежат в двух местах: в браузере (localStorage) и, если игра открыта через «Играть.command»,
// ещё и файлами на сервере (saves/). Читаем то, что новее.
const remoteSaves = {};          // ключ слота -> данные с сервера
let serverOk = false;            // отвечает ли сервер сохранений
const SLOT_NAME = { [SAVE_KEY]: 'save', [PREV_KEY]: 'prev' };

function readLocalSave(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? validateSave(JSON.parse(raw)) : null;
  } catch (_) {
    return null;
  }
}

function readSave(key = SAVE_KEY) {
  const local = readLocalSave(key);
  const remote = remoteSaves[key] ? validateSave(remoteSaves[key]) : null;
  if (local && remote) return remote.savedAt > local.savedAt ? remote : local;
  return local || remote;
}

// Загрузка сохранений с сервера при старте (на file:// сервера нет — тихо пропускаем)
async function loadRemoteSaves() {
  if (!/^https?:/.test(location.protocol)) return;
  try {
    for (const key of [SAVE_KEY, PREV_KEY]) {
      const res = await fetch('api/save?slot=' + SLOT_NAME[key], { cache: 'no-store' });
      if (res.status === 200) { remoteSaves[key] = await res.json(); serverOk = true; }
      else if (res.status === 204) serverOk = true;   // слот пуст, но сервер наш (на GitHub Pages придёт 404 — сервера нет)
    }
  } catch (_) {}
}

function pushRemoteSave(key, data) {
  if (!serverOk) return;
  remoteSaves[key] = data;
  try {
    fetch('api/save?slot=' + SLOT_NAME[key], { method: 'POST', body: JSON.stringify(data), keepalive: JSON.stringify(data).length < 60000 }).catch(() => {});
  } catch (_) {}
}

function validateSave(parsed) {
  const data = migrateSave(parsed);
  if (!data || !Array.isArray(data.countries) || !Array.isArray(data.provinces)) return null;
  if (data.world !== worldSignature()) return null;
  return data;
}

// Работает ли вообще хранилище браузера (в Safari при открытии с папки часто нет)
function storageLabel() {
  if (serverOk) return 'файлы в папке игры (saves/) + браузер';
  return /^https?:/.test(location.protocol) ? 'браузер (этот адрес)' : 'браузер (открыто с папки)';
}

function storageWorks() {
  try {
    localStorage.setItem('gegemon.test', '1');
    localStorage.removeItem('gegemon.test');
    return true;
  } catch (_) {
    return false;
  }
}

// Перед началом новой партии прежнее сохранение уходит в запасной слот
function backupSave() {
  const cur = readSave(SAVE_KEY);
  if (!cur) return;
  try { localStorage.setItem(PREV_KEY, JSON.stringify(cur)); } catch (_) {}
  pushRemoteSave(PREV_KEY, cur);
}

function migrateSave(data) {
  if (!data || typeof data.v !== 'number' || data.v > SAVE_VERSION) return null;
  // v1 → v2: появились бронетехника/авиация и ресурсы; недостающие поля берутся из свежесобранного мира
  if (data.v < 2) {
    for (const m of data.marches || []) { m.tanks = 0; m.air = 0; }
    for (const c of data.countries) delete c.res;
    data.v = 2;
  }
  // v2 → v3: репутация, обиды, планы войны ИИ (недостающие поля берутся из свежего мира)
  if (data.v < 3) data.v = 3;
  // v3 → v4: ограничение призыва по провинциям (нет в старых сохранениях → остаётся полный призыв)
  if (data.v < 4) {
    for (const sp of data.provinces || []) if (sp && sp.draft === undefined) sp.draft = 1;
    data.v = 4;
  }
  // v4 → v5: сценарии (режим «Мир 2010»); старые партии — песочница
  if (data.v < 5) {
    data.scenario = null;
    data.v = 5;
  }
  // v5 → v6: стратегическое время — марши в днях (раньше в секундах при 1x: месяц = 5,2 с), затяжные бои
  if (data.v < 6) {
    for (const m of data.marches || []) m.duration = Math.max(2, Math.min(16, (m.duration || 1) * 30 / 5.2));
    data.fights = [];
    data.nextFightId = 1;
    data.totalDays = (data.totalMonths || 0) * 30;
    data.v = 6;
  }
  // v6 → v7: геоэкономика «Мира 2010» (ВВП провинций, постройки, торговля, отношения). Недостающее берётся из сценария.
  if (data.v < 7) data.v = 7;
  // v7 → v8: мировая политика (ООН, кризисы, заявки в организации); в старых партиях берётся стартовая из сценария
  if (data.v < 8) data.v = 8;
  return data;
}

// Удаляет слот (в браузере и файл на сервере). Без аргумента — оба слота.
function deleteSave(key) {
  const keys = key ? [key] : [SAVE_KEY, PREV_KEY];
  for (const k of keys) {
    try { localStorage.removeItem(k); } catch (_) {}
    delete remoteSaves[k];
    if (serverOk) fetch('api/save?slot=' + SLOT_NAME[k], { method: 'POST', body: 'null' }).catch(() => {});
  }
}

function describeSave(data) {
  const c = game.countries[data.playerId];
  const owned = data.provinces.reduce((n, p) => n + (p && p.ownerId === data.playerId ? 1 : 0), 0);
  const pct = (owned / (game.provinces.length - 1)) * 100;
  const mode = data.scenario && SCENARIOS[data.scenario] ? ` • 🏛 ${SCENARIOS[data.scenario].title}` : '';
  return `${c.flag} <strong>${c.name}</strong> • ${MONTHS_RU[data.month]} ${data.year} • ${pct.toFixed(1)}% мира${mode}`;
}

function applySave(data) {
  // Сначала мир приводится к основе партии (песочница или сценарий), потом поверх ложатся сохранённые поля
  if (data.scenario && SCENARIOS[data.scenario]) applyScenario(data.scenario);
  else restoreBaseline();
  for (const c of game.countries) c.provinces = [];
  data.countries.forEach((sc, i) => {
    Object.assign(game.countries[i], sc);
  });
  data.provinces.forEach((sp, i) => {
    if (!sp) return;
    const p = game.provinces[i];
    Object.assign(p, sp);
    game.countries[p.ownerId].provinces.push(i);
  });
  game.relations = new Map(data.relations);
  if (data.scenario) {
    // в старых партиях «Мира 2010» (до v7) остаются стартовые торговые связи и отношения сценария
    if (data.trade) game.trade = new Set(data.trade);
    if (data.opDelta) game.opDelta = new Map(data.opDelta);
    if (data.tradeBlock) game.tradeBlock = new Map(data.tradeBlock);
    if (data.politics) Object.assign(game, data.politics);   // иначе (старые партии) — стартовое состояние из сценария
  }
  rebuildDiploIndex();
  game.marches = data.marches;
  game.fights = data.fights || [];
  game.nextFightId = data.nextFightId || 1;
  game.totalDays = data.totalDays || 0;
  game.events = data.events || [];

  game.playerId = data.playerId;
  game.countries[data.playerId].isAI = false;
  game.year = data.year;
  game.month = data.month;
  game.dayFloat = data.dayFloat;
  game.totalMonths = data.totalMonths;
  game.sendPercent = data.sendPercent;
  game.mapMode = data.mapMode;
  game.victoryShown = data.victoryShown;
  game.battles = [];
  game.selectedCountryId = null;
  game.selectedProvId = null;
  game.phase = 'playing';
  game.speed = 0; // после загрузки ждём команды игрока

  rebuildBorders();
  recomputeAllLabels();
  enterPlayingUI(data.playerId);

  const modeBtn = document.getElementById('btn-mapmode');
  const mode = MAP_MODES.find((m) => m.id === game.mapMode);
  if (mode) modeBtn.textContent = mode.label;

  const c = game.countries[data.playerId];
  const cap = game.provinces[c.capitalProvId || c.provinces[0]];
  if (cap) focusCamera(cap.cx, cap.cy, 2.0);

  addNews(`💾 Партия загружена. Нажмите на скорость, чтобы продолжить.`, 'ally');
  updateSpeedBtn();
  updateHud();
}

// source: ключ слота ('gegemon.save' / 'gegemon.save.prev') или уже прочитанные данные
function loadGame(source = SAVE_KEY) {
  const data = typeof source === 'string' ? readSave(source) : source;
  if (!data) { pushToast('Сохранение не найдено или повреждено', 'war'); return false; }
  try {
    applySave(data);
  } catch (e) {
    console.error(e);
    pushToast('Не удалось загрузить сохранение: ' + e.message, 'war');
    return false;
  }
  pushToast('📂 Партия загружена (на паузе)', 'good');
  return true;
}

// ---------------------------------------------------------------- файл сохранения (запасной путь)
function exportSaveToFile() {
  const data = game.phase === 'playing' ? buildSaveData() : readSave();
  if (!data) { pushToast('Нечего сохранять в файл', 'war'); return; }
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'gegemon-save.json';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

function importSaveFromFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = () => {
    const f = input.files && input.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      let data = null;
      try { data = validateSave(JSON.parse(reader.result)); } catch (_) {}
      if (!data) { pushToast('Файл не подходит: это не сохранение игры или другая версия карты', 'war'); return; }
      closeModal();
      if (loadGame(data)) saveGame(true);
    };
    reader.readAsText(f);
  };
  input.click();
}

function saveSlotRow(label, key) {
  const data = readSave(key);
  if (!data) return '';
  return `
    <div class="mk-row">
      <div class="mk-name">${label}<small>${describeSave(data)}<br>${new Date(data.savedAt).toLocaleString('ru-RU')}</small></div>
      <div class="mk-btns">
        <button class="btn btn-sm btn-emerald" data-slot="${key}">▶ Продолжить</button>
        <button class="btn btn-sm btn-red" data-del="${key}" title="Удалить это сохранение">🗑</button>
      </div>
    </div>`;
}

function showContinueModal() {
  const rows = saveSlotRow('Последняя партия', SAVE_KEY) + saveSlotRow('Предыдущая партия', PREV_KEY);
  const noStorage = !storageWorks() && !serverOk;
  modalBox.innerHTML = `
    <div class="modal-title">💾 ${rows ? 'Найдено сохранение' : 'Сохранений нет'}</div>
    <div class="modal-body">
      ${rows || `<div style="color:#94a3b8;">В этом браузере нет сохранённой партии.${noStorage
        ? ' <b style="color:#f87171;">Браузер не разрешает сохранять при открытии с папки</b> (обычно Safari). Откройте игру в Chrome или сохраняйте партию в файл через меню ☰ и загружайте его здесь.'
        : ` Партии сохраняются автоматически раз в месяц игры. Сейчас хранилище: <b>${storageLabel()}</b>. Если вы играли раньше в другом браузере или открывали игру иначе, там партия и осталась: для общих сохранений запускайте игру через «Играть.command».`}</div>`}
      <div style="margin-top:8px;"><button class="btn btn-sm" id="m-import">📂 Загрузить из файла…</button></div>
    </div>
    <div class="modal-actions">
      <button class="btn" id="m-new">${rows ? 'Новая игра' : 'Закрыть'}</button>
    </div>
  `;
  modalBackdrop.classList.add('visible');
  document.getElementById('m-new').onclick = closeModal;
  document.getElementById('m-import').onclick = importSaveFromFile;
  modalBox.querySelectorAll('[data-slot]').forEach((b) => {
    b.onclick = () => { closeModal(); loadGame(b.dataset.slot); };
  });
  modalBox.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = () => showModal(
      'Удалить сохранение?',
      'Сохранение будет удалено из браузера и из папки игры (saves/). Вернуть его нельзя.',
      '🗑 Удалить', 'btn-crimson',
      () => { deleteSave(b.dataset.del); pushToast('Сохранение удалено'); showContinueModal(); }
    );
  });
}

function showMenuModal() {
  modalBox.innerHTML = `
    <div class="modal-title">☰ Меню</div>
    <div class="modal-body" style="display:flex;flex-direction:column;gap:8px;">
      <div style="color:#94a3b8;font-size:11px;">💾 Хранилище: ${storageLabel()}</div>
      <div style="color:#94a3b8;">🏅 Репутация: <b style="color:#f8fafc;">${Math.round(game.countries[game.playerId].honor)}</b> • союзников: ${alliesOf(game.playerId).length}</div>
      <div class="ap-box">
        <div style="color:#94a3b8;font-size:11px;margin-bottom:4px;">⏸ Автопауза, когда:</div>
        <label><input type="checkbox" data-ap="war" ${autoPause.war ? 'checked' : ''}> вам объявили войну</label>
        <label><input type="checkbox" data-ap="attacked" ${autoPause.attacked ? 'checked' : ''}> враг атакует вашу провинцию</label>
        <label><input type="checkbox" data-ap="fightEnd" ${autoPause.fightEnd ? 'checked' : ''}> ваш бой закончился</label>
        <div style="color:#94a3b8;font-size:11px;margin-top:4px;">Предложения мира и союза всегда ставят игру на паузу. Пробел — пауза/продолжить.</div>
      </div>
      <button class="btn btn-sky" id="mn-save">💾 Сохранить игру</button>
      <button class="btn" id="mn-export">⬇ Сохранить в файл</button>
      <button class="btn" id="mn-import">📂 Загрузить из файла</button>
      <button class="btn" id="mn-new">🌍 Выйти и начать новую (сохранение останется)</button>
      <button class="btn btn-red" id="mn-del">🗑 Удалить сохранения</button>
    </div>
    <div class="modal-actions"><button class="btn" id="m-ok">Закрыть</button></div>
  `;
  modalBackdrop.classList.add('visible');
  document.getElementById('m-ok').onclick = closeModal;
  modalBox.querySelectorAll('[data-ap]').forEach((cb) => { cb.onchange = () => { autoPause[cb.dataset.ap] = cb.checked; saveAutoPause(); }; });
  document.getElementById('mn-save').onclick = () => { closeModal(); saveGame(false); };
  document.getElementById('mn-export').onclick = () => { closeModal(); exportSaveToFile(); };
  document.getElementById('mn-import').onclick = importSaveFromFile;
  document.getElementById('mn-new').onclick = () => { saveGame(true); window.location.reload(); };
  document.getElementById('mn-del').onclick = () => showModal(
    'Удалить сохранения?',
    'Обе сохранённые партии будут удалены из браузера и из папки игры (saves/). Текущая игра продолжится, но не будет сохраняться, пока вы сами не нажмёте «Сохранить игру».',
    '🗑 Удалить', 'btn-crimson',
    () => { deleteSave(); game.autosaveOff = true; pushToast('Сохранения удалены'); }
  );
}

// Сохраняем при сворачивании/закрытии вкладки
document.addEventListener('visibilitychange', () => { if (document.hidden) saveGame(true); });
window.addEventListener('pagehide', () => saveGame(true));
