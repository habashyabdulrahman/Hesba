const STORAGE_KEY = 'hesabaty-demo-v4';
const LEGACY_ROWS_KEY = 'habash-money-v1';
const LEGACY_OPENING_KEY = 'habash-money-opening-v1';
const q = (selector, root = document) => root.querySelector(selector);
const qa = (selector, root = document) => [...root.querySelectorAll(selector)];
const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
const round = value => Math.round(Number(value) * 100) / 100;
const money = value => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) || 0);
const number = (value, digits = 2) => new Intl.NumberFormat('en-GB', { maximumFractionDigits: digits }).format(Number(value) || 0);
const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const currentMonth = () => today().slice(0, 7);
const formatDate = value => new Intl.DateTimeFormat('ar-EG-u-nu-latn', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${value}T12:00:00`));
const validAmount = value => Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) <= 1e10;
const normalize = value => String(value || '').trim().toLocaleLowerCase('ar');

function emptyState() {
  return {
    version: 4,
    opening: { cash: 0, bank: 0 },
    transactions: [],
    workEntries: [],
    debts: [],
    rates: { eurToUsd: 0, eurToEgp: 0, goldUsdOz: 0, updatedAt: '', source: '' }
  };
}

function migrateLegacy() {
  const state = emptyState();
  try {
    const opening = JSON.parse(localStorage.getItem(LEGACY_OPENING_KEY) || '{}');
    if (Number.isFinite(opening.cash) && Number.isFinite(opening.bank)) state.opening = { cash: opening.cash, bank: opening.bank };
  } catch {}
  try {
    const rows = JSON.parse(localStorage.getItem(LEGACY_ROWS_KEY) || '[]');
    if (Array.isArray(rows)) {
      state.transactions = rows.map(row => {
        if (row.type === 'transfer') return { id: row.id || uid(), type: 'internal_transfer', amount: row.amount, from: row.from || 'cash', date: row.date, note: row.note || '', created: row.created || Date.now() };
        return { id: row.id || uid(), type: row.type, amount: row.amount, account: row.account || 'cash', date: row.date, category: row.category || (row.type === 'income' ? 'دخل سابق' : 'أخرى'), incomeKind: row.type === 'income' ? 'other' : undefined, source: '', note: row.note || '', created: row.created || Date.now() };
      }).filter(row => ['income', 'expense', 'internal_transfer'].includes(row.type) && validAmount(row.amount) && row.date);
    }
  } catch {}
  return state;
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved && saved.version === 4) return { ...emptyState(), ...saved, opening: { ...emptyState().opening, ...saved.opening }, rates: { ...emptyState().rates, ...saved.rates } };
  } catch {}
  const migrated = migrateLegacy();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
  return migrated;
}

let state = loadState();
let pendingDelete = null;
let toastTimer;

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
function toast(message) {
  const el = q('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}
function openDialog(id) {
  const dialog = q(`#${id}`);
  if (dialog && !dialog.open) dialog.showModal();
}
function closeDialog(dialog) {
  if (dialog?.open) dialog.close();
}
function selectedMonthRows(type) {
  const month = q('#month').value;
  return state.transactions.filter(item => item.type === type && item.date?.startsWith(month));
}
function accountLabel(account) {
  return account === 'bank' ? 'حساب البنك' : 'كاش';
}
function timingLabel(value) {
  return ({ month: 'حساب شهري', day: 'قبض آخر اليوم', finish: 'الدفع عند الانتهاء', custom: 'حسب الاتفاق' })[value] || 'حسب الاتفاق';
}
function debtKindLabel(kind) {
  return ({ EUR: 'يورو', USD: 'دولار', EGP: 'جنيه مصري', GOLD21: 'ذهب عيار 21' })[kind] || kind;
}
function debtUnit(kind) {
  return ({ EUR: 'EUR', USD: 'USD', EGP: 'EGP', GOLD21: 'جرام' })[kind] || '';
}
function gold21EgpGram() {
  const { eurToUsd, eurToEgp, goldUsdOz } = state.rates;
  if (!eurToUsd || !eurToEgp || !goldUsdOz) return 0;
  const usdToEgp = eurToEgp / eurToUsd;
  return (goldUsdOz / 31.1034768) * (21 / 24) * usdToEgp;
}
function debtPaidUnits(debtId) {
  return state.transactions.filter(item => item.type === 'debt_payment' && item.debtId === debtId).reduce((sum, item) => sum + Number(item.unitsPaid || 0), 0);
}
function debtRemaining(debt) {
  return Math.max(0, Number(debt.originalAmount) - debtPaidUnits(debt.id));
}
function debtValueEur(debt) {
  const remaining = debtRemaining(debt);
  if (debt.kind === 'EUR') return remaining;
  if (debt.kind === 'USD') return state.rates.eurToUsd ? remaining / state.rates.eurToUsd : 0;
  if (debt.kind === 'EGP') return state.rates.eurToEgp ? remaining / state.rates.eurToEgp : 0;
  if (debt.kind === 'GOLD21') return state.rates.eurToEgp ? remaining * gold21EgpGram() / state.rates.eurToEgp : 0;
  return 0;
}
function accountBalances() {
  const balances = { cash: Number(state.opening.cash) || 0, bank: Number(state.opening.bank) || 0 };
  for (const item of state.transactions.filter(item => item.date <= today())) {
    const account = item.account === 'bank' ? 'bank' : 'cash';
    if (item.type === 'income') balances[account] += Number(item.amount);
    if (item.type === 'expense') balances[account] -= Number(item.amount);
    if (item.type === 'family_transfer') balances[account] -= Number(item.amount) + Number(item.fee || 0);
    if (item.type === 'debt_payment') balances[account] -= Number(item.eurCost) + Number(item.fee || 0);
    if (item.type === 'internal_transfer') {
      const from = item.from === 'bank' ? 'bank' : 'cash';
      const to = from === 'bank' ? 'cash' : 'bank';
      balances[from] -= Number(item.amount);
      balances[to] += Number(item.amount);
    }
  }
  return balances;
}
function allReceivables() {
  const earned = state.workEntries.reduce((sum, item) => sum + Number(item.earned || 0), 0);
  const received = state.transactions.filter(item => item.type === 'income' && item.incomeKind === 'work').reduce((sum, item) => sum + Number(item.amount), 0);
  return Math.max(0, earned - received);
}

function renderHome() {
  const month = q('#month').value;
  const balances = accountBalances();
  q('#cash-balance').textContent = money(balances.cash);
  q('#bank-balance').textContent = money(balances.bank);
  q('#total-balance').textContent = money(balances.cash + balances.bank);

  const received = selectedMonthRows('income').reduce((sum, item) => sum + Number(item.amount), 0);
  const expenses = selectedMonthRows('expense');
  const living = expenses.reduce((sum, item) => sum + Number(item.amount), 0);
  const familyRows = selectedMonthRows('family_transfer');
  const family = familyRows.reduce((sum, item) => sum + Number(item.amount), 0);
  const debtRows = selectedMonthRows('debt_payment');
  const debtPaid = debtRows.reduce((sum, item) => sum + Number(item.eurCost), 0);
  const fees = [...familyRows, ...debtRows].reduce((sum, item) => sum + Number(item.fee || 0), 0);
  const net = received - living - family - debtPaid - fees;
  q('#received-income').textContent = money(received);
  q('#living-expenses').textContent = money(living);
  q('#debt-paid-month').textContent = money(debtPaid);
  q('#family-month').textContent = money(family);
  q('#month-net').textContent = money(net);
  q('#month-net').style.color = net < 0 ? '#ad5938' : '#177064';
  q('#month-net-note').textContent = fees ? `يشمل ${money(fees)} رسوم تحويل` : 'الدخل ناقص كل الأموال الخارجة';
  const needsRates = state.debts.some(debt => debt.kind !== 'EUR') && (!state.rates.eurToUsd || !state.rates.eurToEgp || !state.rates.goldUsdOz);
  q('#debt-total').textContent = needsRates ? 'حدّث الأسعار' : money(state.debts.reduce((sum, debt) => sum + debtValueEur(debt), 0));

  const work = state.workEntries.filter(item => item.date?.startsWith(month));
  q('#work-days').textContent = number(work.reduce((sum, item) => sum + Number(item.days || 1), 0), 0);
  q('#earned-month').textContent = money(work.reduce((sum, item) => sum + Number(item.earned), 0));
  q('#receivables').textContent = money(allReceivables());
  q('#expense-count').textContent = `${expenses.length} حركة`;
  renderCategoryChart(expenses);
  renderRates();
}

function renderCategoryChart(expenses) {
  const chart = q('#category-chart');
  chart.replaceChildren();
  if (!expenses.length) {
    const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'سجّل مصروفاتك لتظهر الإحصائيات هنا.'; chart.append(empty); return;
  }
  const totals = {};
  expenses.forEach(item => totals[item.category || 'أخرى'] = (totals[item.category || 'أخرى'] || 0) + Number(item.amount));
  const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const max = entries[0][1];
  entries.forEach(([category, value]) => {
    const row = document.createElement('div'); row.className = 'chart-row';
    const name = document.createElement('span'); name.textContent = category;
    const track = document.createElement('div'); track.className = 'chart-track';
    const fill = document.createElement('span'); fill.className = 'chart-fill'; fill.style.width = `${Math.max(4, value / max * 100)}%`; track.append(fill);
    const amount = document.createElement('b'); amount.textContent = money(value);
    row.append(name, track, amount); chart.append(row);
  });
}

function renderRates() {
  const { eurToUsd, eurToEgp, updatedAt, source } = state.rates;
  q('#usd-rate').textContent = eurToUsd ? `${number(eurToUsd, 4)} USD` : '— USD';
  q('#egp-rate').textContent = eurToEgp ? `${number(eurToEgp, 4)} EGP` : '— EGP';
  q('#gold-rate').textContent = gold21EgpGram() ? `${number(gold21EgpGram(), 2)} EGP` : '— EGP';
  q('#rates-updated').textContent = updatedAt ? `آخر تحديث: ${new Intl.DateTimeFormat('ar-EG-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(updatedAt))}${source === 'manual' ? ' · يدوي' : ''}` : 'لم يتم التحديث';
}

function sourceNames() {
  return [...new Set([...state.workEntries.map(item => item.source), ...state.transactions.filter(item => item.type === 'income').map(item => item.source)].filter(Boolean))].sort();
}
function renderSourceOptions() {
  const list = q('#source-options'); list.replaceChildren();
  sourceNames().forEach(name => { const option = document.createElement('option'); option.value = name; list.append(option); });
}

function activityRow(item, context) {
  const row = document.createElement('div'); row.className = 'activity-row';
  const icon = document.createElement('span'); icon.className = 'activity-icon';
  const main = document.createElement('div'); main.className = 'activity-main';
  const title = document.createElement('b'); const meta = document.createElement('small');
  const value = document.createElement('span'); value.className = 'activity-value';
  let id = item.id; let collection = context;
  if (context === 'work') {
    icon.textContent = '✓'; title.textContent = item.source; meta.textContent = `${formatDate(item.date)} · ${item.days} يوم · ${timingLabel(item.timing)}`; value.textContent = money(item.earned); value.classList.add('positive');
  } else if (item.type === 'income') {
    icon.textContent = '＋'; title.textContent = item.source || item.note || 'دخل آخر'; meta.textContent = `${formatDate(item.date)} · ${accountLabel(item.account)}`; value.textContent = `+${money(item.amount)}`; value.classList.add('positive');
  } else if (item.type === 'expense') {
    icon.textContent = '−'; title.textContent = item.note || item.category; meta.textContent = `${item.category} · ${formatDate(item.date)} · ${accountLabel(item.account)}`; value.textContent = `−${money(item.amount)}`; value.classList.add('negative');
  } else if (item.type === 'internal_transfer') {
    icon.textContent = '⇄'; const to = item.from === 'bank' ? 'كاش' : 'حساب البنك'; title.textContent = item.note || 'تحويل داخلي'; meta.textContent = `${accountLabel(item.from)} ← ${to} · ${formatDate(item.date)}`; value.textContent = money(item.amount);
  } else if (item.type === 'family_transfer') {
    icon.textContent = '⌂'; title.textContent = item.recipient || 'تحويل للعائلة'; meta.textContent = `${item.method || 'تحويل عائلي'} · ${formatDate(item.date)}${item.receivedEgp ? ` · وصل ${number(item.receivedEgp)} EGP` : ''}`; value.textContent = `−${money(Number(item.amount) + Number(item.fee || 0))}`; value.classList.add('negative');
  } else if (item.type === 'debt_payment') {
    icon.textContent = '✓'; const debt = state.debts.find(entry => entry.id === item.debtId); title.textContent = debt ? `سداد: ${debt.name}` : 'سداد دين'; meta.textContent = `${number(item.unitsPaid)} ${debtUnit(debt?.kind)} · ${formatDate(item.date)}`; value.textContent = `−${money(Number(item.eurCost) + Number(item.fee || 0))}`; value.classList.add('negative');
  }
  main.append(title, meta);
  const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'delete-row'; remove.textContent = '×'; remove.setAttribute('aria-label', 'حذف'); remove.addEventListener('click', () => requestDelete(collection, id));
  row.append(icon, main, value, remove); return row;
}

function renderTransactions() {
  const month = q('#transaction-month').value;
  const filter = q('#transaction-filter').value;
  let items = [];
  if (filter === 'all' || filter === 'work') items.push(...state.workEntries.filter(item => item.date.startsWith(month)).map(item => ({ ...item, _context: 'work' })));
  if (filter === 'all' || filter === 'income') items.push(...state.transactions.filter(item => item.type === 'income' && item.date.startsWith(month)).map(item => ({ ...item, _context: 'transaction' })));
  if (filter === 'all' || filter === 'expense') items.push(...state.transactions.filter(item => item.type === 'expense' && item.date.startsWith(month)).map(item => ({ ...item, _context: 'transaction' })));
  items.sort((a, b) => b.date.localeCompare(a.date) || Number(b.created || 0) - Number(a.created || 0));
  q('#transaction-count').textContent = `${items.length} حركة`;
  const list = q('#transaction-list'); list.replaceChildren();
  if (!items.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'لا توجد حركات في هذا الشهر.'; list.append(empty); return; }
  items.forEach(item => list.append(activityRow(item, item._context)));
}
function renderTransfers() {
  const items = state.transactions.filter(item => ['internal_transfer', 'family_transfer', 'debt_payment'].includes(item.type)).sort((a, b) => b.date.localeCompare(a.date) || Number(b.created || 0) - Number(a.created || 0));
  q('#transfer-count').textContent = `${items.length} حركة`;
  const list = q('#transfer-list'); list.replaceChildren();
  if (!items.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'لم تسجّل تحويلات أو سداد ديون بعد.'; list.append(empty); return; }
  items.forEach(item => list.append(activityRow(item, 'transaction')));
}
function renderDebts() {
  const list = q('#debt-list'); list.replaceChildren();
  if (!state.debts.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'أضف كل دين بعملته الأصلية أو بعدد جرامات الذهب.'; list.append(empty); }
  state.debts.forEach(debt => {
    const item = document.createElement('div'); item.className = 'debt-item';
    const info = document.createElement('span'); const name = document.createElement('b'); name.textContent = debt.name; const detail = document.createElement('small'); detail.textContent = `${debtKindLabel(debt.kind)} · متبقي ${number(debtRemaining(debt), 3)} ${debtUnit(debt.kind)}`; info.append(name, detail);
    const value = document.createElement('strong'); value.textContent = debtValueEur(debt) ? money(debtValueEur(debt)) : debt.kind === 'EUR' ? money(debtRemaining(debt)) : 'بانتظار الأسعار';
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'mini-delete'; remove.textContent = '×'; remove.setAttribute('aria-label', `حذف ${debt.name}`); remove.onclick = () => { if (confirm(`حذف دَين ${debt.name} وكل دفعاته؟`)) { state.debts = state.debts.filter(entry => entry.id !== debt.id); state.transactions = state.transactions.filter(entry => entry.debtId !== debt.id); save(); renderAll(); } };
    item.append(info, value, remove); list.append(item);
  });
  renderDebtOptions();
}
function renderDebtOptions() {
  const select = q('#payment-debt'); const previous = select.value; select.replaceChildren();
  const active = state.debts.filter(debt => debtRemaining(debt) > 0);
  active.forEach(debt => { const option = document.createElement('option'); option.value = debt.id; option.textContent = `${debt.name} · ${number(debtRemaining(debt), 3)} ${debtUnit(debt.kind)}`; select.append(option); });
  if (active.some(debt => debt.id === previous)) select.value = previous;
  q('#no-debt-message').hidden = active.length > 0; q('#payment-fields').hidden = active.length === 0;
  updatePaymentFields();
}
function updatePaymentFields() {
  const debt = state.debts.find(item => item.id === q('#payment-debt').value);
  const gold = debt?.kind === 'GOLD21';
  q('#gold-payment-fields').hidden = !gold;
  q('#paid-units-label').firstChild.textContent = gold ? 'عدد جرامات عيار 21 التي تم تسليمها' : `المبلغ الذي تم خصمه من الدين (${debtUnit(debt?.kind)})`;
}
function renderAll() {
  renderHome(); renderSourceOptions(); renderTransactions(); renderTransfers(); renderDebts();
}

function requestDelete(collection, id) {
  pendingDelete = { collection, id };
  openDialog('confirm-dialog');
}
q('#confirm-dialog').addEventListener('close', event => {
  if (event.target.returnValue === 'delete' && pendingDelete) {
    if (pendingDelete.collection === 'work') state.workEntries = state.workEntries.filter(item => item.id !== pendingDelete.id);
    else state.transactions = state.transactions.filter(item => item.id !== pendingDelete.id);
    save(); renderAll(); toast('تم الحذف');
  }
  pendingDelete = null;
});

function navigate(page) {
  const target = ['home', 'transactions', 'transfers'].includes(page) ? page : 'home';
  qa('.page').forEach(section => section.classList.toggle('active', section.dataset.page === target));
  qa('.bottom-nav button').forEach(button => button.classList.toggle('active', button.dataset.target === target));
  q('#page-subtitle').textContent = ({ home: 'ملخص فلوسك', transactions: 'العمل والدخل والمصروف', transfers: 'التحويلات وسداد الديون' })[target];
  if (location.hash !== `#${target}`) history.replaceState(null, '', `#${target}`);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
qa('.bottom-nav button').forEach(button => button.addEventListener('click', () => navigate(button.dataset.target)));
q('.go-transactions').onclick = () => navigate('transactions');
window.addEventListener('hashchange', () => navigate(location.hash.slice(1)));
qa('[data-dialog]').forEach(button => button.addEventListener('click', () => openDialog(button.dataset.dialog)));
qa('.close-dialog').forEach(button => button.addEventListener('click', () => closeDialog(button.closest('dialog'))));
qa('dialog').forEach(dialog => dialog.addEventListener('click', event => { if (event.target === dialog) closeDialog(dialog); }));

q('#edit-opening').onclick = () => { q('#opening-cash').value = state.opening.cash; q('#opening-bank').value = state.opening.bank; openDialog('opening-dialog'); };
q('#opening-form').addEventListener('submit', event => { event.preventDefault(); state.opening = { cash: round(q('#opening-cash').value), bank: round(q('#opening-bank').value) }; save(); closeDialog(q('#opening-dialog')); renderAll(); toast('تم حفظ رصيد البداية'); });

qa('input[name="workMode"]').forEach(input => input.addEventListener('change', () => { const project = q('input[name="workMode"]:checked').value === 'project'; q('#work-amount-label').firstChild.textContent = project ? 'المبلغ المتفق عليه للمشروع (€)' : 'اليومية (€)'; q('#work-amount').placeholder = project ? '450' : '80'; }));
q('#work-form').addEventListener('submit', event => {
  event.preventDefault(); const mode = q('input[name="workMode"]:checked').value; const amount = Number(q('#work-amount').value); const days = Number(q('#work-days-input').value); const source = q('#work-source').value.trim();
  if (!source || !validAmount(amount) || !Number.isInteger(days) || days < 1) return;
  state.workEntries.push({ id: uid(), mode, source, date: q('#work-date').value, days, amount: round(amount), earned: round(mode === 'daily' ? amount * days : amount), timing: q('#work-timing').value, note: q('#work-note').value.trim(), created: Date.now() });
  save(); event.target.reset(); q('#work-date').value = today(); q('#work-days-input').value = 1; closeDialog(q('#work-dialog')); renderAll(); toast('تم تسجيل الشغل');
});
q('#income-kind').addEventListener('change', () => { const work = q('#income-kind').value === 'work'; q('#income-source-wrap').hidden = !work; q('#income-source').required = work; });
q('#income-form').addEventListener('submit', event => {
  event.preventDefault(); const amount = Number(q('#income-amount').value); const kind = q('#income-kind').value; const source = q('#income-source').value.trim(); if (!validAmount(amount) || (kind === 'work' && !source)) return;
  state.transactions.push({ id: uid(), type: 'income', incomeKind: kind, source: kind === 'work' ? source : '', amount: round(amount), account: q('#income-account').value, date: q('#income-date').value, note: q('#income-note').value.trim(), created: Date.now() });
  save(); event.target.reset(); q('#income-date').value = today(); q('#income-kind').dispatchEvent(new Event('change')); closeDialog(q('#income-dialog')); renderAll(); toast('تم تسجيل المبلغ');
});
q('#expense-form').addEventListener('submit', event => {
  event.preventDefault(); const amount = Number(q('#expense-amount').value); if (!validAmount(amount)) return;
  state.transactions.push({ id: uid(), type: 'expense', amount: round(amount), account: q('#expense-account').value, date: q('#expense-date').value, category: q('#expense-category').value, note: q('#expense-note').value.trim(), created: Date.now() });
  save(); event.target.reset(); q('#expense-date').value = today(); closeDialog(q('#expense-dialog')); renderAll(); toast('تم تسجيل المصروف');
});
q('#internal-form').addEventListener('submit', event => {
  event.preventDefault(); const amount = Number(q('#internal-amount').value); if (!validAmount(amount)) return;
  state.transactions.push({ id: uid(), type: 'internal_transfer', amount: round(amount), from: q('#internal-from').value, date: q('#internal-date').value, note: q('#internal-note').value.trim(), created: Date.now() });
  save(); event.target.reset(); q('#internal-date').value = today(); closeDialog(q('#internal-dialog')); renderAll(); toast('تم تسجيل التحويل');
});
q('#family-form').addEventListener('submit', event => {
  event.preventDefault(); const amount = Number(q('#family-amount').value); const fee = Number(q('#family-fee').value || 0); if (!validAmount(amount) || fee < 0) return;
  state.transactions.push({ id: uid(), type: 'family_transfer', amount: round(amount), fee: round(fee), account: q('#family-account').value, date: q('#family-date').value, recipient: q('#family-recipient').value.trim(), method: q('#family-method').value.trim(), purpose: q('#family-purpose').value, receivedEgp: round(q('#family-received-egp').value || 0), note: q('#family-note').value.trim(), created: Date.now() });
  save(); event.target.reset(); q('#family-date').value = today(); q('#family-fee').value = 0; closeDialog(q('#family-dialog')); renderAll(); toast('تم تسجيل تحويل العائلة');
});

q('#open-debts').onclick = () => { renderDebts(); openDialog('debts-dialog'); };
q('#debt-kind').addEventListener('change', () => { q('#debt-amount-label').textContent = q('#debt-kind').value === 'GOLD21' ? 'عدد الجرامات' : 'المبلغ'; });
q('#debt-form').addEventListener('submit', event => {
  event.preventDefault(); const amount = Number(q('#debt-amount').value); if (!validAmount(amount)) return;
  state.debts.push({ id: uid(), name: q('#debt-name').value.trim(), kind: q('#debt-kind').value, originalAmount: round(amount), date: q('#debt-date').value, note: q('#debt-note').value.trim(), created: Date.now() });
  save(); event.target.reset(); q('#debt-date').value = today(); q('#debt-kind').dispatchEvent(new Event('change')); renderAll(); toast('تمت إضافة الدين');
});
q('#open-debt-payment').onclick = () => { renderDebtOptions(); openDialog('debt-payment-dialog'); };
q('#payment-debt').addEventListener('change', updatePaymentFields);
q('#debt-payment-form').addEventListener('submit', event => {
  event.preventDefault(); const debt = state.debts.find(item => item.id === q('#payment-debt').value); if (!debt) return;
  const eurCost = Number(q('#payment-eur').value), fee = Number(q('#payment-fee').value || 0), unitsPaid = Number(q('#payment-units').value);
  if (!validAmount(eurCost) || !validAmount(unitsPaid) || fee < 0 || unitsPaid > debtRemaining(debt) + 0.000001) { toast('راجع المبلغ؛ لا يمكن دفع أكثر من المتبقي'); return; }
  state.transactions.push({ id: uid(), type: 'debt_payment', debtId: debt.id, eurCost: round(eurCost), fee: round(fee), unitsPaid: round(unitsPaid), account: q('#payment-account').value, date: q('#payment-date').value, receivedEgp: round(q('#payment-received-egp').value || 0), goldPriceEgp: round(q('#payment-gold-price').value || 0), note: q('#payment-note').value.trim(), created: Date.now() });
  save(); event.target.reset(); q('#payment-date').value = today(); q('#payment-fee').value = 0; closeDialog(q('#debt-payment-dialog')); renderAll(); toast('تم تسجيل دفعة الدين');
});

q('#month').addEventListener('change', renderHome);
q('#transaction-month').addEventListener('change', renderTransactions);
q('#transaction-filter').addEventListener('change', renderTransactions);

async function refreshRates(manual = false) {
  const button = q('#refresh-rates'); button.disabled = true; button.textContent = 'جارٍ التحديث…';
  try {
    const [fxResult, goldResult] = await Promise.allSettled([
      fetch('https://open.er-api.com/v6/latest/EUR').then(response => { if (!response.ok) throw new Error('fx'); return response.json(); }),
      fetch('https://api.gold-api.com/price/XAU').then(response => { if (!response.ok) throw new Error('gold'); return response.json(); })
    ]);
    let changed = false;
    if (fxResult.status === 'fulfilled' && fxResult.value.result === 'success' && fxResult.value.rates?.USD && fxResult.value.rates?.EGP) { state.rates.eurToUsd = fxResult.value.rates.USD; state.rates.eurToEgp = fxResult.value.rates.EGP; changed = true; }
    if (goldResult.status === 'fulfilled' && Number(goldResult.value.price) > 0) { state.rates.goldUsdOz = Number(goldResult.value.price); changed = true; }
    if (!changed) throw new Error('rates');
    state.rates.updatedAt = new Date().toISOString(); state.rates.source = manual ? 'manual' : 'api'; save(); renderAll(); toast('تم تحديث الأسعار');
  } catch { toast('تعذر التحديث؛ يمكنك إدخال الأسعار يدويًا'); }
  finally { button.disabled = false; button.textContent = 'تحديث'; }
}
q('#refresh-rates').onclick = () => refreshRates();
q('#manual-rates').onclick = () => { q('#manual-usd').value = state.rates.eurToUsd || ''; q('#manual-egp').value = state.rates.eurToEgp || ''; q('#manual-gold').value = state.rates.goldUsdOz || ''; openDialog('rates-dialog'); };
q('#rates-form').addEventListener('submit', event => { event.preventDefault(); const usd = Number(q('#manual-usd').value), egp = Number(q('#manual-egp').value), gold = Number(q('#manual-gold').value); if (!validAmount(usd) || !validAmount(egp) || !validAmount(gold)) return; state.rates = { eurToUsd: usd, eurToEgp: egp, goldUsdOz: gold, updatedAt: new Date().toISOString(), source: 'manual' }; save(); closeDialog(q('#rates-dialog')); renderAll(); toast('تم حفظ الأسعار اليدوية'); });

q('#export').onclick = () => { const blob = new Blob([JSON.stringify({ app: 'hesabaty', exportedAt: new Date().toISOString(), ...state }, null, 2)], { type: 'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `hesabaty-${today()}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); };
q('#import').addEventListener('change', async event => {
  const file = event.target.files?.[0]; if (!file) return;
  try { const data = JSON.parse(await file.text()); if (data.version !== 4 || !Array.isArray(data.transactions) || !Array.isArray(data.workEntries) || !Array.isArray(data.debts)) throw new Error('invalid'); if (!confirm('سيتم استبدال بيانات النسخة التجريبية الحالية. هل تريد المتابعة؟')) return; state = { ...emptyState(), ...data }; save(); renderAll(); toast('تم استرجاع النسخة'); }
  catch { toast('الملف غير صالح لهذه النسخة'); }
  finally { event.target.value = ''; }
});

const dateIds = ['work-date', 'income-date', 'expense-date', 'internal-date', 'family-date', 'debt-date', 'payment-date'];
dateIds.forEach(id => q(`#${id}`).value = today());
q('#month').value = currentMonth(); q('#transaction-month').value = currentMonth();
q('#income-kind').dispatchEvent(new Event('change'));
renderAll(); navigate(location.hash.slice(1) || 'home');

const ratesAge = state.rates.updatedAt ? Date.now() - new Date(state.rates.updatedAt).getTime() : Infinity;
if (navigator.onLine && ratesAge > 24 * 60 * 60 * 1000) refreshRates();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
let installPrompt;
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; q('#install').hidden = false; });
q('#install').onclick = async () => { if (!installPrompt) return; installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; q('#install').hidden = true; };
