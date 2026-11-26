'use strict';
/* ГЕГЕМОН — Сценарии (режимы игры), политические режимы, международные организации и блоки
   Классический <script>: общие переменные и функции живут в глобальной области, порядок подключения см. в index.html.

   Мир сначала собирается «чистым листом» (песочница). Сценарий накладывается поверх: перераспределяет
   провинции по границам своего года, задаёт экономику и армии по реальным данным, режимы, блоки и союзы.
   Исходное состояние мира запоминается (snapshotBaseline), поэтому сценарий можно снять без перезагрузки. */

const SCENARIOS = {
  '2010': window.SCENARIO_2010
};

// ---------------------------------------------------------------- политические режимы
// aggr — базовая склонность ИИ к войне (раньше задавалась случайно для всех одинаково)
const REGIME_DEFS = {
  dem:   { icon: '🗳️', name: 'Демократия',              aggr: 0.05, desc: 'Власть сменяется на свободных выборах, суды и СМИ независимы.' },
  hyb:   { icon: '⚖️', name: 'Гибридный режим',         aggr: 0.22, desc: 'Выборы есть, но власть контролирует суды, СМИ и силовиков.' },
  auth:  { icon: '🏛️', name: 'Авторитарный режим',      aggr: 0.32, desc: 'Власть сосредоточена у лидера и его окружения, оппозиция подавлена.' },
  party: { icon: '☭',  name: 'Однопартийное государство', aggr: 0.28, desc: 'Правящая партия — единственный центр власти.' },
  abs:   { icon: '👑', name: 'Абсолютная монархия',     aggr: 0.18, desc: 'Власть монарха не ограничена парламентом.' },
  junta: { icon: '🎖️', name: 'Военный режим',           aggr: 0.45, desc: 'Власть у армии после переворота.' },
  theo:  { icon: '☪️', name: 'Теократия',               aggr: 0.38, desc: 'Высшая власть у духовенства.' },
  fail:  { icon: '🔥', name: 'Несостоявшееся государство', aggr: 0.12, desc: 'Центральная власть не контролирует большую часть страны.' }
};

// ---------------------------------------------------------------- организации и блоки
// type: mil — военный блок (союз, коллективная оборона), econ — экономический союз, pol — политическое объединение
const BLOC_DEFS = {
  nato:  { name: 'НАТО', icon: '🛡️', type: 'mil', color: '#3b82f6', full: 'Организация Североатлантического договора',
           about: 'Военный союз США, Канады и европейских стран.' },
  csto:  { name: 'ОДКБ', icon: '🛡️', type: 'mil', color: '#dc2626', full: 'Организация Договора о коллективной безопасности',
           about: 'Военный союз России и части стран бывшего СССР.' },
  us_jp: { name: 'Договор США–Япония', gen: 'договора США–Япония', icon: '🛡️', type: 'mil', color: '#60a5fa', full: 'Договор о взаимном сотрудничестве и безопасности (1960)',
           about: 'США обязуются защищать Японию.' },
  us_kr: { name: 'Договор США–Корея', gen: 'договора США–Корея', icon: '🛡️', type: 'mil', color: '#60a5fa', full: 'Договор о взаимной обороне США и Республики Корея (1953)',
           about: 'США обязуются защищать Южную Корею.' },
  anzus: { name: 'АНЗЮС', icon: '🛡️', type: 'mil', color: '#60a5fa', full: 'Тихоокеанский пакт безопасности (США и Австралия)',
           about: 'Оборонный союз США и Австралии.' },
  us_ph: { name: 'Договор США–Филиппины', gen: 'договора США–Филиппины', icon: '🛡️', type: 'mil', color: '#60a5fa', full: 'Договор о взаимной обороне США и Филиппин (1951)',
           about: 'Оборонный союз США и Филиппин.' },
  cn_kp: { name: 'Договор Китай–КНДР', gen: 'договора Китай–КНДР', icon: '🛡️', type: 'mil', color: '#f97316', full: 'Договор о дружбе, сотрудничестве и взаимной помощи (1961)',
           about: 'Китай обязуется защищать КНДР.' },

  eu:       { name: 'Евросоюз', icon: '🇪🇺', type: 'econ', color: '#facc15', full: 'Европейский союз', about: 'Общий рынок, свободное передвижение, общие правила и бюджет.' },
  euro:     { name: 'Еврозона', icon: '💶', type: 'econ', color: '#eab308', full: 'Страны с общей валютой евро', about: 'Общая валюта и общая денежная политика ЕЦБ.' },
  cu:       { name: 'Таможенный союз', icon: '📦', type: 'econ', color: '#f87171', full: 'Таможенный союз России, Беларуси и Казахстана', about: 'Общие таможенные пошлины и рынок без внутренних таможен.' },
  nafta:    { name: 'НАФТА', icon: '📦', type: 'econ', color: '#38bdf8', full: 'Североамериканское соглашение о свободной торговле', about: 'Свободная торговля США, Канады и Мексики.' },
  mercosur: { name: 'МЕРКОСУР', icon: '📦', type: 'econ', color: '#22c55e', full: 'Общий рынок стран Южной Америки', about: 'Таможенный союз стран Южной Америки.' },
  opec:     { name: 'ОПЕК', icon: '🛢️', type: 'econ', color: '#a16207', full: 'Организация стран — экспортёров нефти', about: 'Согласует квоты добычи нефти и влияет на мировые цены.' },
  gcc:      { name: 'ССАГПЗ', icon: '🕌', type: 'econ', color: '#14b8a6', full: 'Совет сотрудничества арабских государств Персидского залива', about: 'Союз монархий Персидского залива.' },

  cis:   { name: 'СНГ', icon: '🤝', type: 'pol', color: '#ef4444', full: 'Содружество Независимых Государств', about: 'Объединение большинства стран бывшего СССР.' },
  sco:   { name: 'ШОС', icon: '🤝', type: 'pol', color: '#f59e0b', full: 'Шанхайская организация сотрудничества', about: 'Сотрудничество Китая, России и стран Центральной Азии.' },
  bric:  { name: 'БРИК', icon: '🤝', type: 'pol', color: '#84cc16', full: 'Бразилия, Россия, Индия, Китай', about: 'Объединение крупнейших развивающихся экономик.' },
  asean: { name: 'АСЕАН', icon: '🤝', type: 'pol', color: '#06b6d4', full: 'Ассоциация государств Юго-Восточной Азии', about: 'Региональное объединение Юго-Восточной Азии.' },
  arab:  { name: 'Лига арабских государств', icon: '🤝', type: 'pol', color: '#10b981', full: 'Лига арабских государств', about: 'Объединение арабских стран.' },
  au:    { name: 'Африканский союз', icon: '🤝', type: 'pol', color: '#65a30d', full: 'Африканский союз', about: 'Объединение государств Африки.' },
  g8:    { name: 'Большая восьмёрка', icon: '⭐', type: 'pol', color: '#e5e7eb', full: 'G8', about: 'Клуб крупнейших развитых экономик и России.' }
};
function blocGen(id) { return BLOC_DEFS[id].gen || BLOC_DEFS[id].name; }   // «выйти из НАТО», «из договора США–Япония»
const BLOC_TYPE_NAME = { mil: 'Военный блок', econ: 'Экономический союз', pol: 'Политическое объединение' };
const BLOC_ORDER = Object.keys(BLOC_DEFS);

// «1 страна», «3 страны», «5 стран»
function countriesWord(n) {
  const a = n % 10, b = n % 100;
  return `${n} ${a === 1 && b !== 11 ? 'страна' : a >= 2 && a <= 4 && (b < 12 || b > 14) ? 'страны' : 'стран'}`;
}

function scenarioActive() { return !!game.scenario; }
function currentScenario() { return game.scenario ? SCENARIOS[game.scenario] : null; }

function isMilBloc(id) { return BLOC_DEFS[id] && BLOC_DEFS[id].type === 'mil'; }
function countryBlocs(cid) { return game.countries[cid].blocs || []; }
function blocMembers(id) { return game.countries.filter((c) => c.alive && (c.blocs || []).includes(id)); }

// Общий военный блок двух стран (первый найденный) или null
function sharedMilBloc(a, b) {
  const A = game.countries[a].blocs, B = game.countries[b].blocs;
  if (!A || !B) return null;
  for (const id of A) if (isMilBloc(id) && B.includes(id)) return id;
  return null;
}

function isNuclear(cid) { return !!game.countries[cid].nukes; }

// Число «обычных» союзов страны, без союзников по военному блоку
function adhocAllyCount(cid) { return alliesOf(cid).filter((a) => !sharedMilBloc(cid, a)).length; }

// Сила для нападения: союзники по блоку в агрессии не участвуют (договоры оборонительные)
function offenseStrength(cid) {
  if (!scenarioActive()) return blocStrength(cid);
  let s = strengthOf(cid);
  for (const a of alliesOf(cid)) if (!sharedMilBloc(cid, a)) s += strengthOf(a) * 0.7;
  return s;
}

// В «реальном мире» война — крайняя мера: ИИ реже задумывает войны, нужен больший перевес,
// реже ищет случайные союзы, а демократии не воюют друг с другом
function warPlanFactor() { return scenarioActive() ? 0.15 : 1; }
function warRatioExtra() { return scenarioActive() ? 1.0 : 0; }
function allianceSearchFactor() { return scenarioActive() ? 0.3 : 1; }
function scenarioForbidsWar(a, b) {
  if (!scenarioActive()) return false;
  const A = game.countries[a], B = game.countries[b];
  if (isNuclear(b)) return true;                                // ядерное сдерживание
  if (A.regime === 'dem' && B.regime === 'dem') return true;    // «демократический мир»
  return false;
}

// ---------------------------------------------------------------- снимок «чистого листа»
let worldBaseline = null;

function snapshotBaseline() {
  if (worldBaseline) return;
  worldBaseline = {
    year: game.year,
    month: game.month,
    provinces: game.provinces.map((p) => (p ? {
      ownerId: p.ownerId, origOwnerId: p.origOwnerId, economy: p.economy, troops: p.troops, tanks: p.tanks, air: p.air,
      name: p.name, isCapital: p.isCapital, fort: p.fort, draft: p.draft
    } : null)),
    countries: game.countries.map((c) => ({
      provinces: [...c.provinces], alive: c.alive, money: c.money, aiAggression: c.aiAggression, name: c.name,
      capitalProvId: c.capitalProvId, honor: c.honor
    }))
  };
}

const SCENARIO_COUNTRY_FIELDS = ['pop', 'gdp', 'milK', 'milexp', 'regime', 'nukes', 'blocs', 'un', 'p5', 'resMul', 'secShare', 'stmtCd', 'mods', 'applyBlock', 'ceasefireUntil', 'interventionUntil'];

function restoreBaseline() {
  if (!worldBaseline) return;
  worldBaseline.provinces.forEach((sp, i) => {
    if (!sp) return;
    const p = game.provinces[i];
    Object.assign(p, sp);
    delete p.gdp; delete p.pop; delete p.bld; delete p.bq;
  });
  game.trade = null; game.opDelta = null; game.tradeBlock = null; game.incK = null;
  game.applications = null; game.crises = null; game.crisisLog = null; game.un = null; game.loans = null; game.crisisSeeds = null;
  pendingDecisions.length = 0;
  worldBaseline.countries.forEach((sc, i) => {
    const c = game.countries[i];
    Object.assign(c, sc);
    c.provinces = [...sc.provinces];
    for (const k of SCENARIO_COUNTRY_FIELDS) delete c[k];
    c.grudge = {};
    c.warPlan = null;
  });
  game.relations = new Map();
  initDiploIndex();
  game.year = worldBaseline.year;
  game.month = worldBaseline.month;
  game.scenario = null;
  if (game.mapMode === 'blocs') game.mapMode = 'political';
  rebuildBorders();
  recomputeAllLabels();
  initResources();
}

// ---------------------------------------------------------------- наложение сценария
function moveProvinceTo(p, toCid, name) {
  const from = game.countries[p.ownerId];
  from.provinces = from.provinces.filter((id) => id !== p.id);
  if (from.capitalProvId === p.id) from.capitalProvId = from.provinces[0] || null;
  p.ownerId = toCid;
  p.origOwnerId = toCid;
  p.isCapital = false;
  if (name) p.name = name;
  game.countries[toCid].provinces.push(p.id);
}

function lonLatBoxContains(box, x, y) {
  const [x0, y0] = projectMercator(box[0], box[1]);
  const [x1, y1] = projectMercator(box[2], box[3]);
  return x >= Math.min(x0, x1) && x <= Math.max(x0, x1) && y >= Math.min(y0, y1) && y <= Math.max(y0, y1);
}

function applyScenario(id) {
  const sc = SCENARIOS[id];
  if (!sc) return false;
  snapshotBaseline();
  restoreBaseline();
  const byIso = (iso) => game.countryByIso.get(iso);

  // 1. Границы своего года
  for (const [fromIso, toIso] of Object.entries(sc.merge || {})) {
    const from = byIso(fromIso), to = byIso(toIso);
    if (!from || !to) continue;
    for (const pid of [...from.provinces]) moveProvinceTo(game.provinces[pid], to.id);
    from.alive = false;
    from.capitalProvId = null;
  }
  for (const r of sc.regions || []) {
    const from = byIso(r.from), to = byIso(r.to);
    if (!from || !to) continue;
    for (const pid of [...from.provinces]) {
      const p = game.provinces[pid];
      if (lonLatBoxContains(r.box, p.cx, p.cy)) moveProvinceTo(p, to.id, r.name);
    }
  }
  for (const [iso, name] of Object.entries(sc.rename || {})) { const c = byIso(iso); if (c) c.name = name; }

  // 2. Данные стран
  const alive = game.countries.filter((c) => c.alive && c.provinces.length);
  const nukes = new Set(sc.nukes || []), notUN = new Set(sc.notUN || []), p5 = new Set(sc.unscP5 || []);
  const blocsOf = {};
  for (const [bid, list] of Object.entries(sc.blocs || {})) for (const iso of list) (blocsOf[iso] = blocsOf[iso] || []).push(bid);
  for (const c of alive) {
    const d = sc.countries[c.iso] || [1, 3, 3, 0.05, 'hyb'];   // на всякий случай для стран без данных
    c.pop = d[0]; c.gdp = d[1]; c.milK = d[2]; c.milexp = d[3]; c.regime = d[4];
    c.nukes = nukes.has(c.iso);
    c.un = !notUN.has(c.iso);
    c.p5 = p5.has(c.iso);
    c.blocs = BLOC_ORDER.filter((b) => (blocsOf[c.iso] || []).includes(b));
  }

  // 3. Экономика провинций: суммарная экономика мира та же, что в песочнице, но делится по ВВП
  //    (степень 0.65 сглаживает разрыв: иначе у малых стран не было бы шансов вовсе)
  const base = worldBaseline.provinces;
  let worldEco = 0, worldTroops = 0, gdpPow = 0, milSum = 0;
  for (const c of alive) {
    for (const pid of c.provinces) { worldEco += base[pid].economy; worldTroops += base[pid].troops; }
    gdpPow += Math.pow(c.gdp, 0.65);
    milSum += c.milK;
  }
  const ecoK = worldEco / gdpPow;
  const troopK = worldTroops / milSum;   // одна единица пехоты ≈ столько тысяч реальных военных
  for (const c of alive) {
    const provs = c.provinces.map((pid) => game.provinces[pid]);
    const wEco = provs.reduce((s, p) => s + base[p.id].economy, 0) || 1;
    const wTr = provs.reduce((s, p) => s + base[p.id].troops, 0) || 1;
    const ecoTotal = ecoK * Math.pow(c.gdp, 0.65);
    const troopsTotal = Math.max(40 * provs.length, c.milK * troopK);
    const tanksTotal = c.milK * 0.08 + c.milexp * 1.2;
    const airTotal = c.milexp * 1.8;
    for (const p of provs) {
      const we = base[p.id].economy / wEco, wt = base[p.id].troops / wTr;
      p.economy = Math.max(1, Math.round(ecoTotal * we));
      p.troops = Math.max(30, Math.round(troopsTotal * wt));
      p.tanks = Math.round(tanksTotal * wt);
      p.air = Math.round(airTotal * wt);
    }
    // У стран, получивших чужую столицу при слиянии, столица остаётся своя
    if (!c.capitalProvId || game.provinces[c.capitalProvId].ownerId !== c.id) c.capitalProvId = c.provinces[0];
    game.provinces[c.capitalProvId].isCapital = true;
    c.money = 360 + provs.reduce((s, p) => s + p.economy * 45, 0);
    const reg = REGIME_DEFS[c.regime] || REGIME_DEFS.hyb;
    c.aiAggression = reg.aggr + Math.random() * 0.15;
  }

  // 3а. Реальные армии бедных стран (КНДР, Эритрея, Сирия) не прокормить с «игровой» земли: страна стартует
  //     с запасом продовольствия на 20% выше нужд армии. Нехватку топлива покрывает рынок, как в жизни.
  //     Топливо: богатые импортёры (Япония, Корея) докупают его на рынке, а бедным странам с советской
  //     бронетехникой это не по карману — им тоже стартовый баланс, если закупка съела бы >20% дохода.
  for (const c of alive) {
    const f = countryResFlow(c.id);
    const mul = [1, 1, 1];
    if (f.use.food > f.prod.food * 0.85 && f.prod.food > 0) mul[0] = (f.use.food * 1.2) / f.prod.food;
    const fuelGap = f.use.fuel - f.prod.fuel;
    if (fuelGap > 0 && f.prod.fuel > 0 && fuelGap * RES_DEFS.fuel.buy > getCountryStats(c.id).income * 0.2) mul[1] = (f.use.fuel * 1.2) / f.prod.fuel;
    if (mul[0] !== 1 || mul[1] !== 1) c.resMul = mul;
  }

  // 4. Военные блоки = союзы между всеми членами
  for (const [bid, list] of Object.entries(sc.blocs || {})) {
    if (!isMilBloc(bid)) continue;
    const ids = list.map(byIso).filter((c) => c && c.alive).map((c) => c.id);
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) setRelStatus(ids[i], ids[j], 'ally');
  }

  // 5. Геоэкономика: ВВП и население по провинциям, секторы, отношения, стартовые торговые связи
  game.scenario = id;
  game.incK = ecoK * 13;   // налоговый доход = 28 + incK × ВВП^0.65 — на старте как прежняя формула
  initGeoEconomy(base);
  initWorldOrder();

  game.year = sc.year;
  game.month = sc.month;
  rebuildBorders();
  recomputeAllLabels();
  initResources();
  return true;
}

// ---------------------------------------------------------------- выход из блока
function leaveBloc(cid, bid) {
  const c = game.countries[cid];
  if (!c.blocs || !c.blocs.includes(bid)) return;
  const members = blocMembers(bid).filter((m) => m.id !== cid);
  c.blocs = c.blocs.filter((b) => b !== bid);
  if (isMilBloc(bid)) {
    for (const m of members) {
      if (isAllied(cid, m.id) && !sharedMilBloc(cid, m.id)) setRelStatus(cid, m.id, 'neutral');
      m.grudge = m.grudge || {};
      m.grudge[cid] = (m.grudge[cid] || 0) + 1;
      changeOpinion(m.id, cid, -20);
    }
    c.honor = Math.max(0, c.honor - 10);
  } else {
    for (const m of members) changeOpinion(m.id, cid, -10);
  }
  const cap = game.provinces[c.capitalProvId || c.provinces[0]];
  addNews(`🚪 ${c.flag} ${c.name} вышла из ${blocGen(bid)}`, isMilBloc(bid) ? 'war' : '', cap?.cx ?? null, cap?.cy ?? null);
}

// ---------------------------------------------------------------- цвета карты блоков
function blocMapColor(cid) {
  const b = game.countries[cid].blocs;
  if (!b || !b.length) return '#3e4a5c';
  if (b.includes('nato')) return '#2f6fd6';
  if (b.includes('csto')) return '#c23434';
  for (const id of b) if (isMilBloc(id)) return BLOC_DEFS[id].color;
  if (b.includes('eu')) return '#c9a227';
  return '#3e4a5c';
}

// ---------------------------------------------------------------- тексты для интерфейса
function fmtGdp(bn) {
  if (bn >= 1000) return `$${(bn / 1000).toFixed(bn >= 10000 ? 1 : 2).replace('.', ',')} трлн`;
  if (bn >= 10) return `$${Math.round(bn)} млрд`;
  return `$${bn.toFixed(1).replace('.', ',')} млрд`;
}
function fmtPop(mln) {
  if (mln >= 1000) return `${(mln / 1000).toFixed(2).replace('.', ',')} млрд`;
  if (mln >= 10) return `${Math.round(mln)} млн`;
  return `${mln.toFixed(1).replace('.', ',')} млн`;
}
function gdpPerCapita(c) { return c.pop > 0 ? (c.gdp * 1000) / c.pop : 0; }   // $ на человека
function fmtPerCapita(c) {
  return '$' + String(Math.round(gdpPerCapita(c) / 10) * 10).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function blocChipsHtml(cid, limit = 99) {
  const b = countryBlocs(cid);
  if (!b.length) return '<span class="bloc-chip none">вне блоков</span>';
  const shown = b.slice(0, limit).map((id) => {
    const d = BLOC_DEFS[id];
    return `<span class="bloc-chip ${d.type}" style="--bc:${d.color}" title="${d.full}">${d.name}</span>`;
  }).join('');
  return shown + (b.length > limit ? `<span class="bloc-chip none">+${b.length - limit}</span>` : '');
}

// Короткая сводка страны для панелей: режим, население, ВВП, блоки
function countryFactsHtml(cid, chipLimit = 99) {
  const c = game.countries[cid];
  if (!scenarioActive() || !c.regime) return '';
  const reg = REGIME_DEFS[c.regime] || REGIME_DEFS.hyb;
  return `
    <div class="facts-box">
      <div class="facts-row"><span>${reg.icon} ${reg.name}</span>${c.nukes ? '<span class="nuke-tag" title="Ядерное оружие">☢ ядерная держава</span>' : ''}</div>
      <div class="facts-grid">
        <div><span>Население</span><strong>${fmtPop(c.pop)}</strong></div>
        <div><span>ВВП</span><strong>${fmtGdp(c.gdp)}</strong></div>
        <div><span>На душу</span><strong>${fmtPerCapita(c)}</strong></div>
      </div>
      <div class="bloc-chips">${blocChipsHtml(cid, chipLimit)}</div>
    </div>`;
}

// Окно «Государство» (кнопка 🏛 в HUD): вкладки «Обзор», «Экономика», «Торговля», «Организации»
const STATE_TABS = [['overview', 'Обзор'], ['economy', 'Экономика'], ['trade', 'Торговля'], ['blocs', 'Организации']];
function showStateModal(tab = 'overview') {
  if (game.phase !== 'playing' || !scenarioActive()) return;
  const cid = game.playerId;
  const c = game.countries[cid];
  refreshCountryEconomy(c);
  const reg = REGIME_DEFS[c.regime] || REGIME_DEFS.hyb;
  let body = '';
  if (tab === 'overview') {
    const inc = incomeBreakdown(c), gr = growthRate(c);
    body = `${countryFactsHtml(cid)}
      <div class="facts-grid">
        <div><span>Рост ВВП</span><strong style="color:${gr.g >= 0 ? '#34d399' : '#f87171'}">${fmtPct(gr.g)} в год</strong></div>
        <div><span>Доход казны</span><strong>${fmtMoney(inc.total)}/мес</strong></div>
        <div><span>Торговля</span><strong>${tradePartners(cid).length}/${tradeSlots(c)} соглаш.</strong></div>
      </div>
      <small style="color:var(--muted)">${reg.desc}${c.un ? ' Член ООН' + (c.p5 ? ', постоянный член Совета Безопасности (право вето).' : '.') : ' Не член ООН.'}</small>`;
  } else if (tab === 'economy') body = stateEconomyHtml(c);
  else if (tab === 'trade') body = stateTradeHtml(c);
  else {
    body = countryBlocs(cid).map((id) => {
      const d = BLOC_DEFS[id];
      const n = blocMembers(id).length;
      const effect = d.type === 'mil'
        ? 'Нападение на члена — война со всем блоком. Воевать со своим блоком нельзя. Тому, кто напал сам, блок помогать не обязан.'
        : BLOC_TRADE_BONUS[id] ? `Общий рынок: +${Math.round(BLOC_TRADE_BONUS[id] * 100)}% к налоговому доходу${id === 'eu' ? ' и +0,3% к росту ВВП' : ''}.`
        : id === 'opec' ? 'Квоты добычи держат цену нефти: +4% к доходу, если нефть и газ — 15% экономики и больше.'
        : 'Сближает членов: отношение друг к другу выше.';
      return `
      <div class="bloc-row">
        <div class="bloc-row-head">
          <span class="bloc-chip ${d.type}" style="--bc:${d.color}">${d.name}</span>
          <small>${BLOC_TYPE_NAME[d.type]} • ${countriesWord(n)}</small>
          <button class="btn btn-sm" data-leave="${id}">🚪 Выйти</button>
        </div>
        <small>${d.about} ${effect}</small>
      </div>`;
    }).join('') || '<small style="color:var(--muted)">Страна не состоит в организациях.</small>';
  }

  modalBox.innerHTML = `
    <div class="modal-title">🏛 ${c.flag} ${c.name}</div>
    <div class="state-tabs">${STATE_TABS.map(([id, name]) => `<button class="state-tab ${id === tab ? 'active' : ''}" data-tab="${id}">${name}</button>`).join('')}</div>
    <div class="modal-body modal-scroll" style="display:flex;flex-direction:column;gap:8px;">${body}</div>
    <div class="modal-actions"><button class="btn btn-sky" id="m-ok">Закрыть</button></div>
  `;
  modalBackdrop.classList.add('visible');
  document.getElementById('m-ok').onclick = closeModal;
  modalBox.querySelectorAll('.state-tab').forEach((b) => { b.onclick = () => showStateModal(b.dataset.tab); });
  if (tab === 'trade') bindStateTrade(c);
  modalBox.querySelectorAll('[data-leave]').forEach((btn) => {
    btn.onclick = () => {
      const bid = btn.dataset.leave;
      const d = BLOC_DEFS[bid];
      const warn = d.type === 'mil'
        ? `Вы потеряете защиту блока, а союзы со всеми его членами будут расторгнуты. Репутация −10, отношение членов блока к вам −20.`
        : BLOC_TRADE_BONUS[bid] ? `Вы потеряете доход общего рынка (+${Math.round(BLOC_TRADE_BONUS[bid] * 100)}% к налогам), отношение членов к вам ухудшится.` : 'Отношение членов организации к вам станет хуже.';
      showModal(`Выйти из ${blocGen(bid)}?`, warn, '🚪 Выйти', 'btn-crimson', () => {
        leaveBloc(cid, bid);
        sfx.click();
        pushToast(`Вы вышли из ${blocGen(bid)}.`);
        updateHud();
        refreshDrawer();
      });
    };
  });
}

// ---------------------------------------------------------------- переключатель режима на экране выбора страны
const MODE_KEY = 'gegemon.mode';

function setGameMode(mode, silent) {
  if (game.phase !== 'select') return;
  if (mode && SCENARIOS[mode]) applyScenario(mode);
  else restoreBaseline();
  try { localStorage.setItem(MODE_KEY, mode || ''); } catch (_) {}
  document.querySelectorAll('#mode-switch .mode-btn').forEach((b) => b.classList.toggle('active', (b.dataset.mode || '') === (game.scenario || '')));
  game.mapMode = 'political';
  if (!silent) {
    sfx.click();
    pushToast(game.scenario ? '🏛 Мир 2010: реальные границы, экономика, блоки и режимы.' : '🌐 Песочница: все страны с чистого листа.');
  }
  const sel = game.selectedCountryId;
  if (sel !== null && game.countries[sel] && game.countries[sel].alive) inspectCountryPreGame(sel);
  else { game.selectedCountryId = null; drawer.classList.remove('open'); }
  populateCountryList(document.getElementById('country-search').value);
}

function initModeSwitch() {
  document.querySelectorAll('#mode-switch .mode-btn').forEach((b) => {
    b.onclick = () => setGameMode(b.dataset.mode || '');
  });
  let saved = '';
  try { saved = localStorage.getItem(MODE_KEY) || ''; } catch (_) {}
  if (saved && SCENARIOS[saved]) {
    applyScenario(saved);
    document.querySelectorAll('#mode-switch .mode-btn').forEach((b) => b.classList.toggle('active', (b.dataset.mode || '') === saved));
  }
}

function updateMapLegend() {
  const el = document.getElementById('map-legend');
  if (el) el.classList.toggle('hidden', !(game.phase === 'playing' && game.mapMode === 'blocs'));
}
