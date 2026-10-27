import { addDays, addMonths, today } from '../../../core/src/dates.ts';
import { uid } from '../../../core/src/ids.ts';
import type { Activity, CalendarEvent, Chore, ChoreLog, Contract, Expense, ID, Member, Note, Recurring, ShoppingItem, ShoppingList } from '../../../core/src/types.ts';
import { categorizeItem } from '../../../core/src/shopping.ts';
import { getLang, t } from '../i18n/index.ts';
import { bookDueRecurring } from './actions.ts';
import { put, resetStore } from './store.ts';

/** Fills the store with a lively sample flat share for exploring the app. */
export function loadDemo(): void {
  const de = getLang() === 'de';
  const T = today();
  const now = Date.now();
  const DAY = 86_400_000;
  const householdId = 'demo_household';
  const ids = { me: 'demo_alex', lena: 'demo_lena', jonas: 'demo_jonas', mia: 'demo_mia' };
  resetStore({ householdId, memberId: ids.me, mode: 'demo', cursor: 0 });

  const at = (daysAgo: number, hour = 12) => now - daysAgo * DAY - (12 - hour) * 3_600_000;
  const base = (daysAgo = 30, by: ID = ids.me) => ({ id: uid(), createdAt: at(daysAgo), updatedAt: at(daysAgo), createdBy: by });
  const all = Object.values(ids);
  const equal = all.map((memberId) => ({ memberId, value: 1 }));

  put('household', {
    id: householdId,
    name: de ? 'WG Kastanienallee' : 'Maple Street Flat',
    emoji: '🌿',
    currency: 'EUR',
    address: de ? 'Kastanienallee 12, 10435 Berlin' : '12 Maple Street, London',
    wifiSsid: de ? 'Kastanie5G' : 'MapleNest5G',
    wifiPassword: 'Bitte-nicht-weitersagen-42',
    wifiSecurity: 'WPA',
    houseRules: de
      ? '🤫 Ruhe ab 22 Uhr (Fr & Sa ab Mitternacht)\n🍽️ Geschirr spätestens am nächsten Morgen spülen\n👋 Übernachtungsgäste kurz in die Gruppe schreiben\n♻️ Mülltrennung ernst nehmen\n🛁 Haare aus dem Abfluss – bitte!'
      : '🤫 Quiet after 10 pm (Fri & Sat after midnight)\n🍽️ Dishes done by the next morning\n👋 Let everyone know about overnight guests\n♻️ Take recycling seriously\n🛁 Hair out of the drain – please!',
    landlordName: de ? 'Hausverwaltung Schmidt' : 'Smith Lettings',
    landlordPhone: '+49 30 1234567',
    createdAt: at(400),
    updatedAt: at(400),
  });

  const people: Member[] = [
    { id: ids.me, name: 'Alex', emoji: '😎', color: '#7C5CFF', claimed: true, paypal: 'alex-demo', birthday: '03-14', createdAt: at(400), updatedAt: at(400) },
    { id: ids.lena, name: 'Lena', emoji: '🦊', color: '#FF6B6B', claimed: true, paypal: 'lena-demo', iban: 'DE89370400440532013000', birthday: '07-02', createdAt: at(399), updatedAt: at(399) },
    { id: ids.jonas, name: 'Jonas', emoji: '🎧', color: '#10B981', claimed: true, createdAt: at(380), updatedAt: at(380) },
    {
      id: ids.mia,
      name: 'Mia',
      emoji: '🌻',
      color: '#F59E0B',
      claimed: true,
      paypal: 'mia-demo',
      birthday: addDays(T, 9).slice(5),
      createdAt: at(200),
      updatedAt: at(200),
    },
  ];
  people.forEach((m) => put('members', m));

  // Expenses -------------------------------------------------------------
  const ex = (daysAgo: number, title: string, amount: number, paidBy: ID, category: Expense['category'], split = equal, note?: string): Expense => ({
    ...base(daysAgo, paidBy),
    kind: 'expense',
    title,
    amount,
    paidBy,
    date: addDays(T, -daysAgo),
    category,
    splitMode: 'equal',
    split,
    note,
  });
  const expenses: Expense[] = [
    ex(1, de ? 'REWE Wocheneinkauf' : 'Weekly groceries', 4783, ids.lena, 'groceries'),
    ex(2, de ? 'Pizza-Abend 🍕' : 'Pizza night 🍕', 3850, ids.jonas, 'food'),
    ex(4, de ? 'dm: Klopapier & Spülmittel' : 'Toilet paper & dish soap', 1245, ids.me, 'drugstore'),
    ex(6, de ? 'Getränke WG-Abend' : 'Drinks for flat night', 6420, ids.mia, 'drinks'),
    ex(9, de ? 'Neue Pfanne' : 'New frying pan', 2999, ids.me, 'household'),
    ex(12, de ? 'Edeka' : 'Groceries', 3214, ids.jonas, 'groceries'),
    ex(16, de ? 'Kinoabend Snacks' : 'Movie night snacks', 1680, ids.mia, 'food', [ids.me, ids.mia, ids.lena].map((memberId) => ({ memberId, value: 1 }))),
    ex(20, de ? 'Glühbirnen & Batterien' : 'Light bulbs & batteries', 1890, ids.lena, 'repairs'),
    ex(25, 'IKEA', 8970, ids.me, 'furniture', equal, de ? 'Regal Flur + Teelichter' : 'Hallway shelf + tea lights'),
    ex(33, de ? 'Wocheneinkauf' : 'Groceries', 5612, ids.mia, 'groceries'),
    ex(38, de ? 'Putzmittel' : 'Cleaning supplies', 2340, ids.jonas, 'household'),
  ];
  expenses.forEach((e) => put('expenses', e));
  put('expenses', {
    ...base(5, ids.jonas),
    kind: 'transfer',
    title: t('money.transfer'),
    amount: 2000,
    paidBy: ids.jonas,
    date: addDays(T, -5),
    category: 'other',
    splitMode: 'exact',
    split: [{ memberId: ids.lena, value: 2000 }],
    method: 'paypal',
  });

  // Recurring payments ---------------------------------------------------
  const monthStart = (offsetMonths: number, day: number) => {
    const d = addMonths(T, offsetMonths);
    return d.slice(0, 8) + String(day).padStart(2, '0');
  };
  const rec = (title: string, emoji: string, amount: number, paidBy: ID, category: Recurring['category'], day: number, autoBook = true): Recurring => ({
    ...base(90, paidBy),
    title,
    emoji,
    amount,
    paidBy,
    category,
    splitMode: 'equal',
    split: equal,
    frequency: { unit: 'month', every: 1 },
    startDate: monthStart(-2, day),
    autoBook,
    active: true,
  });
  const recurring: Recurring[] = [
    rec(de ? 'Miete (an Hausverwaltung)' : 'Rent (to landlord)', '🔑', 196000, ids.me, 'rent', 1, false),
    rec(de ? 'Strom' : 'Electricity', '⚡', 9200, ids.lena, 'utilities', 15),
    rec('Internet', '🌐', 3999, ids.me, 'internet', 5),
    rec('Netflix', '🎬', 1799, ids.jonas, 'subscriptions', 20),
    rec(de ? 'Rundfunkbeitrag' : 'TV licence', '📺', 1836, ids.mia, 'subscriptions', 10),
  ];
  recurring.forEach((r) => put('recurring', r));

  // Contracts ------------------------------------------------------------
  const contracts: Contract[] = [
    {
      ...base(330),
      name: de ? 'Strom' : 'Electricity',
      provider: de ? 'Stadtwerke Berlin' : 'City Power',
      category: 'electricity',
      emoji: '⚡',
      monthlyCost: 9200,
      customerNumber: '4711-0815-23',
      meterNumber: '1ESY1160552714',
      startDate: addDays(addMonths(T, -11), 24),
      minTermMonths: 12,
      renewalMonths: 0,
      noticeValue: 1,
      noticeUnit: 'month',
      holderId: ids.lena,
      phone: '030 123 456 78',
      website: 'https://example.org',
      recurringId: recurring[1]!.id,
    },
    {
      ...base(420),
      name: 'Internet',
      provider: de ? 'Telekom MagentaZuhause L' : 'FibreNet 250',
      category: 'internet',
      emoji: '🌐',
      monthlyCost: 3999,
      customerNumber: '551 234 9987',
      contractNumber: 'MZ-2025-77812',
      startDate: addMonths(T, -14),
      minTermMonths: 24,
      renewalMonths: 0,
      noticeValue: 1,
      noticeUnit: 'month',
      holderId: ids.me,
      recurringId: recurring[2]!.id,
    },
    {
      ...base(200),
      name: de ? 'Rundfunkbeitrag' : 'TV licence',
      provider: de ? 'ARD ZDF Deutschlandradio Beitragsservice' : 'TV Licensing',
      category: 'broadcast',
      emoji: '📺',
      monthlyCost: 1836,
      customerNumber: '512 345 678',
      holderId: ids.mia,
      recurringId: recurring[4]!.id,
    },
    {
      ...base(500),
      name: de ? 'Hausrat & Haftpflicht' : 'Contents insurance',
      provider: 'HUK24',
      category: 'insurance',
      emoji: '🏠',
      monthlyCost: 790,
      contractNumber: 'HR-3391-2201',
      startDate: addMonths(addDays(T, 75), -36),
      minTermMonths: 12,
      renewalMonths: 12,
      noticeValue: 3,
      noticeUnit: 'month',
      holderId: ids.me,
    },
    {
      ...base(60),
      name: 'Netflix',
      provider: 'Netflix',
      category: 'streaming',
      emoji: '🎬',
      monthlyCost: 1799,
      renewalMonths: 0,
      noticeValue: 0,
      noticeUnit: 'day',
      holderId: ids.jonas,
      recurringId: recurring[3]!.id,
    },
  ];
  contracts.forEach((c) => put('contracts', c));

  // Chores ---------------------------------------------------------------
  const chore = (key: string, emoji: string, points: number, f: Chore['frequency'], assigneeId: ID | undefined, dueIn: number, rotation: Chore['rotation'] = 'rotate', fixedSchedule = false): Chore => ({
    ...base(60),
    title: t(`tpl.${key}` as 'tpl.kitchen'),
    emoji,
    points,
    frequency: f,
    rotation,
    memberIds: all,
    assigneeId,
    dueDate: addDays(T, dueIn),
    fixedSchedule,
  });
  const chores: Chore[] = [
    chore('bathroom', '🛁', 40, { unit: 'week', every: 1 }, ids.me, 0),
    chore('kitchen', '🍳', 30, { unit: 'week', every: 1 }, ids.lena, 1),
    chore('trash', '🗑️', 10, { unit: 'week', every: 1 }, ids.jonas, -1, 'rotate', true),
    chore('vacuum', '🧹', 30, { unit: 'week', every: 1 }, ids.mia, 3),
    chore('glass', '🍾', 20, { unit: 'week', every: 2 }, ids.me, 5),
    chore('plants', '🪴', 10, { unit: 'week', every: 1 }, undefined, 0, 'anyone'),
    chore('fridge', '🧊', 30, { unit: 'month', every: 1 }, ids.jonas, 12, 'fair'),
    chore('towels', '🧺', 20, { unit: 'week', every: 2 }, ids.lena, 8),
  ];
  chores.forEach((c) => put('chores', c));

  const logs: [number, ID, number, number][] = [
    // [daysAgo, member, choreIndex, points]
    [1, ids.lena, 3, 30],
    [2, ids.mia, 1, 30],
    [3, ids.me, 2, 10],
    [5, ids.lena, 0, 40],
    [6, ids.jonas, 2, 10],
    [8, ids.me, 1, 30],
    [9, ids.mia, 0, 40],
    [11, ids.lena, 7, 20],
    [13, ids.me, 3, 30],
    [15, ids.lena, 1, 30],
    [16, ids.mia, 5, 10],
    [19, ids.me, 0, 40],
    [20, ids.jonas, 3, 30],
    [23, ids.lena, 4, 20],
    [26, ids.me, 6, 30],
    [27, ids.mia, 2, 10],
  ];
  for (const [daysAgo, memberId, idx, points] of logs) {
    const c = chores[idx]!;
    const log: ChoreLog = { ...base(daysAgo, memberId), choreId: c.id, memberId, date: addDays(T, -daysAgo), points, action: 'done', title: c.title, emoji: c.emoji };
    put('choreLogs', log);
  }

  // Shopping -------------------------------------------------------------
  const lists: ShoppingList[] = [
    { ...base(300), name: t('list.supermarket'), emoji: '🛒', color: '#22C55E', order: 0 },
    { ...base(300), name: t('list.drugstore'), emoji: '🧴', color: '#EC4899', order: 1 },
    { ...base(40), name: 'IKEA', emoji: '🛋️', color: '#F59E0B', order: 2 },
  ];
  lists.forEach((l) => put('lists', l));
  const item = (listIdx: number, name: string, by: ID, opts: Partial<ShoppingItem> = {}): ShoppingItem => ({
    ...base(Math.random() * 3, by),
    listId: lists[listIdx]!.id,
    name,
    category: categorizeItem(name),
    checked: false,
    ...opts,
  });
  const items: ShoppingItem[] = de
    ? [
        item(0, 'Hafermilch', ids.lena, { quantity: '2x' }),
        item(0, 'Bananen', ids.mia),
        item(0, 'Spaghetti', ids.jonas, { quantity: '3x' }),
        item(0, 'Tomaten', ids.me),
        item(0, 'Kaffee', ids.lena, { urgent: true }),
        item(0, 'Feta', ids.mia),
        item(0, 'Brot', ids.jonas, { checked: true, checkedBy: ids.me, checkedAt: now }),
        item(1, 'Klopapier', ids.me, { urgent: true }),
        item(1, 'Spülmittel', ids.lena),
        item(1, 'Zahnpasta', ids.mia),
        item(2, 'Teelichter', ids.mia),
        item(2, 'Kleiderbügel', ids.me, { quantity: '10' }),
      ]
    : [
        item(0, 'Oat milk', ids.lena, { quantity: '2x', category: 'dairy' }),
        item(0, 'Bananas', ids.mia, { category: 'produce' }),
        item(0, 'Spaghetti', ids.jonas, { quantity: '3x' }),
        item(0, 'Tomatoes', ids.me, { category: 'produce' }),
        item(0, 'Coffee', ids.lena, { urgent: true, category: 'pantry' }),
        item(0, 'Feta', ids.mia),
        item(0, 'Bread', ids.jonas, { checked: true, checkedBy: ids.me, checkedAt: now }),
        item(1, 'Toilet paper', ids.me, { urgent: true }),
        item(1, 'Dish soap', ids.lena),
        item(1, 'Toothpaste', ids.mia),
        item(2, 'Tea lights', ids.mia, { category: 'home' }),
        item(2, 'Hangers', ids.me, { quantity: '10' }),
      ];
  items.forEach((i) => put('items', i));

  // Calendar -------------------------------------------------------------
  const saturday = addDays(T, ((5 - ((new Date().getDay() + 6) % 7)) + 7) % 7 || 7);
  const events: CalendarEvent[] = [
    { ...base(3, ids.mia), title: de ? 'WG-Party 🎉' : 'Flat party 🎉', type: 'party', date: addDays(saturday, 7), time: '20:00', memberIds: all, note: de ? 'Motto: 2000er! Jeder bringt einen Snack mit.' : 'Theme: 2000s! Everyone brings a snack.' },
    { ...base(1, ids.lena), title: de ? 'Heizung wird gewartet' : 'Boiler service', type: 'repair', date: addDays(T, 2), time: '10:00', note: de ? 'Jemand muss zuhause sein!' : 'Someone needs to be home!' },
    { ...base(2, ids.me), title: de ? 'WG-Meeting: Putzplan & Party' : 'House meeting', type: 'meeting', date: addDays(T, 4), time: '19:30', memberIds: all },
    { ...base(6, ids.lena), title: de ? 'Lena in Lissabon' : 'Lena in Lisbon', type: 'away', date: addDays(T, 10), endDate: addDays(T, 15), memberIds: [ids.lena] },
    { ...base(4, ids.jonas), title: de ? 'Besuch von Jonas’ Schwester' : 'Jonas’ sister visiting', type: 'guest', date: addDays(T, 6), endDate: addDays(T, 7), memberIds: [ids.jonas] },
  ];
  events.forEach((e) => put('events', e));

  // Board ----------------------------------------------------------------
  const notes: Note[] = de
    ? [
        { ...base(1, ids.mia), text: 'Samstag ist Flohmarkt am Mauerpark! Wer kommt mit? 🧺', color: '#B8F2E6', pinned: true, authorId: ids.mia, reactions: { '🙋': [ids.me, ids.lena] } },
        { ...base(2, ids.jonas), text: 'Wer hat meinen Hummus gegessen? 😤', color: '#FFB4A2', pinned: false, authorId: ids.jonas, reactions: { '😂': [ids.lena, ids.mia], '🙈': [ids.me] } },
        { ...base(5, ids.lena), text: 'Die neue Pflanze im Flur heißt Günther. Bitte einmal pro Woche gießen 🪴', color: '#FFE66D', pinned: false, authorId: ids.lena, reactions: { '❤️': [ids.me, ids.jonas, ids.mia] } },
        { ...base(8, ids.me), text: 'Paket für Mia liegt bei Familie Yilmaz (2. OG) 📦', color: '#C3B1E1', pinned: false, authorId: ids.me },
      ]
    : [
        { ...base(1, ids.mia), text: 'Flea market on Saturday! Who’s in? 🧺', color: '#B8F2E6', pinned: true, authorId: ids.mia, reactions: { '🙋': [ids.me, ids.lena] } },
        { ...base(2, ids.jonas), text: 'Who ate my hummus? 😤', color: '#FFB4A2', pinned: false, authorId: ids.jonas, reactions: { '😂': [ids.lena, ids.mia], '🙈': [ids.me] } },
        { ...base(5, ids.lena), text: 'The new plant in the hallway is called Gunther. Water once a week please 🪴', color: '#FFE66D', pinned: false, authorId: ids.lena, reactions: { '❤️': [ids.me, ids.jonas, ids.mia] } },
        { ...base(8, ids.me), text: 'Parcel for Mia is with the neighbours (2nd floor) 📦', color: '#C3B1E1', pinned: false, authorId: ids.me },
      ];
  notes.forEach((n) => put('notes', n));

  // Activity -------------------------------------------------------------
  const act = (hoursAgo: number, a: Omit<Activity, 'id' | 'createdAt' | 'updatedAt'>) => {
    const ts = now - hoursAgo * 3_600_000;
    put('activity', { id: uid(), createdAt: ts, updatedAt: ts, ...a });
  };
  act(0.4, { type: 'items_added', actorId: ids.lena, title: de ? 'Kaffee' : 'Coffee', count: 1 });
  act(3, { type: 'chore_done', actorId: ids.lena, title: t('tpl.vacuum'), emoji: '🧹', points: 30 });
  act(20, { type: 'expense_added', actorId: ids.lena, title: expenses[0]!.title, amount: expenses[0]!.amount });
  act(26, { type: 'note_added', actorId: ids.mia });
  act(44, { type: 'expense_added', actorId: ids.jonas, title: expenses[1]!.title, amount: expenses[1]!.amount });
  act(50, { type: 'chore_done', actorId: ids.mia, title: t('tpl.kitchen'), emoji: '🍳', points: 30 });
  act(70, { type: 'event_added', actorId: ids.me, title: events[2]!.title });
  act(120, { type: 'transfer_added', actorId: ids.jonas, targetId: ids.lena, amount: 2000 });

  bookDueRecurring();
}
