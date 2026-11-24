'use strict';
/* ГЕГЕМОН — Интерфейс: список стран, панель провинции, HUD, модальные окна
   Классический <script>: общие переменные и функции живут в глобальной области, порядок подключения см. в index.html. */

// -----------------------------------------------------------------------
// 10. UI: ВЫБОР СТРАНЫ, ВЫДВИЖНАЯ ПАНЕЛЬ (BOTTOM DRAWER / SIDE PANEL), HUD
// -----------------------------------------------------------------------
const drawer = document.getElementById('command-drawer');

function populateCountryList(query = '') {
  const listEl = document.getElementById('country-list');
  const lblEl = document.getElementById('picker-label');
  listEl.innerHTML = '';
  const q = query.trim().toLowerCase();
  let items;
  if (q) {
    lblEl.textContent = 'Найдено';
    items = game.countries.filter((c) => c.alive && c.name.toLowerCase().includes(q))
      .sort((a, b) => b.provinces.length - a.provinces.length);
  } else {
    lblEl.textContent = 'Ключевые державы';
    items = POPULAR_ISO.map((iso) => game.countryByIso.get(iso)).filter((c) => c && c.alive);
    if (items.length < 6) items = game.countries.filter((c) => c.alive).slice(0, 20);
  }
  if (!items.length) {
    listEl.innerHTML = '<div style="color:var(--muted);font-size:11px;padding:6px;">Ничего не найдено</div>';
    return;
  }
  for (const c of items) {
    const row = document.createElement('div');
    row.className = 'country-row' + (game.selectedCountryId === c.id ? ' active' : '');
    row.innerHTML = `
      <div class="country-row-left">
        <span>${c.flag}</span>
        <span class="country-row-name">${c.name}</span>
      </div>
      <span class="country-row-meta">${c.provinces.length} пров.</span>
    `;
    row.addEventListener('click', () => {
      sfx.click();
      inspectCountryPreGame(c.id);
      const cap = game.provinces[c.capitalProvId || c.provinces[0]];
      if (cap) focusCamera(cap.cx, cap.cy, Math.max(game.cam.zoom, 1.8));
      if (window.innerWidth < 820) document.getElementById('country-picker').classList.add('hidden');
    });
    listEl.appendChild(row);
  }
}

function inspectCountryPreGame(cid) {
  game.selectedCountryId = cid;
  const c = game.countries[cid];
  if (!c || !c.alive) return;
  const st = getCountryStats(cid);

  drawer.innerHTML = `
    <div class="drawer-handle"></div>
    <div class="panel-head">
      <div class="panel-title-wrap">
        <span class="panel-flag">${c.flag}</span>
        <div>
          <div class="panel-title">${c.name}</div>
          <div class="panel-sub">Столица: ★ ${c.capitalName} • ${st.provCount} пров.</div>
        </div>
      </div>
      <button class="close-btn" id="btn-close-drawer">✕</button>
    </div>
    <div class="stat-grid">
      <div class="stat-cell">
        <span class="stat-lbl">Стартовая армия</span>
        <span class="stat-val" style="color:#7dd3fc;">⚔️ ${fmtNum(st.army)}</span>
      </div>
      <div class="stat-cell">
        <span class="stat-lbl">Доход / Казна</span>
        <span class="stat-val" style="color:#34d399;">+${fmtNum(st.income)} / ${fmtNum(c.money)}💰</span>
      </div>
    </div>
    <button class="btn btn-emerald btn-center" id="btn-start-campaign" style="padding:12px;font-size:14px;">
      🚀 Начать кампанию
    </button>
  `;
  drawer.classList.add('open');

  document.getElementById('btn-close-drawer').onclick = () => {
    game.selectedCountryId = null;
    drawer.classList.remove('open');
  };
  document.getElementById('btn-start-campaign').onclick = () => startCampaign(cid);
  populateCountryList(document.getElementById('country-search').value);
}

function startCampaign(cid) {
  sfx.capture();
  game.playerId = cid;
  game.countries[cid].isAI = false;
  game.selectedCountryId = null;
  game.selectedProvId = null;
  game.phase = 'playing';
  game.speed = 1;

  enterPlayingUI(cid);

  const c = game.countries[cid];
  const cap = game.provinces[c.capitalProvId || c.provinces[0]];
  if (cap) focusCamera(cap.cx, cap.cy, Math.max(1.7, Math.min(3.2, 220 / Math.sqrt(cap.area + 240))));

  addNews(`🏛️ Вы возглавили ${c.flag} ${c.name}. Захватите 60% мира!`, 'ally', cap?.cx ?? null, cap?.cy ?? null);
  pushToast(`Кампания за ${c.flag} ${c.name} началась! Нажмите на свою провинцию.`, 'good');
  updateSpeedBtn();
  updateHud();
  game.autosaveOff = false;
  backupSave();
  saveGame(true);
}

// Переключение интерфейса из экрана выбора страны в игровой (общее для новой игры и загрузки)
function enterPlayingUI(cid) {
  document.getElementById('select-top').classList.add('hidden');
  document.getElementById('country-picker').classList.add('hidden');
  document.getElementById('top-bar').classList.add('visible');
  document.getElementById('news-box').classList.add('visible');
  drawer.classList.remove('open');

  const c = game.countries[cid];
  document.getElementById('hud-flag').textContent = c.flag;
  document.getElementById('hud-country').textContent = c.name;
}

function updateHud() {
  if (game.phase !== 'playing' || game.playerId === null) return;
  const c = game.countries[game.playerId];
  const st = getCountryStats(game.playerId);
  const pct = getWorldPct(game.playerId);

  document.getElementById('hud-provs').textContent = `${st.provCount} пров.`;
  document.getElementById('hud-pct').textContent = pct.toFixed(1) + '%';
  document.getElementById('hud-money').textContent = fmtNum(c.money);
  document.getElementById('hud-inc').textContent = `+${fmtNum(st.income)}`;
  document.getElementById('hud-army').textContent = fmtNum(st.army);
  document.getElementById('hud-mp').textContent = `+${fmtNum(st.manpower)}`;
  document.getElementById('hud-diplo').textContent = Math.floor(c.diplo);
  const flow = countryResFlow(game.playerId);
  for (const k of RES_KEYS) {
    document.getElementById('hud-' + k).textContent = fmtNum(Math.floor(c.res[k]));
    const d = document.getElementById('hud-' + k + '-d');
    const net = Math.round(flow.net[k]);
    d.textContent = (net >= 0 ? '+' : '') + fmtNum(net);
    d.classList.toggle('neg', net < 0);
    document.getElementById('pill-' + k).classList.toggle('alert', (k === 'food' && c.starving) || (k === 'fuel' && c.noFuel));
  }
  document.getElementById('hud-date').textContent = `${MONTHS_RU[game.month]} ${game.year}`;
  document.getElementById('hud-world-bar').style.width = Math.min(100, (pct / 60) * 100) + '%';
}

function refreshDrawer() {
  if (game.phase !== 'playing') return;
  if (!game.selectedProvId) {
    drawer.classList.remove('open');
    return;
  }
  const p = game.provinces[game.selectedProvId];
  if (!p) { drawer.classList.remove('open'); return; }
  if (p.ownerId === game.playerId) renderOwnProvDrawer(p);
  else renderForeignDrawer(p.ownerId, p);
}

function renderOwnProvDrawer(p) {
  const player = game.countries[game.playerId];
  const fortCost = 280 + p.fort * 240;
  const fortSteel = 30 + p.fort * 30;
  const yieldNow = provinceYield(p);
  const ecoCost = 180 + p.economy * 65;
  const defBonus = p.fort * 45 + (p.isCapital ? 20 : 0);
  const maxBuy = Math.floor(player.money / 120) * 100;
  const canFort = player.money >= fortCost && player.res.steel >= fortSteel && p.fort < 2;
  const unitBtn = (type, amt, id) => `<button class="btn btn-sm btn-sky" id="${id}" ${canAffordUnits(game.playerId, type, amt) ? '' : 'disabled'}>+${amt}<small>${unitCostText(type, amt)}</small></button>`;

  drawer.innerHTML = `
    <div class="drawer-handle"></div>
    <div class="panel-head">
      <div class="panel-title-wrap">
        <span class="panel-flag">${player.flag}</span>
        <div>
          <div class="panel-title">${p.isCapital ? '★ ' : ''}${p.name}</div>
          <div class="panel-sub">Ваша провинция • Защита +${defBonus}%</div>
        </div>
      </div>
      <button class="close-btn" id="btn-close-drawer">✕</button>
    </div>

    <div class="stat-grid">
      <div class="stat-cell">
        <span class="stat-lbl">Гарнизон (сила ${fmtNum(provPower(p))})</span>
        <span class="stat-val" style="color:#7dd3fc;">${armyBreakdownText(p)}</span>
      </div>
      <div class="stat-cell">
        <span class="stat-lbl">Экономика / Форт</span>
        <span class="stat-val" style="color:#fde047;">Ур.${p.economy} • 🛡${p.fort}/2</span>
      </div>
    </div>

    <div>
      <div class="sec-title">Доля войск для атаки / переброски</div>
      <div class="btn-row-4">
        ${[25, 50, 75, 100].map((v) => `<button class="btn btn-sm pct-btn ${game.sendPercent === v ? 'active' : ''}" data-pct="${v}">${v}%</button>`).join('')}
      </div>
    </div>

    <div>
      <div class="sec-title">📜 Призыв в провинции: +${fmtNum(provDraftGrowth(p))} пехоты/мес</div>
      <div class="btn-row-4">
        ${DRAFT_LEVELS.map((v) => `<button class="btn btn-sm draft-btn ${(p.draft === undefined ? 1 : p.draft) === v ? 'active' : ''}" data-draft="${v}" title="${v === 0 ? 'Призыв выключен: пехота не растёт и не ест зерно' : 'Прирост пехоты ' + Math.round(v * 100) + '% от обычного'}">${v === 0 ? 'Выкл' : Math.round(v * 100) + '%'}</button>`).join('')}
      </div>
      <div style="margin-top:6px;"><button class="btn btn-sm" id="btn-draft-all">Применить ко всем моим провинциям</button></div>
    </div>

    <div class="yield-line">Даёт в месяц: ${RES_KEYS.map((k) => `${RES_DEFS[k].icon} ${yieldNow[k].toFixed(1)}`).join(' &nbsp; ')}</div>

    <div>
      <div class="sec-title">🪖 Пехота (120💰 за 100)</div>
      <div class="btn-row-3">
        <button class="btn btn-sm btn-sky" id="btn-r100" ${player.money < 120 ? 'disabled' : ''}>+100</button>
        <button class="btn btn-sm btn-sky" id="btn-r500" ${player.money < 600 ? 'disabled' : ''}>+500</button>
        <button class="btn btn-sm btn-emerald" id="btn-rmax" ${maxBuy < 100 ? 'disabled' : ''}>Макс (${fmtNum(maxBuy)})</button>
      </div>
    </div>

    <div>
      <div class="sec-title">🚜 Бронетехника (сила ×${TANK_POWER}, ест топливо) • ✈️ Авиация (сила ×${AIR_POWER}, обходит форты)</div>
      <div class="btn-row-4">
        ${unitBtn('tank', 10, 'btn-t10')}
        ${unitBtn('tank', 50, 'btn-t50')}
        ${unitBtn('air', 5, 'btn-a5')}
        ${unitBtn('air', 20, 'btn-a20')}
      </div>
    </div>

    <div style="display:flex;flex-direction:column;gap:6px;">
      <button class="btn" id="btn-fort" ${canFort ? '' : 'disabled'}>
        <span>🛡 ${p.fort >= 2 ? 'Форт макс. уровня' : 'Построить форт (+45% защ.)'}</span>
        ${p.fort < 2 ? `<span class="cost-tag">${fortCost}💰 ${fortSteel}🔩</span>` : ''}
      </button>
      <button class="btn" id="btn-eco" ${player.money < ecoCost || p.economy >= 12 ? 'disabled' : ''}>
        <span>🏭 Развить экономику (+13💰/мес)</span>
        <span class="cost-tag">${ecoCost}💰</span>
      </button>
    </div>

    <div class="order-hint">
      Нажмите на подсвеченного соседа (<span style="color:#6ee7b7;">зелёный</span> — переброска, <span style="color:#fca5a5;">красный</span> — атака / морской десант).
    </div>
  `;
  drawer.classList.add('open');

  document.getElementById('btn-close-drawer').onclick = () => { game.selectedProvId = null; drawer.classList.remove('open'); };
  drawer.querySelectorAll('.draft-btn').forEach((b) => {
    b.onclick = () => { p.draft = Number(b.dataset.draft); updateHud(); refreshDrawer(); };
  });
  document.getElementById('btn-draft-all').onclick = () => {
    const v = p.draft === undefined ? 1 : p.draft;
    for (const pid of player.provinces) game.provinces[pid].draft = v;
    pushToast(v === 0 ? '📜 Призыв выключен во всех провинциях' : `📜 Призыв ${Math.round(v * 100)}% во всех провинциях`, 'good');
    updateHud(); refreshDrawer();
  };
  document.getElementById('btn-r100').onclick = () => recruit(p, 100);
  document.getElementById('btn-r500').onclick = () => recruit(p, 500);
  const buy = (type, amt) => { if (buyUnits(game.playerId, p.id, type, amt)) { sfx.recruit(); updateHud(); refreshDrawer(); } };
  document.getElementById('btn-t10').onclick = () => buy('tank', 10);
  document.getElementById('btn-t50').onclick = () => buy('tank', 50);
  document.getElementById('btn-a5').onclick = () => buy('air', 5);
  document.getElementById('btn-a20').onclick = () => buy('air', 20);
  document.getElementById('btn-rmax').onclick = () => recruit(p, maxBuy);
  document.getElementById('btn-fort').onclick = () => {
    if (!canFort) return;
    player.money -= fortCost; player.res.steel -= fortSteel; p.fort++; sfx.build(); updateHud(); refreshDrawer();
  };
  document.getElementById('btn-eco').onclick = () => {
    if (player.money < ecoCost || p.economy >= 12) return;
    player.money -= ecoCost; p.economy++; sfx.build(); updateHud(); refreshDrawer();
  };
  drawer.querySelectorAll('.pct-btn').forEach((b) => {
    b.addEventListener('click', () => { game.sendPercent = Number(b.dataset.pct); sfx.click(); refreshDrawer(); });
  });
}

function recruit(p, amt) {
  const player = game.countries[game.playerId];
  const cost = (amt / 100) * 120;
  if (amt < 100 || player.money < cost) return;
  player.money -= cost;
  p.troops += amt;
  sfx.recruit();
  updateHud();
  refreshDrawer();
}

function renderForeignDrawer(tid, prov) {
  const c = game.countries[tid];
  const player = game.countries[game.playerId];
  const st = getCountryStats(tid);
  const mySt = getCountryStats(game.playerId);
  const rel = getRelation(game.playerId, tid);
  const borders = countriesShareBorder(game.playerId, tid);
  const ratio = mySt.army / Math.max(1, st.army);

  let badge = '<span class="status-pill st-neu">⚪ Нейтралитет</span>';
  if (rel.status === 'war') badge = '<span class="status-pill st-war">⚔️ Война</span>';
  else if (rel.status === 'ally') badge = '<span class="status-pill st-ally">🤝 Союзник</span>';
  else if (hasPact(game.playerId, tid)) badge = `<span class="status-pill st-pact">🕊️ Пакт (${rel.pactUntil - game.totalMonths} мес.)</span>`;

  const myWS = game.playerId < tid ? rel.warScoreA : rel.warScoreB;
  const thWS = game.playerId < tid ? rel.warScoreB : rel.warScoreA;
  const rep = myWS > thWS ? Math.min(Math.floor(c.money * 0.65), 220 + myWS * 140) : 0;

  // Что думает ИИ о наших предложениях
  const pid = game.playerId;
  const peaceInfo = rel.status === 'war' ? peaceScore(tid, pid) : null;
  const allyInfo = rel.status === 'war' || rel.status === 'ally' ? null : allianceScore(tid, pid);
  const peaceAtt = peaceInfo ? attitudeLabel(peaceInfo.score, PEACE_THRESHOLD) : null;
  const allyAtt = allyInfo ? attitudeLabel(allyInfo.score, ALLY_THRESHOLD) : null;
  const allyBlock = Math.max(0, (rel.allyBlockUntil || 0) - game.totalMonths);
  const pactBlock = Math.max(0, (rel.pactBlockUntil || 0) - game.totalMonths);
  const dipBox = peaceInfo
    ? `<div class="dip-box"><span class="att ${peaceAtt.cls}">Мир: ${peaceAtt.text}</span><small>${reasonsText(peaceInfo.reasons, 3)}</small></div>`
    : allyInfo
      ? `<div class="dip-box"><span class="att ${allyAtt.cls}">Союз: ${allyAtt.text}</span><small>${reasonsText(allyInfo.reasons, 3)}</small></div>`
      : '';

  drawer.innerHTML = `
    <div class="drawer-handle"></div>
    <div class="panel-head">
      <div class="panel-title-wrap">
        <span class="panel-flag">${c.flag}</span>
        <div>
          <div class="panel-title">${c.name}</div>
          <div class="panel-sub">${prov ? (prov.isCapital ? '★ ' : '') + prov.name : c.capitalName} • ${st.provCount} пров. • репутация ${Math.round(c.honor)}</div>
        </div>
      </div>
      <button class="close-btn" id="btn-close-drawer">✕</button>
    </div>

    <div style="display:flex;align-items:center;justify-content:space-between;">
      ${badge}
      <span style="font-size:11px;color:var(--muted);">Перевес сил: <strong style="color:#fff;">x${ratio.toFixed(1)}</strong></span>
    </div>

    ${dipBox}

    <div class="stat-grid">
      <div class="stat-cell">
        <span class="stat-lbl">Армия страны</span>
        <span class="stat-val" style="color:#fca5a5;">⚔️ ${fmtNum(st.army)}</span>
      </div>
      <div class="stat-cell">
        <span class="stat-lbl">Гарнизон региона</span>
        <span class="stat-val">⚔️ ${prov ? fmtNum(provPower(prov)) : '—'}${prov && (prov.tanks > 0 || prov.air > 0) ? ' ⚙' : ''} (🛡+${prov ? prov.fort * 45 + (prov.isCapital ? 20 : 0) : 0}%)</span>
      </div>
    </div>

    <div style="display:flex;flex-direction:column;gap:6px;">
      ${rel.status === 'war' ? `
        <button class="btn btn-emerald" id="btn-peace">
          <span>🕊️ Предложить мир</span>
          ${rep > 0 ? `<span class="cost-tag">+${rep}💰</span>` : ''}
        </button>
        <div class="order-hint">
          Мир закрепит захваченные провинции за теми, кто ими владеет. Если ${c.name} сильнее и побеждает, мира можно добиться только выплатой.
        </div>
      ` : rel.status === 'ally' ? `
        <button class="btn btn-crimson" id="btn-break-ally"><span>💔 Разорвать союз</span></button>
      ` : `
        <button class="btn btn-crimson" id="btn-war" ${hasPact(game.playerId, tid) ? 'disabled' : ''}>
          <span>⚔️ Объявить войну</span>
          ${hasPact(game.playerId, tid) ? '<span class="cost-tag">Пакт</span>' : ''}
        </button>
        <button class="btn btn-sky" id="btn-ally" ${player.diplo < 25 || allyBlock ? 'disabled' : ''}>
          <span>🤝 Предложить союз</span>
          <span class="cost-tag">${allyBlock ? `отказ, ещё ${allyBlock} мес.` : '25 🏛️'}</span>
        </button>
        <button class="btn" id="btn-pact" ${player.diplo < 12 || hasPact(game.playerId, tid) || pactBlock ? 'disabled' : ''}>
          <span>🕊️ Пакт о ненападении (24 мес.)</span>
          <span class="cost-tag">${pactBlock ? `отказ, ещё ${pactBlock} мес.` : '12 🏛️'}</span>
        </button>
        <button class="btn btn-gold" id="btn-ult" ${!borders || player.diplo < 30 || ratio < 2.5 ? 'disabled' : ''}>
          <span>⚡ Ультиматум (аннексия / регион)</span>
          <span class="cost-tag">30 🏛️</span>
        </button>
        <div style="font-size:10px;color:var(--muted);">Ультиматум требует границу и армию ≥ x2.5.</div>
      `}
    </div>
  `;
  drawer.classList.add('open');

  document.getElementById('btn-close-drawer').onclick = () => { game.selectedProvId = null; drawer.classList.remove('open'); };

  const bWar = document.getElementById('btn-war');
  if (bWar) bWar.onclick = () => declareWar(game.playerId, tid);

  const bPeace = document.getElementById('btn-peace');
  if (bPeace) bPeace.onclick = () => {
    const res = peaceScore(tid, game.playerId);
    if (res.score >= PEACE_THRESHOLD) signPeace(game.playerId, tid, rep);
    else showPeaceRefusal(tid, res);
  };

  const bAlly = document.getElementById('btn-ally');
  if (bAlly) bAlly.onclick = () => {
    if (player.diplo < 25) return;
    const res = allianceScore(tid, game.playerId);
    if (res.score >= ALLY_THRESHOLD) {
      player.diplo -= 25; formAlliance(game.playerId, tid); sfx.peace();
      pushToast(`🤝 ${c.flag} ${c.name} теперь ваш союзник!`, 'good');
      showInfoModal('🤝 Союз заключён', `${c.flag} <strong>${c.name}</strong> согласна:<br><small>${reasonsText(res.reasons.filter((r) => r.v > 0), 3)}</small>`);
    } else {
      rel.allyBlockUntil = game.totalMonths + 6;
      showInfoModal('Предложение союза отклонено', `${c.flag} <strong>${c.name}</strong> отказывается:<br><small>${reasonsText(res.reasons.filter((r) => r.v < 0), 3)}</small><br><small style="color:#94a3b8;">Повторить можно через 6 месяцев.</small>`);
    }
    updateHud(); refreshDrawer();
  };

  const bBreak = document.getElementById('btn-break-ally');
  if (bBreak) bBreak.onclick = () => showModal(
    'Разорвать союз?',
    `Разрыв союза с ${c.flag} <strong>${c.name}</strong> ударит по вашей репутации (−15). Другие страны будут меньше доверять вам.`,
    '💔 Разорвать', 'btn-crimson',
    () => { breakAlliance(game.playerId, tid, game.playerId); sfx.click(); pushToast(`Союз с ${c.name} разорван.`); refreshDrawer(); }
  );

  const bPact = document.getElementById('btn-pact');
  if (bPact) bPact.onclick = () => {
    if (player.diplo < 12) return;
    const res = pactScore(tid, game.playerId);
    if (res.score >= PACT_THRESHOLD) {
      player.diplo -= 12; signPact(game.playerId, tid, 24); sfx.peace();
      pushToast(`🕊️ Пакт с ${c.name} заключён на 24 мес.`, 'good');
    } else {
      rel.pactBlockUntil = game.totalMonths + 4;
      showInfoModal('Пакт отклонён', `${c.flag} <strong>${c.name}</strong> отказывается:<br><small>${reasonsText(res.reasons.filter((r) => r.v < 0), 3)}</small>`);
    }
    updateHud(); refreshDrawer();
  };

  const bUlt = document.getElementById('btn-ult');
  if (bUlt) bUlt.onclick = () => {
    if (player.diplo < 30 || !borders || ratio < 2.5) return;
    player.diplo -= 30;
    const accept = Math.random() < Math.min(0.92, 0.52 + (ratio - 2.5) * 0.14);
    if (accept) {
      // Если страна маленькая (<=2 пров.) и перевес x4+ — полная аннексия! Иначе уступка пограничной провинции
      if (c.provinces.length <= 2 && ratio >= 4.0) {
        for (const rpid of [...c.provinces]) {
          transferProvince(rpid, game.playerId, halfArmy(game.provinces[rpid], 80));
        }
        pushToast(`⚡ УЛЬТИМАТУМ: ${c.flag} ${c.name} полностью присоединена!`, 'good');
      } else {
        let targetP = (prov && getReachableNeighbors(prov.id).some((n) => game.provinces[n.id].ownerId === game.playerId)) ? prov : null;
        if (!targetP) {
          for (const pid of c.provinces) {
            if (getReachableNeighbors(pid).some((n) => game.provinces[n.id].ownerId === game.playerId)) {
              targetP = game.provinces[pid]; if (!targetP.isCapital) break;
            }
          }
        }
        if (targetP) {
          transferProvince(targetP.id, game.playerId, halfArmy(targetP, 80));
          pushToast(`⚡ УЛЬТИМАТУМ ПРИНЯТ! ${c.name} передала вам ${targetP.name}!`, 'good');
        }
      }
    } else {
      showModal(
        'Ультиматум отклонён!',
        `${c.flag} <strong>${c.name}</strong> отказалась подчиниться. Объявить войну?`,
        '⚔️ Объявить войну', 'btn-crimson',
        () => declareWar(game.playerId, tid)
      );
    }
    updateHud();
  };
}

// Отказ в мире: объяснение и возможность заплатить
function showPeaceRefusal(tid, res) {
  const c = game.countries[tid];
  const player = game.countries[game.playerId];
  const need = tributeNeeded(tid, game.playerId, Math.floor(player.money));
  const neg = res.reasons.filter((r) => r.v < 0);
  modalBox.innerHTML = `
    <div class="modal-title">🕊️ ${c.name} отказывается от мира</div>
    <div class="modal-body">
      <small>${reasonsText(neg.length ? neg : res.reasons, 3)}</small>
      <div style="margin-top:8px;color:#94a3b8;">${need === null
        ? 'Деньгами этого не исправить: нужно изменить ход войны или подождать.'
        : `${c.name} согласится на мир за компенсацию.`}</div>
    </div>
    <div class="modal-actions">
      <button class="btn" id="m-cancel">Закрыть</button>
      ${need ? `<button class="btn btn-gold" id="m-pay">Заплатить ${fmtNum(need)}💰</button>` : ''}
    </div>`;
  modalBackdrop.classList.add('visible');
  document.getElementById('m-cancel').onclick = closeModal;
  const pay = document.getElementById('m-pay');
  if (pay) pay.onclick = () => { closeModal(); signPeace(tid, game.playerId, need); };
}

function showInfoModal(title, html) {
  modalBox.innerHTML = `
    <div class="modal-title">${title}</div>
    <div class="modal-body">${html}</div>
    <div class="modal-actions"><button class="btn btn-sky" id="m-ok">Понятно</button></div>`;
  modalBackdrop.classList.add('visible');
  document.getElementById('m-ok').onclick = closeModal;
}

// Модальные окна
const modalBackdrop = document.getElementById('modal-backdrop');
const modalBox = document.getElementById('modal-box');
function closeModal() { modalBackdrop.classList.remove('visible'); setTimeout(() => { if (typeof checkOffers === 'function') checkOffers(); }, 0); }

function showModal(title, html, okLabel, okCls, onOk) {
  modalBox.innerHTML = `
    <div class="modal-title">${title}</div>
    <div class="modal-body">${html}</div>
    <div class="modal-actions">
      <button class="btn" id="m-cancel">Отмена</button>
      <button class="btn ${okCls}" id="m-ok">${okLabel}</button>
    </div>
  `;
  modalBackdrop.classList.add('visible');
  document.getElementById('m-cancel').onclick = closeModal;
  document.getElementById('m-ok').onclick = () => { closeModal(); onOk(); };
}

function showHelpModal() {
  modalBox.innerHTML = `
    <div class="modal-title">📘 Справка штаба</div>
    <div class="modal-body" style="display:flex;flex-direction:column;gap:8px;">
      <div><strong>🗺️ Навигация:</strong> перетаскивание 1 пальцем / ЛКМ, зум щипком / колесом, WASD или стрелки.</div>
      <div><strong>⚔️ Захват:</strong> выберите свою провинцию, выберите % войск и нажмите на подсвеченного соседа (<span style="color:#6ee7b7;">зелёный</span> — переброска, <span style="color:#fca5a5;">красный</span> — атака / морской десант по синему пунктиру).</div>
      <div><strong>🕊️ Частичный захват:</strong> во время войны отжмите нужные регионы и нажмите на врага → <em>«Мирный договор»</em>, чтобы навсегда оставить их себе!</div>
      <div><strong>🚜 Войска:</strong> пехота дёшева, но ест 🌾. Бронетехника (сила ×8) и авиация (×12, обходит форты) быстрее идут в поход, но требуют 🔩 на постройку и 🛢 на содержание. Без топлива техника воюет вполсилы.</div>
      <div><strong>🏪 Ресурсы:</strong> каждая провинция даёт 🌾 🛢 🔩 по богатству своих земель. Нехватку и излишки обменивайте на рынке. Голод косит армию.</div>
      <div><strong>💾 Сохранение:</strong> автоматически раз в месяц и при закрытии вкладки; вручную — в меню ☰.</div>
            <div><strong>🤝 Дипломатия:</strong> ИИ взвешивает силы, ход войны и свои интересы. Сильный и побеждающий враг не примет мир, а союз заключают, когда есть общий враг, общая угроза или выгода объединить силы. Причины отказа показываются в окне.</div>
      <div><strong>🏅 Репутация:</strong> разрыв союза и нападения на слабых её снижают, а с плохой репутацией вам не верят.</div>
      <div><strong>👑 Капитуляция:</strong> захват столицы + ≥70% провинций врага мгновенно покоряет всю страну. Цель — 60% мира.</div>
    </div>
    <div class="modal-actions"><button class="btn btn-sky" id="m-ok">Понятно</button></div>
  `;
  modalBackdrop.classList.add('visible');
  document.getElementById('m-ok').onclick = closeModal;
}

function showEndModal(win) {
  const p = game.countries[game.playerId];
  modalBox.innerHTML = `
    <div class="modal-title" style="color:${win ? '#fde047' : '#f87171'};">
      ${win ? '👑 МИРОВАЯ ГЕГЕМОНИЯ!' : '💀 ГОСУДАРСТВО ПАЛО'}
    </div>
    <div class="modal-body">
      ${win
        ? `${p.flag} <strong>${p.name}</strong> контролирует <strong>${getWorldPct(game.playerId).toFixed(1)}%</strong> мира (${MONTHS_RU[game.month]} ${game.year})!`
        : `Все провинции государства ${p.flag} <strong>${p.name}</strong> утрачены.`}
    </div>
    <div class="modal-actions">
      ${win ? '<button class="btn btn-emerald" id="m-cont">Продолжить</button>' : ''}
      <button class="btn btn-sky" id="m-new">Новая игра</button>
    </div>
  `;
  modalBackdrop.classList.add('visible');
  const bc = document.getElementById('m-cont');
  if (bc) bc.onclick = () => { closeModal(); game.speed = 1; updateSpeedBtn(); };
  document.getElementById('m-new').onclick = () => window.location.reload();
}

// ---------------------------------------------------------------- Рынок ресурсов
// Выбранное в рынке количество для каждого ресурса (запоминается, пока открыта игра)
const marketQty = { food: 500, fuel: 100, steel: 100 };

function showMarketModal() {
  const c = game.countries[game.playerId];
  const flow = countryResFlow(game.playerId);
  const cap = resCap(c);
  const rows = RES_KEYS.map((k) => {
    const d = RES_DEFS[k];
    const net = Math.round(flow.net[k]);
    // на сколько месяцев хватит склада, если баланс отрицательный
    const left = flow.net[k] < 0 ? c.res[k] / -flow.net[k] : Infinity;
    const leftTxt = isFinite(left) ? ` • хватит на <b class="${left <= 3 ? 'neg' : ''}">${left < 1 ? '<1' : Math.floor(left)}</b> мес.` : '';
    // сколько нужно докупить, чтобы покрыть дефицит на год вперёд
    const need = flow.net[k] < 0 ? Math.max(0, Math.min(Math.ceil(-flow.net[k] * 12 - c.res[k]), Math.floor(cap - c.res[k]))) : 0;
    return `
      <div class="mk-row mk-col" data-row="${k}">
        <div class="mk-top">
          <div class="mk-name">${d.icon} ${d.name}<small>склад ${fmtNum(Math.floor(c.res[k]))} / ${fmtNum(cap)} • баланс <b class="${net < 0 ? 'neg' : 'pos'}">${net >= 0 ? '+' : ''}${fmtNum(net)}</b>/мес${leftTxt}</small></div>
          <div class="mk-price">купить <b>${d.buy}</b>💰 • продать <b>${d.sell}</b>💰<small>за 1 ед.</small></div>
        </div>
        <div class="mk-qty">
          <input type="number" min="1" step="10" value="${marketQty[k]}" data-qty="${k}" aria-label="Количество" />
          <button class="btn btn-sm" data-set="${k}" data-v="100">100</button>
          <button class="btn btn-sm" data-set="${k}" data-v="500">500</button>
          <button class="btn btn-sm" data-set="${k}" data-v="1000">1000</button>
          ${need > 0 ? `<button class="btn btn-sm btn-emerald" data-set="${k}" data-v="${need}" title="Покрыть дефицит на 12 месяцев">на год: ${fmtNum(need)}</button>` : ''}
          <button class="btn btn-sm" data-set="${k}" data-v="max">макс</button>
        </div>
        <div class="mk-btns">
          <button class="btn btn-sm btn-sky" data-res="${k}" data-dir="buy"></button>
          <button class="btn btn-sm" data-res="${k}" data-dir="sell"></button>
        </div>
      </div>`;
  }).join('');
  modalBox.innerHTML = `
    <div class="modal-title">🏪 Рынок ресурсов</div>
    <div class="modal-body">
      <div style="margin-bottom:8px;color:#94a3b8;">Казна: 💰 <b id="mk-money" style="color:#f8fafc;">${fmtNum(c.money)}</b>. Пехота ест 🌾, техника и авиация — 🛢, постройки и техника требуют 🔩. Введите нужное количество и нажмите «Купить» или «Продать».</div>
      ${rows}
    </div>
    <div class="modal-actions"><button class="btn btn-sky" id="m-ok">Закрыть</button></div>
  `;
  modalBackdrop.classList.add('visible');
  document.getElementById('m-ok').onclick = closeModal;

  // подписи и доступность кнопок под текущее количество
  const refreshBtns = (k) => {
    const c2 = game.countries[game.playerId];
    const qty = Math.max(0, Math.floor(marketQty[k] || 0));
    const buy = modalBox.querySelector(`[data-res="${k}"][data-dir="buy"]`);
    const sell = modalBox.querySelector(`[data-res="${k}"][data-dir="sell"]`);
    buy.innerHTML = `Купить ${fmtNum(qty)}<small>${fmtNum(marketCost(k, 'buy', qty))}💰</small>`;
    sell.innerHTML = `Продать ${fmtNum(qty)}<small>+${fmtNum(marketCost(k, 'sell', qty))}💰</small>`;
    buy.disabled = qty < 1 || c2.money < marketCost(k, 'buy', qty) || c2.res[k] + qty > resCap(c2);
    sell.disabled = qty < 1 || c2.res[k] < qty;
  };
  RES_KEYS.forEach(refreshBtns);

  modalBox.querySelectorAll('[data-qty]').forEach((inp) => {
    inp.oninput = () => {
      marketQty[inp.dataset.qty] = Math.max(0, Math.floor(Number(inp.value) || 0));
      refreshBtns(inp.dataset.qty);
    };
  });
  modalBox.querySelectorAll('[data-set]').forEach((b) => {
    b.onclick = () => {
      const k = b.dataset.set;
      // «макс»: сколько можно купить на казну и склад; если купить нечего — сколько можно продать
      const v = b.dataset.v === 'max' ? (marketMax(game.playerId, k, 'buy') || marketMax(game.playerId, k, 'sell')) : Number(b.dataset.v);
      marketQty[k] = Math.max(0, Math.floor(v));
      modalBox.querySelector(`[data-qty="${k}"]`).value = marketQty[k];
      refreshBtns(k);
    };
  });
  modalBox.querySelectorAll('[data-res]').forEach((b) => {
    b.onclick = () => {
      const k = b.dataset.res;
      if (marketTrade(game.playerId, k, b.dataset.dir, marketQty[k])) { sfx.build(); updateHud(); showMarketModal(); }
    };
  });
}
