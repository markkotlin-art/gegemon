'use strict';
/* ГЕГЕМОН — Геоэкономика режима «Мир 2010»: ВВП по провинциям и секторам, постройки (заводы, порты, банки…),
   торговые соглашения с конкретными странами, бонусы экономических блоков, отношение стран друг к другу
   и публичные заявления.
   Классический <script>: общие переменные и функции живут в глобальной области, порядок подключения см. в index.html.

   Принципы:
   • ВВП живёт в провинциях (p.gdp, млрд $ в год) — при захвате провинция уносит свою экономику и постройки.
   • Доход казны в сценарии = 28 + game.incK × ВВП^0.65 (на старте ровно столько же, сколько давала прежняя формула),
     плюс доход от торговых соглашений и от общих рынков (ЕС, НАФТА…).
   • Постройка добавляет долю ВВП страны (с убывающей отдачей), стоит несколько месяцев дохода и даёт ресурсы.
   • Отношение страны A к B = база (блоки, режимы, исторические конфликты) + след событий (заявления, войны,
     торговля), который со временем затухает. От отношения зависят торговля, союзы, пакты и выбор целей войны. */

// ---------------------------------------------------------------- ГЕОГРАФИЯ БЕЗ ЭКОНОМИКИ
// Соседи и центр страны. Отдельно от dipInfo: тот считает силу через доход, а доход теперь зависит от торговли —
// иначе получилась бы рекурсия «доход → торговля → соседство → доход».
let geoCache = { t: 0, map: new Map() };
function geoInfo(cid) {
  const now = performance.now();
  if (now - geoCache.t > 1000) geoCache = { t: now, map: new Map() };
  let v = geoCache.map.get(cid);
  if (v) return v;
  const c = game.countries[cid];
  let sx = 0, sy = 0;
  const nbrs = new Set();
  for (const pid of c.provinces) {
    const p = game.provinces[pid];
    sx += p.cx; sy += p.cy;
    for (const nb of p.neighbors) { const o = game.provinces[nb].ownerId; if (o !== cid) nbrs.add(o); }
  }
  const n = Math.max(1, c.provinces.length);
  v = { cx: sx / n, cy: sy / n, nbrs };
  geoCache.map.set(cid, v);
  return v;
}
function geoNeighbors(a, b) { return geoInfo(a).nbrs.has(b) || geoInfo(b).nbrs.has(a); }
function geoDist(a, b) { const A = geoInfo(a), B = geoInfo(b); return Math.hypot(A.cx - B.cx, A.cy - B.cy); }

// ---------------------------------------------------------------- СЕКТОРЫ ЭКОНОМИКИ
const SECTORS = {
  agri:     { icon: '🌾', name: 'Сельское хозяйство', color: '#84cc16' },
  energy:   { icon: '🛢', name: 'Нефть, газ, добыча', color: '#a16207' },
  industry: { icon: '🏭', name: 'Промышленность', color: '#64748b' },
  finance:  { icon: '🏦', name: 'Банки и финансы', color: '#22c55e' },
  tech:     { icon: '💻', name: 'Технологии и IT', color: '#38bdf8' },
  tourism:  { icon: '🏨', name: 'Туризм', color: '#f472b6' },
  services: { icon: '🛒', name: 'Услуги и торговля', color: '#a78bfa' }
};
const SECTOR_KEYS = Object.keys(SECTORS);

// Особые структуры экономики (доли, остальное считается по формуле)
const SECTOR_OVERRIDE = {
  '156': { industry: 0.40, tech: 0.03, finance: 0.05 },        // Китай — «мастерская мира»
  '276': { industry: 0.27, tech: 0.04, finance: 0.05 },
  '392': { industry: 0.25, tech: 0.06, finance: 0.06 },
  '410': { industry: 0.30, tech: 0.08 },
  '158': { industry: 0.28, tech: 0.10 },
  '840': { finance: 0.08, tech: 0.07, industry: 0.13 },
  '826': { finance: 0.10, tech: 0.05, industry: 0.11 },
  '756': { finance: 0.12, industry: 0.18 },
  '376': { tech: 0.10, industry: 0.14 },
  '356': { tech: 0.05, agri: 0.17 },
  '246': { tech: 0.06 }, '752': { tech: 0.05 },
  '724': { tourism: 0.11 }, '380': { tourism: 0.09 }, '300': { tourism: 0.16 }, '792': { tourism: 0.08 },
  '764': { tourism: 0.12 }, '818': { tourism: 0.10 }, '250': { tourism: 0.08 }, '191': { tourism: 0.15 },
  '196': { tourism: 0.15, finance: 0.08 }, '484': { tourism: 0.08 }, '504': { tourism: 0.09 }, '788': { tourism: 0.09 },
  '044': { tourism: 0.40 }, '388': { tourism: 0.25 }, '214': { tourism: 0.15 }, '144': { tourism: 0.08 }
};

// Доля добычи (нефть, газ, металлы) в ВВП крупных сырьевых стран около 2010 года, приблизительно
const ENERGY_SHARE = {
  '682': 0.45, '414': 0.5, '634': 0.5, '784': 0.3, '368': 0.55, '364': 0.25, '434': 0.6, '012': 0.35, '024': 0.45,
  '566': 0.3, '862': 0.3, '643': 0.2, '398': 0.25, '031': 0.45, '578': 0.22, '512': 0.45, '096': 0.6, '795': 0.4,
  '226': 0.7, '266': 0.4, '178': 0.55, '148': 0.3, '729': 0.2, '218': 0.15, '124': 0.08, '840': 0.03, '484': 0.07,
  '076': 0.04, '360': 0.07, '458': 0.1, '036': 0.08, '152': 0.12, '604': 0.1, '496': 0.2, '068': 0.1, '170': 0.07,
  '818': 0.07, '780': 0.4, '887': 0.25, '760': 0.2, '860': 0.1, '710': 0.08, '180': 0.15, '894': 0.15, '516': 0.12,
  '072': 0.3, '324': 0.15, '478': 0.15, '328': 0.1, '740': 0.15, '608': 0.02
};

// Доли секторов в ВВП страны на старте сценария
function baseSectorShares(c) {
  const pc = c.pop > 0 ? (c.gdp * 1000) / c.pop : 3000;
  const prof = RES_PROFILE[c.iso] || RES_PROFILE_DEFAULT;
  const s = {};
  s.agri = pc < 1000 ? 0.30 : pc < 3000 ? 0.18 : pc < 10000 ? 0.09 : pc < 25000 ? 0.04 : 0.02;
  s.energy = ENERGY_SHARE[c.iso] ?? (prof[1] >= 1.5 ? 0.1 : prof[1] >= 0.8 ? 0.05 : 0.02);
  s.industry = pc < 1000 ? 0.12 : 0.22;
  s.finance = pc > 30000 ? 0.06 : pc > 10000 ? 0.04 : 0.02;
  s.tech = pc > 30000 ? 0.03 : pc > 10000 ? 0.02 : 0.01;
  s.tourism = 0.03;
  Object.assign(s, SECTOR_OVERRIDE[c.iso] || {});
  if (s.energy > 0.3) s.industry = Math.min(s.industry, 0.12);
  let sum = 0;
  for (const k of SECTOR_KEYS) if (k !== 'services') sum += s[k];
  if (sum > 0.8) { const k = 0.8 / sum; for (const key of SECTOR_KEYS) if (key !== 'services') s[key] *= k; sum = 0.8; }
  s.services = 1 - sum;
  return s;
}

// ---------------------------------------------------------------- ПОСТРОЙКИ
// share — доля ВВП страны, которую добавляет постройка (дальше каждая следующая того же типа даёт на 15% меньше);
// cost — во сколько месячных доходов казны обходится; days — срок стройки; res — ресурсы в месяц.
const BUILDINGS = {
  factory: { icon: '🏭', name: 'Завод', sector: 'industry', share: 0.024, cost: 0.6, steel: 40, days: 180, res: { steel: 14 },
             about: 'Промышленность: рост ВВП и сталь.' },
  port:    { icon: '⚓', name: 'Порт', sector: 'services', share: 0.012, cost: 0.55, steel: 30, days: 240, perProv: 1, coastal: true,
             about: 'Ещё одно торговое соглашение и +20% к доходу от торговли.' },
  oil:     { icon: '🛢', name: 'Нефтегазовый промысел', sector: 'energy', share: 0.03, cost: 0.65, steel: 35, days: 210, res: { fuel: 22 }, needOil: true,
             about: 'Добыча нефти и газа: топливо и экспорт. Нужны запасы в недрах.' },
  agro:    { icon: '🌾', name: 'Агрохолдинг', sector: 'agri', share: 0.012, cost: 0.35, steel: 10, days: 120, res: { food: 30 },
             about: 'Продовольствие и сельскохозяйственный экспорт.' },
  bank:    { icon: '🏦', name: 'Финансовый центр', sector: 'finance', share: 0.03, cost: 0.75, steel: 10, days: 240, perProv: 1, needBank: true,
             about: '+10% к доходу от торговли. Нужны стабильные институты и крупный город.' },
  tech:    { icon: '💻', name: 'Технопарк', sector: 'tech', share: 0.035, cost: 0.95, steel: 15, days: 300, needTech: true,
             about: '+0,3% к ежегодному росту ВВП (до +1%). Нужен средний уровень дохода или финансовый центр.' },
  resort:  { icon: '🏨', name: 'Курорт', sector: 'tourism', share: 0.016, cost: 0.4, steel: 10, days: 150, coastal: true,
             about: 'Туризм. Во время войны доход курортов падает до нуля.' }
};
const BUILDING_KEYS = Object.keys(BUILDINGS);

function provSlots(p) { return 2 + Math.min(4, Math.floor((p.economy || 1) / 3)) + (p.isCapital ? 1 : 0); }
function provBuildCount(p) { let n = 0; for (const k in (p.bld || {})) n += p.bld[k].n; return n; }
function countryBuildCount(c, type) {
  let n = 0;
  for (const pid of c.provinces) { const b = game.provinces[pid].bld; if (b && b[type]) n += b[type].n; }
  return n;
}
function countryBuildQueue(c) { return c.provinces.map((pid) => game.provinces[pid]).filter((p) => p.bq && p.bq.owner === c.id); }
function maxConcurrentBuilds(c) { return Math.max(2, Math.min(6, Math.round(1 + Math.log10(Math.max(1, c.gdp || 1))))); }

// Можно ли строить: { ok, why }
function canBuild(cid, p, type) {
  const c = game.countries[cid], d = BUILDINGS[type];
  if (p.ownerId !== cid) return { ok: false, why: 'не ваша провинция' };
  if (p.bq) return { ok: false, why: 'в провинции уже идёт стройка' };
  if (provBuildCount(p) >= provSlots(p)) return { ok: false, why: 'нет места: все участки заняты' };
  if (d.perProv && p.bld && p.bld[type] && p.bld[type].n >= d.perProv) return { ok: false, why: 'уже построен' };
  if (d.coastal && !p.isCoastal && !(type === 'resort' && p.isCapital)) return { ok: false, why: 'нужен выход к морю' };
  if (d.needOil) {
    const prof = RES_PROFILE[game.countries[p.origOwnerId].iso] || RES_PROFILE_DEFAULT;
    if (prof[1] < 0.8) return { ok: false, why: 'нет запасов нефти и газа' };
  }
  if (d.needBank) {
    if (['junta', 'fail'].includes(c.regime)) return { ok: false, why: 'инвесторы не доверяют режиму' };
    if (!p.isCapital && (p.gdp || 0) < (c.gdp || 0) * 0.25) return { ok: false, why: 'нужна столица или крупный экономический центр' };
  }
  if (d.needTech && gdpPerCapita(c) < 4000 && countryBuildCount(c, 'bank') === 0) return { ok: false, why: 'нужен доход от $4000 на душу или финансовый центр' };
  if (enemiesOf(cid).length && game.fights && game.fights.some((f) => f.pid === p.id)) return { ok: false, why: 'в провинции идёт бой' };
  if (countryBuildQueue(c).length >= maxConcurrentBuilds(c)) return { ok: false, why: `одновременно не больше ${maxConcurrentBuilds(c)} строек` };
  const cost = buildCost(cid, type);
  if (c.money < cost.money) return { ok: false, why: 'не хватает денег' };
  if (c.res.steel < cost.steel) return { ok: false, why: 'не хватает стали' };
  return { ok: true };
}

function buildCost(cid, type) {
  const c = game.countries[cid], d = BUILDINGS[type];
  return { money: Math.round(Math.max(150, taxIncome(c) * d.cost)), steel: d.steel };
}

// Сколько млрд $ ВВП добавит постройка сейчас (убывающая отдача по числу таких же построек)
function buildGain(cid, type) {
  const c = game.countries[cid], d = BUILDINGS[type];
  return (c.gdp || 1) * d.share * Math.pow(0.8, countryBuildCount(c, type));
}

function startBuild(cid, pid, type) {
  const p = game.provinces[pid];
  const chk = canBuild(cid, p, type);
  if (!chk.ok) return false;
  const c = game.countries[cid], cost = buildCost(cid, type);
  c.money -= cost.money;
  c.res.steel -= cost.steel;
  p.bq = { type, days: BUILDINGS[type].days, total: BUILDINGS[type].days, owner: cid };
  return true;
}

function processConstructionDay() {
  for (let pid = 1; pid < game.provinces.length; pid++) {
    const p = game.provinces[pid];
    if (!p.bq) continue;
    if (p.ownerId !== p.bq.owner) { p.bq = null; continue; }   // провинцию захватили — стройка брошена
    if (game.fights && game.fights.some((f) => f.pid === pid)) continue;   // в бою стройка стоит
    if (--p.bq.days > 0) continue;
    const type = p.bq.type, owner = p.bq.owner;
    const gain = buildGain(owner, type);
    p.bld = p.bld || {};
    const b = p.bld[type] || (p.bld[type] = { n: 0, gdp: 0 });
    b.n++;
    b.gdp += gain;
    p.economy += 1;   // крупнее экономика — больше ресурсов и призывников
    p.bq = null;
    invalidateIncome(owner);
    if (owner === game.playerId) {
      const d = BUILDINGS[type];
      pushToast(`${d.icon} ${d.name} в провинции ${p.name} построен: +${fmtGdp(gain)} ВВП в год`, 'good');
      addNews(`${d.icon} Открыт ${d.name.toLowerCase()} — ${p.name}`, 'ally', p.cx, p.cy);
    }
  }
}

// ---------------------------------------------------------------- ВВП, ДОХОД, РОСТ
function provGdp(p) {
  let g = p.gdp || 0;
  if (p.bld) for (const k in p.bld) g += p.bld[k].gdp;
  return g;
}

// Пересчёт ВВП и населения страны из провинций (вызывается из getCountryStats)
function refreshCountryEconomy(c) {
  let g = 0, pop = 0;
  for (const pid of c.provinces) { const p = game.provinces[pid]; g += provGdp(p); pop += p.pop || 0; }
  c.gdp = Math.max(0.1, g);
  c.pop = Math.max(0.01, pop);
}

// ВВП по секторам: база провинций по долям страны + постройки по своим секторам
function sectorGdp(c) {
  const out = {};
  for (const k of SECTOR_KEYS) out[k] = 0;
  const sh = c.secShare || baseSectorShares(c);
  const war = enemiesOf(c.id).length > 0;
  for (const pid of c.provinces) {
    const p = game.provinces[pid];
    for (const k of SECTOR_KEYS) out[k] += (p.gdp || 0) * sh[k];
    if (p.bld) for (const t in p.bld) {
      const sec = BUILDINGS[t].sector;
      out[sec] += t === 'resort' && war ? 0 : p.bld[t].gdp;
    }
  }
  return out;
}

// Налоговый доход в месяц (без торговли)
function taxIncome(c) {
  const g = c.gdp || 1;
  let inc = 28 + (game.incK || 4.6) * Math.pow(g, 0.65);
  // во время войны курорты не работают
  if (enemiesOf(c.id).length) {
    let resortGdp = 0;
    for (const pid of c.provinces) { const b = game.provinces[pid].bld; if (b && b.resort) resortGdp += b.resort.gdp; }
    if (resortGdp > 0) inc -= (game.incK || 4.6) * (Math.pow(g, 0.65) - Math.pow(Math.max(1, g - resortGdp), 0.65));
  }
  return inc;
}

// Доход от общих рынков экономических блоков (доля налогового дохода)
const BLOC_TRADE_BONUS = { eu: 0.08, euro: 0.03, nafta: 0.05, cu: 0.04, mercosur: 0.03, asean: 0.02, gcc: 0.02 };
function blocTradeIncome(c) {
  let k = 0;
  for (const b of c.blocs || []) k += BLOC_TRADE_BONUS[b] || 0;
  if ((c.blocs || []).includes('opec') && (c.secShare?.energy || 0) >= 0.15) k += 0.04;   // квоты ОПЕК держат цену
  return taxIncome(c) * k;
}

// Доход за месяц с кэшем: getCountryStats зовут очень часто (ИИ, интерфейс, ежедневный тик), а доход меняется
// медленно. Пересчёт раз в 30 дней и сразу после событий: торговля, стройка, война, смена числа провинций.
function scenarioIncome(c) {
  const day = game.totalDays || 0;
  if (c._incDay === undefined || c._incDay < 0 || day - c._incDay >= 30 || day < c._incDay || c._incN !== c.provinces.length) {
    refreshCountryEconomy(c);
    c._inc = incomeBreakdown(c).total;
    c._incDay = day;
    c._incN = c.provinces.length;
  }
  return c._inc;
}
function invalidateIncome(...ids) { for (const id of ids) if (game.countries[id]) game.countries[id]._incDay = -1; }

function incomeBreakdown(c) {
  const tax = taxIncome(c) * (1 + modSum(c, 'income'));   // санкции и т. п.
  const bloc = blocTradeIncome(c);
  let trade = 0;
  const partners = tradePartners(c.id).map((pid) => { const v = tradeValue(c.id, pid); trade += v; return { id: pid, v }; });
  return { tax, bloc, trade, partners, total: Math.round(tax + bloc + trade) };
}

// Годовой рост ВВП (доля): уровень развития, технопарки, торговля, блоки, режим, война
function growthRate(c) {
  const pc = gdpPerCapita(c) / 1000;
  let g = pc < 1 ? 0.055 : pc < 3 ? 0.05 : pc < 8 ? 0.042 : pc < 20 ? 0.03 : 0.018;
  const R = [{ t: 'уровень развития', v: g }];
  const add = (v, t) => { if (Math.abs(v) >= 0.0005) { g += v; R.push({ t, v }); } };
  add(Math.min(0.01, countryBuildCount(c, 'tech') * 0.003), 'технопарки');
  add(Math.min(0.006, tradePartners(c.id).length * 0.001), 'торговые соглашения');
  if ((c.blocs || []).includes('eu')) add(0.003, 'общий рынок ЕС');
  add({ dem: 0, hyb: -0.002, auth: -0.004, party: 0.005, abs: 0, junta: -0.01, theo: -0.006, fail: -0.02 }[c.regime] || 0, 'политический режим');
  if (enemiesOf(c.id).length) add(-0.03, 'война');
  for (const m of modList(c, 'growth')) add(m.v, m.t);
  if (c.starving) add(-0.02, 'голод');
  return { g, reasons: R };
}

function popGrowth(c) {
  const pc = gdpPerCapita(c) / 1000;
  return pc < 1 ? 0.026 : pc < 3 ? 0.02 : pc < 10 ? 0.012 : pc < 25 ? 0.006 : 0.003;
}

// ---------------------------------------------------------------- ТОРГОВЫЕ СОГЛАШЕНИЯ
function tradeKey(a, b) { return a < b ? `${a}:${b}` : `${b}:${a}`; }
function hasTrade(a, b) { return game.trade && game.trade.has(tradeKey(a, b)); }
function tradePartners(cid) {
  if (!game.trade) return [];
  const out = [];
  for (const k of game.trade) {
    const [a, b] = k.split(':').map(Number);
    if (a === cid && game.countries[b].alive) out.push(b);
    else if (b === cid && game.countries[a].alive) out.push(a);
  }
  return out;
}
function countryPorts(c) { return countryBuildCount(c, 'port'); }
function tradeSlots(c) { return 2 + countryPorts(c) + Math.max(0, Math.floor(Math.log10(Math.max(1, c.gdp || 1)))); }

// Главная статья экспорта страны — для подписей и «взаимодополняемости»
let exportCache = { t: 0, map: new Map() };
function mainExport(c) {
  const now = performance.now();
  if (now - exportCache.t > 1000) exportCache = { t: now, map: new Map() };
  const hit = exportCache.map.get(c.id);
  if (hit) return hit;
  const s = sectorGdp(c);
  const cand = ['energy', 'industry', 'agri', 'tech', 'finance', 'tourism'];
  let best = 'industry', bv = -1;
  const W = { energy: 2, agri: 1.2 };   // сырьё в основном идёт на экспорт, промышленность — и на свой рынок
  for (const k of cand) { const v = s[k] * (W[k] || 1); if (v > bv) { bv = v; best = k; } }
  exportCache.map.set(c.id, best);
  return best;
}
const EXPORT_LABEL = { energy: 'нефть и газ', industry: 'промтовары', agri: 'продовольствие', tech: 'технологии', finance: 'финансовые услуги', tourism: 'туризм' };

// Доход страны a от торговли с b в месяц
function tradeValue(a, b) {
  const A = game.countries[a], B = game.countries[b];
  const base = taxIncome(A) * 0.05;
  const size = Math.max(0.3, Math.min(1.6, Math.pow((B.gdp || 1) / (A.gdp || 1), 0.25)));
  const ports = 1 + 0.2 * Math.min(3, countryPorts(A)) + 0.1 * Math.min(2, countryBuildCount(A, 'bank'));
  let dist = 1;
  if (geoNeighbors(a, b)) dist = 1.2;
  else if (geoDist(a, b) > FAR_DIST) dist = countryPorts(A) && countryPorts(B) ? 0.9 : 0.7;
  const ea = mainExport(A), eb = mainExport(B);
  const compl = ea !== eb ? 1.2 : 1;
  const op = 1 + Math.max(-0.2, Math.min(0.2, getOpinion(a, b) / 250));
  return base * size * ports * dist * compl * op;
}

function signTrade(a, b, silent) {
  if (!game.trade) game.trade = new Set();
  game.trade.add(tradeKey(a, b));
  invalidateIncome(a, b);
  changeOpinion(a, b, 8); changeOpinion(b, a, 8);
  if (!silent) addNews(`📦 ${nm(a)} и ${nm(b)} подписали торговое соглашение`, 'ally');
}

function cancelTrade(a, b, byWhom, reason) {
  if (!hasTrade(a, b)) return;
  game.trade.delete(tradeKey(a, b));
  invalidateIncome(a, b);
  if (byWhom !== undefined) {
    const other = byWhom === a ? b : a;
    changeOpinion(other, byWhom, -15);
    addNews(`✂️ ${nm(byWhom)} разорвала торговое соглашение с ${nm(other)}${reason ? ` (${reason})` : ''}`, 'war');
  }
}

// Хочет ли ai торговать с other: { score, reasons }
const TRADE_THRESHOLD = 0.5;
function tradeScore(aiId, otherId) {
  const ai = game.countries[aiId], ot = game.countries[otherId];
  const R = [];
  if (isAtWar(aiId, otherId)) return { score: -99, reasons: [{ v: -99, t: 'мы воюем' }], blocked: true };
  if (game.un && sanctionsBlockTrade(aiId, otherId)) return { score: -99, reasons: [{ v: -99, t: 'действуют санкции ООН' }], blocked: true };
  const blk = game.tradeBlock && game.tradeBlock.get(tradeKey(aiId, otherId));
  if (blk && blk > (game.totalDays || 0)) return { score: -99, reasons: [{ v: -99, t: 'недавно было эмбарго' }], blocked: true };
  if (tradePartners(aiId).length >= tradeSlots(ai)) return { score: -99, reasons: [{ v: -99, t: `${ai.name}: все торговые соглашения заняты (нужны порты)` }], blocked: true };
  R.push({ v: 0.3, t: 'торговля выгодна' });
  const op = getOpinion(aiId, otherId);
  addReason(R, op / 35, op >= 0 ? 'хорошие отношения' : 'плохие отношения');
  const v = tradeValue(aiId, otherId) / Math.max(1, taxIncome(ai));
  addReason(R, Math.min(1, v * 10), `выгода +${Math.round(tradeValue(aiId, otherId))}💰 в месяц`);
  if (mainExport(ai) !== mainExport(ot)) addReason(R, 0.3, `${ot.name} продаёт ${EXPORT_LABEL[mainExport(ot)]}`);
  if (geoDist(aiId, otherId) > FAR_DIST && !(countryPorts(ai) && countryPorts(ot))) addReason(R, -0.4, 'далеко, нет портов');
  const aMil = (ai.blocs || []).find(isMilBloc), oMil = (ot.blocs || []).find(isMilBloc);
  if (aMil && oMil && aMil !== oMil && ['nato', 'csto'].includes(aMil) && ['nato', 'csto'].includes(oMil)) addReason(R, -0.4, 'противостоящие военные блоки');
  return finishScore(R, pairNoise(aiId, otherId, 7) * 0.3);
}

// ---------------------------------------------------------------- ОТНОШЕНИЕ СТРАН
// Исторические симпатии и конфликты 2010 года (симметричные)
const OPINION_PAIRS = [
  ['840', '364', -70], ['840', '408', -80], ['840', '192', -50], ['840', '862', -40], ['840', '760', -40],
  ['376', '364', -90], ['376', '760', -70], ['376', '422', -50], ['376', '275', -40], ['682', '364', -50],
  ['356', '586', -60], ['156', '158', -50], ['156', '392', -20], ['156', '356', -20], ['410', '408', -80],
  ['392', '408', -60], ['051', '031', -80], ['643', '268', -60], ['300', '792', -25], ['196', '792', -50],
  ['688', 'X170', -70], ['504', '012', -30], ['231', '232', -70], ['862', '170', -30], ['643', '840', -15],
  ['643', '826', -20], ['643', '233', -20], ['643', '428', -20], ['643', '440', -20], ['616', '643', -15],
  ['643', '112', 30], ['643', '398', 25], ['643', '804', 10], ['643', '051', 30], ['156', '408', 30],
  ['156', '586', 40], ['643', '156', 20], ['643', '364', 10], ['643', '760', 20], ['643', '862', 20],
  ['840', '826', 30], ['840', '376', 40], ['840', '392', 25], ['840', '410', 25], ['840', '124', 30],
  ['840', '484', 10], ['250', '276', 20], ['682', '784', 20], ['729', '728', -40], ['364', '760', 40],
  ['364', '862', 25], ['192', '862', 40], ['840', '158', 20], ['840', '608', 15], ['792', '031', 40],
  ['643', '688', 30], ['300', '807', -30], ['706', 'X163', -60], ['156', 'X170', -20], ['643', 'X170', -40]
];
let opinionPairMap = null;
function opinionPairBase(a, b) {
  if (!opinionPairMap) {
    opinionPairMap = new Map();
    for (const [x, y, v] of OPINION_PAIRS) { opinionPairMap.set(`${x}>${y}`, v); opinionPairMap.set(`${y}>${x}`, v); }
  }
  return opinionPairMap.get(`${game.countries[a].iso}>${game.countries[b].iso}`) || 0;
}

// База отношения a к b: блоки, режимы, соседство, история (без событий)
function opinionBase(a, b) {
  const A = game.countries[a], B = game.countries[b];
  let v = opinionPairBase(a, b);
  const ab = A.blocs || [], bb = B.blocs || [];
  if (sharedMilBloc(a, b)) v += 35;
  let econ = 0, pol = 0;
  for (const id of ab) if (bb.includes(id)) { if (BLOC_DEFS[id].type === 'econ') econ += 12; else if (BLOC_DEFS[id].type === 'pol') pol += 5; }
  v += Math.min(20, econ) + Math.min(15, pol);
  if ((ab.includes('nato') && bb.includes('csto')) || (ab.includes('csto') && bb.includes('nato'))) v -= 20;
  const dem = (r) => r === 'dem', hard = (r) => ['auth', 'party', 'theo', 'junta'].includes(r);
  if (dem(A.regime) && dem(B.regime)) v += 10;
  else if ((dem(A.regime) && hard(B.regime)) || (hard(A.regime) && dem(B.regime))) v -= 10;
  if (geoNeighbors(a, b) && !sharedMilBloc(a, b) && v <= 10) v -= 5;
  return v;
}

function opKey(a, b) { return `${a}>${b}`; }
function getOpinion(a, b) {
  if (a === b) return 100;
  const d = game.opDelta ? (game.opDelta.get(opKey(a, b)) || 0) : 0;
  return Math.max(-100, Math.min(100, Math.round(opinionBase(a, b) + d)));
}
function opinionDelta(a, b) { return game.opDelta ? (game.opDelta.get(opKey(a, b)) || 0) : 0; }
function changeOpinion(a, b, dv) {
  if (!scenarioActive() || a === b || !dv) return;
  if (!game.opDelta) game.opDelta = new Map();
  const k = opKey(a, b);
  const v = Math.max(-150, Math.min(150, (game.opDelta.get(k) || 0) + dv));
  if (Math.abs(v) < 0.5) game.opDelta.delete(k); else game.opDelta.set(k, v);
}
function opinionLabel(v) {
  if (v >= 60) return { text: 'союзническое', cls: 'good' };
  if (v >= 25) return { text: 'дружественное', cls: 'good' };
  if (v > -15) return { text: 'нейтральное', cls: 'mid' };
  if (v > -50) return { text: 'прохладное', cls: 'bad' };
  return { text: 'враждебное', cls: 'bad' };
}

// Кто «друзья» и «противники» страны — для эха заявлений
function friendsOf(cid) {
  return game.countries.filter((o) => o.alive && o.id !== cid && (isAllied(o.id, cid) || getOpinion(o.id, cid) >= 40)).map((o) => o.id);
}
function rivalsOf(cid) {
  return game.countries.filter((o) => o.alive && o.id !== cid && getOpinion(o.id, cid) <= -35).map((o) => o.id);
}

// ---------------------------------------------------------------- ПУБЛИЧНЫЕ ЗАЯВЛЕНИЯ
// target — как изменится отношение адресата к автору; friends — друзей адресата; rivals — его противников;
// world — всех остальных (резкая риторика пугает нейтралов)
const STATEMENTS = {
  praise:  { icon: '👏', name: 'Поддержать, похвалить', target: 15, friends: 4, rivals: -6, world: 0, cost: 5,
             news: ['выразила поддержку', 'высоко оценила политику', 'назвала надёжным партнёром'] },
  coop:    { icon: '🤝', name: 'Призвать к сотрудничеству', target: 8, friends: 2, rivals: 0, world: 1, cost: 3,
             news: ['призвала к сотрудничеству с', 'предложила расширить связи с'] },
  concern: { icon: '😐', name: 'Выразить озабоченность', target: -8, friends: -2, rivals: 3, world: 0, cost: 3,
             news: ['выразила озабоченность действиями', 'призвала к сдержанности'] },
  condemn: { icon: '📢', name: 'Осудить', target: -22, friends: -8, rivals: 8, world: 0, cost: 6,
             news: ['осудила действия', 'резко раскритиковала', 'обвинила в нарушении международного права'] },
  threat:  { icon: '💢', name: 'Пригрозить', target: -45, friends: -15, rivals: 6, world: -4, cost: 10,
             news: ['пригрозила', 'предупредила о «серьёзных последствиях»', 'выдвинула жёсткие требования к'] }
};
const STATEMENT_COOLDOWN_DAYS = 30;

// Предварительный расчёт эффекта для окна выбора
function statementPreview(by, target, kind) {
  const s = STATEMENTS[kind];
  return { target: s.target, friends: friendsOf(target).filter((id) => id !== by).length, rivals: rivalsOf(target).filter((id) => id !== by).length, s };
}

function makeStatement(by, target, kind, silent) {
  const s = STATEMENTS[kind];
  const B = game.countries[by];
  changeOpinion(target, by, s.target);
  const fr = new Set(friendsOf(target)), rv = new Set(rivalsOf(target));
  for (const o of game.countries) {
    if (!o.alive || o.id === by || o.id === target) continue;
    if (fr.has(o.id)) changeOpinion(o.id, by, s.friends);
    else if (rv.has(o.id)) changeOpinion(o.id, by, s.rivals);
    else if (s.world) changeOpinion(o.id, by, s.world);
  }
  B.stmtCd = B.stmtCd || {};
  B.stmtCd[target] = (game.totalDays || 0) + STATEMENT_COOLDOWN_DAYS;
  const verb = s.news[Math.floor(Math.random() * s.news.length)];
  const T = game.countries[target];
  const cap = game.provinces[B.capitalProvId || B.provinces[0]];
  addNews(`${s.icon} ${B.flag} ${B.name} ${verb} ${T.flag} ${T.name}`, s.target < 0 ? 'war' : 'ally', cap?.cx ?? null, cap?.cy ?? null);
  if (target === game.playerId && !silent) pushToast(`${s.icon} ${B.flag} ${B.name} ${verb} вас`, s.target < 0 ? 'war' : 'good');
  // Угроза заставляет адресата насторожиться
  if (kind === 'threat') { T.grudge = T.grudge || {}; T.grudge[by] = (T.grudge[by] || 0) + 1; }
}

function statementCooldown(by, target) {
  const cd = game.countries[by].stmtCd;
  return cd && cd[target] ? Math.max(0, cd[target] - (game.totalDays || 0)) : 0;
}

// ---------------------------------------------------------------- РЕАКЦИЯ МИРА НА ВОЙНУ
function onWarDeclared(atk, def, joined) {
  if (!scenarioActive()) return;
  invalidateIncome(atk, def);
  cancelTrade(atk, def);
  unOnWar(atk, def, joined);
  if (joined) return;
  changeOpinion(def, atk, -60);
  for (const o of game.countries) {
    if (!o.alive || o.id === atk || o.id === def) continue;
    if (isAllied(o.id, def) || getOpinion(o.id, def) >= 40) changeOpinion(o.id, atk, -30);
    else if (!isAllied(o.id, atk)) changeOpinion(o.id, atk, -6);
  }
  // Крупные державы и соседи публично реагируют
  const speakers = game.countries.filter((o) => o.alive && o.id !== atk && o.id !== def &&
    ((o.blocs || []).includes('g8') || o.p5 || geoNeighbors(o.id, def) || isAllied(o.id, def) || isAllied(o.id, atk)));
  let said = 0;
  for (const o of speakers.sort(() => Math.random() - 0.5)) {
    if (said >= 4 || o.id === game.playerId) continue;
    const opA = getOpinion(o.id, atk), opD = getOpinion(o.id, def);
    if (opA >= 40 && opD < 0) { makeStatement(o.id, atk, 'praise', true); said++; }
    else if (opD > -10 && opA < 30) { makeStatement(o.id, atk, opA < -30 ? 'threat' : 'condemn', true); said++; }
  }
}

// ---------------------------------------------------------------- МЕСЯЧНЫЙ ХОД ГЕОЭКОНОМИКИ
function processGeoEconomyMonth() {
  if (!scenarioActive()) return;
  // 1. Рост ВВП и населения провинций
  for (const c of game.countries) {
    if (!c.alive) continue;
    refreshCountryEconomy(c);
    const g = growthRate(c).g, pg = popGrowth(c);
    for (const pid of c.provinces) {
      const p = game.provinces[pid];
      p.gdp = (p.gdp || 0) * (1 + g / 12);
      if (p.bld) for (const k in p.bld) p.bld[k].gdp *= 1 + g / 12;
      p.pop = (p.pop || 0) * (1 + pg / 12);
    }
    refreshCountryEconomy(c);
  }
  // 2. Затухание следа событий в отношениях (≈ полгода на половину)
  if (game.opDelta) for (const [k, v] of game.opDelta) {
    const nv = v * 0.89;
    if (Math.abs(nv) < 0.5) game.opDelta.delete(k); else game.opDelta.set(k, nv);
  }
  // 3. Торговля: война и вражда рвут соглашения, ИИ ищет новых партнёров
  if (game.trade) for (const k of [...game.trade]) {
    const [a, b] = k.split(':').map(Number);
    if (!game.countries[a].alive || !game.countries[b].alive) { game.trade.delete(k); continue; }
    for (const [x, y] of [[a, b], [b, a]]) {
      if (x === game.playerId) continue;
      if (getOpinion(x, y) < -40 && Math.random() < 0.3) {
        cancelTrade(x, y, x, 'отношения испортились');
        if (!game.tradeBlock) game.tradeBlock = new Map();
        game.tradeBlock.set(k, (game.totalDays || 0) + 180);
        break;
      }
    }
  }
  for (const c of game.countries) {
    if (!c.alive || c.id === game.playerId) continue;
    if (Math.random() < 0.12) aiSeekTrade(c);
    if (Math.random() < 0.015) aiRandomStatement(c);
  }
}

// ИИ оставляет свободное место под новые предложения (в том числе от игрока); на старте — два
function aiSeekTrade(c, force) {
  if (tradePartners(c.id).length >= tradeSlots(c) - (force ? 2 : 1)) return false;
  const cands = [];
  for (const o of game.countries) {
    if (!o.alive || o.id === c.id || hasTrade(c.id, o.id)) continue;
    if (!force && Math.random() > 0.35) continue;   // смотрим не весь мир каждый раз
    cands.push(o.id);
  }
  let best = null;
  for (const oid of cands) {
    const sc = tradeScore(c.id, oid);
    if (sc.score < TRADE_THRESHOLD) continue;
    const v = tradeValue(c.id, oid) * (1 + getOpinion(c.id, oid) / 100);
    if (!best || v > best.v) best = { oid, v, sc };
  }
  if (!best) return false;
  if (best.oid === game.playerId) {
    if (force || game.totalMonths < (c.offerUntil || 0)) return false;
    c.offerUntil = game.totalMonths + 6;
    offerToPlayer({
      kind: 'trade', fromId: c.id, why: reasonsText(best.sc.reasons, 2) + `<br><small>Ваш доход: +${Math.round(tradeValue(game.playerId, c.id))}💰 в месяц</small>`,
      onAccept: () => { if (tradePartners(game.playerId).length < tradeSlots(game.countries[game.playerId])) { signTrade(c.id, game.playerId); sfx.peace(); updateHud(); refreshDrawer(); } else pushToast('Нет свободных торговых соглашений: постройте порт.'); }
    });
    return false;
  }
  const other = game.countries[best.oid];
  if (tradePartners(best.oid).length >= tradeSlots(other) - (force ? 2 : 1)) return false;   // партнёр тоже держит место свободным
  if (tradeScore(best.oid, c.id).score >= TRADE_THRESHOLD) { signTrade(c.id, best.oid, force); return true; }
  return false;
}

function aiRandomStatement(c) {
  const others = game.countries.filter((o) => o.alive && o.id !== c.id && statementCooldown(c.id, o.id) === 0);
  if (!others.length) return;
  const o = others[Math.floor(Math.random() * others.length)];
  const op = getOpinion(c.id, o.id);
  if (op <= -50) makeStatement(c.id, o.id, Math.random() < 0.3 ? 'threat' : 'condemn');
  else if (op <= -20) makeStatement(c.id, o.id, 'concern');
  else if (op >= 45) makeStatement(c.id, o.id, 'praise');
}

// ИИ строит экономику (вместо прежнего «+1 к экономике»)
function aiBuild(c) {
  if (countryBuildQueue(c).length >= Math.min(2, maxConcurrentBuilds(c))) return false;
  if (Math.random() > 0.35 || c.money < taxIncome(c) * 2) return false;   // строит с запасом казны, не каждый раз
  const flow = countryResFlow(c.id);
  const weights = {
    factory: 3, agro: flow.net.food < 0 ? 3 : 0.6, oil: 3, port: countryPorts(c) < 2 ? 3 : 0.5,
    bank: gdpPerCapita(c) > 8000 ? 1.5 : 0.3, tech: gdpPerCapita(c) > 12000 ? 2 : 0.4, resort: (c.secShare?.tourism || 0) > 0.06 ? 2 : 0.5
  };
  const opts = [];
  for (const pid of c.provinces) {
    const p = game.provinces[pid];
    for (const t of BUILDING_KEYS) if (weights[t] > 0 && canBuild(c.id, p, t).ok) opts.push({ pid, t, w: weights[t] });
  }
  if (!opts.length) return false;
  let r = Math.random() * opts.reduce((s, o) => s + o.w, 0);
  for (const o of opts) { r -= o.w; if (r <= 0) return startBuild(c.id, o.pid, o.t); }
  return false;
}

// ---------------------------------------------------------------- ИНИЦИАЛИЗАЦИЯ СЦЕНАРИЯ
// Вызывается из applyScenario после того, как у стран есть ВВП, население, блоки и провинции
function initGeoEconomy(baseProv) {
  game.trade = new Set();
  game.opDelta = new Map();
  game.tradeBlock = new Map();
  for (const c of game.countries) {
    if (!c.alive || !c.provinces.length) continue;
    const provs = c.provinces.map((pid) => game.provinces[pid]);
    const w = provs.reduce((s, p) => s + baseProv[p.id].economy, 0) || 1;
    for (const p of provs) {
      const k = baseProv[p.id].economy / w;
      p.gdp = c.gdp * k;
      p.pop = c.pop * k;
      p.bld = null;
      p.bq = null;
    }
    c.secShare = baseSectorShares(c);
    c.stmtCd = {};
    c._incDay = -1;
  }
  // Стартовые торговые связи: каждая страна подписывает 1–2 выгодных соглашения
  const order = game.countries.filter((c) => c.alive && c.provinces.length).sort((a, b) => b.gdp - a.gdp);
  for (let round = 0; round < 2; round++) for (const c of order) aiSeekTrade(c, true);
}

// ---------------------------------------------------------------- ИНТЕРФЕЙС
function fmtMoney(v) { return `${v >= 0 ? '+' : '−'}${fmtNum(Math.abs(Math.round(v)))}💰`; }
function fmtPct(v, digits = 1) { return `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(digits).replace('.', ',')}%`; }

// Блок построек в панели своей провинции
function buildingsPanelHtml(p) {
  if (!scenarioActive()) return '';
  const cid = game.playerId;
  const have = BUILDING_KEYS.filter((t) => p.bld && p.bld[t]).map((t) => `<span class="bld-chip" title="${BUILDINGS[t].about}">${BUILDINGS[t].icon} ${BUILDINGS[t].name}${p.bld[t].n > 1 ? ' ×' + p.bld[t].n : ''}</span>`).join('');
  const q = p.bq ? `<div class="bld-progress"><span>${BUILDINGS[p.bq.type].icon} Строится: ${BUILDINGS[p.bq.type].name} — ещё ${p.bq.days} дн.</span><i style="width:${Math.round((1 - p.bq.days / p.bq.total) * 100)}%"></i></div>` : '';
  const c = game.countries[cid];
  const rows = BUILDING_KEYS.map((t) => {
    const d = BUILDINGS[t], chk = canBuild(cid, p, t), cost = buildCost(cid, t);
    const gain = buildGain(cid, t);
    const dInc = taxIncomeAt(c, (c.gdp || 1) + gain) - taxIncome(c);
    // скрываем то, что здесь невозможно в принципе (нет моря, нет нефти)
    if (!chk.ok && /моря|нефти/.test(chk.why)) return '';
    return `<button class="btn btn-sm bld-btn" data-bld="${t}" ${chk.ok ? '' : 'disabled'} title="${d.about}${chk.ok ? '' : ' — ' + chk.why}">
      <span class="bld-name">${d.icon} ${d.name}</span>
      <small>${chk.ok ? `+${fmtGdp(gain)} ВВП • ≈+${Math.round(dInc)}💰/мес • ${d.days} дн.` : chk.why}</small>
      <span class="cost-tag">${fmtNum(cost.money)}💰 ${cost.steel}🔩</span>
    </button>`;
  }).join('');
  return `
    <div>
      <div class="sec-title">🏗 Экономика провинции: ${fmtGdp(provGdp(p))} ВВП • участков ${provBuildCount(p)}/${provSlots(p)}</div>
      ${have ? `<div class="bld-chips">${have}</div>` : ''}
      ${q}
      <div class="bld-list">${rows}</div>
    </div>`;
}
function taxIncomeAt(c, g) { return 28 + (game.incK || 4.6) * Math.pow(Math.max(0.1, g), 0.65); }

function bindBuildingsPanel(root, p) {
  root.querySelectorAll('.bld-btn').forEach((b) => {
    b.onclick = () => {
      if (startBuild(game.playerId, p.id, b.dataset.bld)) {
        sfx.build();
        pushToast(`${BUILDINGS[b.dataset.bld].icon} Стройка началась: ${BUILDINGS[b.dataset.bld].name}, ${p.name}`, 'good');
        updateHud(); refreshDrawer();
      }
    };
  });
}

// Блок отношений и кнопок торговли/заявлений в панели чужой страны
function foreignEconomyHtml(tid) {
  if (!scenarioActive()) return '';
  const pid = game.playerId, c = game.countries[tid], me = game.countries[pid];
  const op = getOpinion(tid, pid), lab = opinionLabel(op), ev = Math.round(opinionDelta(tid, pid));
  const trading = hasTrade(pid, tid);
  const ts = trading ? null : tradeScore(tid, pid);
  const att = ts ? attitudeLabel(ts.score, TRADE_THRESHOLD) : null;
  const myFree = tradeSlots(me) - tradePartners(pid).length;
  const cd = statementCooldown(pid, tid);
  return `
    <div class="dip-box">
      <span class="att ${lab.cls}">Отношение к вам: ${op > 0 ? '+' : ''}${op} — ${lab.text}${ev ? ` <small style="display:inline">(события: ${ev > 0 ? '+' : ''}${ev})</small>` : ''}</span>
      <small>${c.name} экспортирует ${EXPORT_LABEL[mainExport(c)]}.${trading ? ` Торговля даёт вам ${fmtMoney(tradeValue(pid, tid))} в месяц.` : ` Торговля дала бы вам ${fmtMoney(tradeValue(pid, tid))} в месяц.`}</small>
      ${ts && !trading ? `<small><span class="att ${att.cls}" style="font-size:11px">Торговля: ${att.text}</span><br>${reasonsText(ts.reasons, 3)}</small>` : ''}
    </div>
    <div class="btn-row-2">
      ${trading
        ? `<button class="btn btn-sm" id="btn-trade-cancel">✂️ Эмбарго</button>`
        : `<button class="btn btn-sm btn-sky" id="btn-trade" ${myFree > 0 && !isAtWar(pid, tid) ? '' : 'disabled'} title="${myFree > 0 ? '' : 'Нет свободных соглашений: постройте порт'}">📦 Торговое соглашение</button>`}
      <button class="btn btn-sm" id="btn-statement" ${cd ? 'disabled' : ''}>📢 Заявление${cd ? ` (${cd} дн.)` : ''}</button>
    </div>`;
}

function bindForeignEconomy(tid) {
  if (!scenarioActive()) return;
  const pid = game.playerId, c = game.countries[tid];
  const bT = document.getElementById('btn-trade');
  if (bT) bT.onclick = () => {
    const res = tradeScore(tid, pid);
    if (res.score >= TRADE_THRESHOLD) {
      signTrade(pid, tid); sfx.peace();
      showInfoModal('📦 Торговое соглашение подписано', `${c.flag} <strong>${c.name}</strong> согласна:<br><small>${reasonsText(res.reasons.filter((r) => r.v > 0), 3)}</small><br><small>Ваш доход: ${fmtMoney(tradeValue(pid, tid))} в месяц.</small>`);
    } else {
      showInfoModal('Торговое соглашение отклонено', `${c.flag} <strong>${c.name}</strong> отказывается:<br><small>${reasonsText(res.reasons.filter((r) => r.v < 0), 3)}</small><br><small style="color:#94a3b8;">Отношение можно улучшить заявлениями (📢) и союзами.</small>`);
    }
    updateHud(); refreshDrawer();
  };
  const bC = document.getElementById('btn-trade-cancel');
  if (bC) bC.onclick = () => showModal('Ввести эмбарго?',
    `Торговля с ${c.flag} <strong>${c.name}</strong> прекратится, вы потеряете ${fmtMoney(tradeValue(pid, tid))} в месяц. Отношение ${c.name} к вам −15, новое соглашение — не раньше чем через полгода.`,
    '✂️ Эмбарго', 'btn-crimson', () => {
      cancelTrade(pid, tid, pid, 'эмбарго');
      if (!game.tradeBlock) game.tradeBlock = new Map();
      game.tradeBlock.set(tradeKey(pid, tid), (game.totalDays || 0) + 180);
      updateHud(); refreshDrawer();
    });
  const bS = document.getElementById('btn-statement');
  if (bS) bS.onclick = () => showStatementModal(tid);
}

function showStatementModal(tid) {
  const pid = game.playerId, c = game.countries[tid], me = game.countries[pid];
  const fr = friendsOf(tid).filter((id) => id !== pid).length, rv = rivalsOf(tid).filter((id) => id !== pid).length;
  const rows = Object.entries(STATEMENTS).map(([k, s]) => `
    <button class="btn stmt-btn" data-k="${k}" ${me.diplo < s.cost ? 'disabled' : ''}>
      <span>${s.icon} ${s.name}</span>
      <small>${c.name}: ${s.target > 0 ? '+' : ''}${s.target}${fr && s.friends ? ` • её друзья (${fr}): ${s.friends > 0 ? '+' : ''}${s.friends}` : ''}${rv && s.rivals ? ` • её противники (${rv}): ${s.rivals > 0 ? '+' : ''}${s.rivals}` : ''}${s.world ? ` • весь мир: ${s.world}` : ''}</small>
      <span class="cost-tag">${s.cost} 🏛️</span>
    </button>`).join('');
  modalBox.innerHTML = `
    <div class="modal-title">📢 Заявление о ${c.flag} ${c.name}</div>
    <div class="modal-body modal-scroll" style="display:flex;flex-direction:column;gap:6px;">
      <small style="color:var(--muted)">Сейчас ${c.name} относится к вам: ${getOpinion(tid, pid) > 0 ? '+' : ''}${getOpinion(tid, pid)}. Заявление меняет отношение адресата, его друзей и противников; след событий постепенно забывается. Следующее заявление о той же стране — через ${STATEMENT_COOLDOWN_DAYS} дней.</small>
      ${rows}
    </div>
    <div class="modal-actions"><button class="btn" id="m-cancel">Отмена</button></div>`;
  modalBackdrop.classList.add('visible');
  document.getElementById('m-cancel').onclick = closeModal;
  modalBox.querySelectorAll('.stmt-btn').forEach((b) => {
    b.onclick = () => {
      const s = STATEMENTS[b.dataset.k];
      if (me.diplo < s.cost) return;
      me.diplo -= s.cost;
      closeModal();
      makeStatement(pid, tid, b.dataset.k);
      sfx.click();
      updateHud(); refreshDrawer();
    };
  });
}

// Вкладки окна «Государство»: экономика и торговля
function stateEconomyHtml(c) {
  const inc = incomeBreakdown(c);
  const gr = growthRate(c);
  const sec = sectorGdp(c);
  const total = SECTOR_KEYS.reduce((s, k) => s + sec[k], 0) || 1;
  const bars = SECTOR_KEYS.map((k) => {
    const sh = sec[k] / total;
    return `<div class="sec-bar"><span>${SECTORS[k].icon} ${SECTORS[k].name}</span><b>${fmtGdp(sec[k])} • ${Math.round(sh * 100)}%</b><i style="width:${Math.max(1, Math.round(sh * 100))}%;background:${SECTORS[k].color}"></i></div>`;
  }).join('');
  const blds = BUILDING_KEYS.map((t) => { const n = countryBuildCount(c, t); return n ? `<span class="bld-chip">${BUILDINGS[t].icon} ${BUILDINGS[t].name} ×${n}</span>` : ''; }).join('');
  const queue = countryBuildQueue(c).map((p) => `<span class="bld-chip">${BUILDINGS[p.bq.type].icon} ${p.name}: ${p.bq.days} дн.</span>`).join('');
  return `
    <div class="facts-grid">
      <div><span>Рост ВВП</span><strong style="color:${gr.g >= 0 ? '#34d399' : '#f87171'}">${fmtPct(gr.g)} в год</strong></div>
      <div><span>Доход казны</span><strong>${fmtMoney(inc.total)}/мес</strong></div>
      <div><span>Экспорт</span><strong>${EXPORT_LABEL[mainExport(c)]}</strong></div>
    </div>
    <small style="color:var(--muted)">Доход: налоги ${fmtMoney(inc.tax)}, торговые соглашения ${fmtMoney(inc.trade)}, общие рынки блоков ${fmtMoney(inc.bloc)}. Рост: ${gr.reasons.map((r) => `${r.t} ${fmtPct(r.v)}`).join(', ')}.</small>
    <div class="modal-sub-title">Секторы экономики</div>
    ${bars}
    <div class="modal-sub-title">Постройки</div>
    <div class="bld-chips">${blds || '<small style="color:var(--muted)">Пока нет. Стройте в своих провинциях: нажмите на провинцию → «Экономика провинции».</small>'}</div>
    ${queue ? `<small style="color:var(--muted)">Строится (${countryBuildQueue(c).length}/${maxConcurrentBuilds(c)}):</small><div class="bld-chips">${queue}</div>` : ''}`;
}

function stateTradeHtml(c) {
  const inc = incomeBreakdown(c);
  const used = inc.partners.length, slots = tradeSlots(c);
  const rows = inc.partners.sort((a, b) => b.v - a.v).map(({ id, v }) => {
    const o = game.countries[id];
    return `<div class="trade-row"><span>${o.flag} ${o.name}</span><small>${EXPORT_LABEL[mainExport(o)]}</small><b>${fmtMoney(v)}</b></div>`;
  }).join('') || '<small style="color:var(--muted)">Торговых соглашений нет.</small>';
  // Кандидаты: кто согласится и сколько даст
  const cands = game.countries.filter((o) => o.alive && o.id !== c.id && !hasTrade(c.id, o.id))
    .map((o) => ({ o, v: tradeValue(c.id, o.id), s: tradeScore(o.id, c.id) }))
    .filter((x) => !x.s.blocked).sort((a, b) => b.v * (b.s.score >= TRADE_THRESHOLD ? 2 : 1) - a.v * (a.s.score >= TRADE_THRESHOLD ? 2 : 1)).slice(0, 6);
  const candRows = cands.map(({ o, v, s }) => {
    const a = attitudeLabel(s.score, TRADE_THRESHOLD);
    return `<div class="trade-row"><span>${o.flag} ${o.name}</span><small class="att ${a.cls}">${a.text}</small><b>${fmtMoney(v)}</b><button class="btn btn-sm" data-trade="${o.id}" ${used < slots ? '' : 'disabled'}>📦</button></div>`;
  }).join('');
  const blocs = (c.blocs || []).filter((b) => BLOC_TRADE_BONUS[b] || b === 'opec').map((b) => BLOC_DEFS[b].name);
  return `
    <small style="color:var(--muted)">Соглашений: ${used} из ${slots} (каждый порт ⚓ даёт ещё одно). Доход от торговли зависит от размера экономик, расстояния, портов, финансовых центров и отношения партнёра к вам.</small>
    <div class="modal-sub-title">Партнёры</div>
    ${rows}
    ${blocs.length ? `<small style="color:var(--muted)">Общие рынки: ${blocs.join(', ')} — ${fmtMoney(inc.bloc)} в месяц без отдельных соглашений.</small>` : ''}
    <div class="modal-sub-title">Можно предложить</div>
    ${candRows || '<small style="color:var(--muted)">Нет подходящих стран.</small>'}`;
}

function bindStateTrade(c) {
  modalBox.querySelectorAll('[data-trade]').forEach((b) => {
    b.onclick = () => {
      const tid = Number(b.dataset.trade);
      const res = tradeScore(tid, c.id);
      const o = game.countries[tid];
      if (res.score >= TRADE_THRESHOLD) {
        signTrade(c.id, tid); sfx.peace();
        pushToast(`📦 Торговое соглашение с ${o.flag} ${o.name}: ${fmtMoney(tradeValue(c.id, tid))} в месяц`, 'good');
      } else {
        pushToast(`${o.flag} ${o.name} отказывается: ${res.reasons.filter((r) => r.v < 0).slice(0, 2).map((r) => r.t).join(', ')}`, 'war');
      }
      updateHud();
      showStateModal('trade');
    };
  });
}

// Цвет карты «Отношения»: как страны относятся к вам (или к выбранной стране)
function opinionMapColor(cid) {
  const ref = game.playerId !== null ? game.playerId : game.selectedCountryId;
  if (ref === null || ref === undefined) return '#3f4f63';
  if (cid === ref) return '#12a86c';
  const v = getOpinion(cid, ref);
  if (v >= 0) {
    const k = Math.min(1, v / 70);
    return `rgb(${Math.round(62 - k * 22)},${Math.round(74 + k * 110)},${Math.round(92 + k * 10)})`;
  }
  const k = Math.min(1, -v / 70);
  return `rgb(${Math.round(62 + k * 168)},${Math.round(74 - k * 30)},${Math.round(92 - k * 40)})`;
}
