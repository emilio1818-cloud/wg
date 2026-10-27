import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, addMonths, diffDays, isValidDate, monthGrid, nextAnnual, startOfWeek, weekdayIndex } from '../src/dates.ts';
import { computeShares, distribute, formatMoney, parseAmount, validateSplit } from '../src/money.ts';
import { computeBalances, expenseImpact, isValidIban, paypalLink, simplifyDebts, spendingStats } from '../src/balances.ts';
import { dueOccurrences, monthlyEquivalent, nextDue, occurrence, recurringExpenseId, recurringToExpense } from '../src/recurring.ts';
import { choreState, completeChore, isAway, leaderboard, nextAssignee, nextDueDate, weeklyStreak } from '../src/chores.ts';
import { cancellationLetter, contractStatus } from '../src/contracts.ts';
import { categorizeItem, expenseCategoryForItems, listKind, parseItemInput } from '../src/shopping.ts';
import { guessExpenseCategory } from '../src/categories.ts';
import { formatInviteCode, normalizeInviteCode, uid } from '../src/ids.ts';
import type { CalendarEvent, Chore, ChoreLog, Contract, Expense, Member, Recurring } from '../src/types.ts';

const base = { createdAt: 0, updatedAt: 0 };

function expense(p: Partial<Expense> & Pick<Expense, 'amount' | 'paidBy' | 'split'>): Expense {
  return { id: uid(), kind: 'expense', title: 'x', date: '2026-10-01', category: 'other', splitMode: 'equal', ...base, ...p };
}

function member(id: string, extra: Partial<Member> = {}): Member {
  return { id, name: id, color: '#000', ...base, ...extra };
}

describe('dates', () => {
  it('adds days across month and year boundaries', () => {
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2024-03-01', -1), '2024-02-29');
    assert.equal(addDays('2026-03-29', 1), '2026-03-30'); // DST change in Europe
  });
  it('clamps month arithmetic to the end of the month', () => {
    assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
    assert.equal(addMonths('2024-01-31', 1), '2024-02-29');
    assert.equal(addMonths('2026-11-15', 3), '2027-02-15');
    assert.equal(addMonths('2026-03-15', -3), '2025-12-15');
  });
  it('computes differences and weekdays', () => {
    assert.equal(diffDays('2026-10-01', '2026-10-31'), 30);
    assert.equal(diffDays('2026-10-31', '2026-10-01'), -30);
    assert.equal(weekdayIndex('2026-10-26'), 0); // Monday
    assert.equal(startOfWeek('2026-11-01'), '2026-10-26');
  });
  it('validates dates', () => {
    assert.ok(isValidDate('2024-02-29'));
    assert.ok(!isValidDate('2026-02-29'));
    assert.ok(!isValidDate('2026-1-01'));
  });
  it('builds a 6-week month grid starting on Monday', () => {
    const grid = monthGrid('2026-10-15');
    assert.equal(grid.length, 6);
    assert.equal(grid[0]![0], '2026-09-28');
    assert.ok(grid.flat().includes('2026-10-31'));
  });
  it('finds the next birthday', () => {
    assert.equal(nextAnnual('11-03', '2026-10-27'), '2026-11-03');
    assert.equal(nextAnnual('01-05', '2026-10-27'), '2027-01-05');
    assert.equal(nextAnnual('02-29', '2026-03-01'), '2027-02-28');
  });
});

describe('money', () => {
  it('distributes remainders so parts sum to the total', () => {
    assert.deepEqual(distribute(1000, [1, 1, 1]), [334, 333, 333]);
    assert.deepEqual(distribute(100, [1, 2]), [33, 67]);
    assert.deepEqual(distribute(-1000, [1, 1, 1]), [-334, -333, -333]);
    assert.deepEqual(distribute(500, [0, 1]), [0, 500]);
    for (let total = 1; total < 500; total += 37) {
      const parts = distribute(total, [3, 1, 4, 1, 5]);
      assert.equal(parts.reduce((a, b) => a + b, 0), total);
    }
  });
  it('computes shares for every split mode', () => {
    const split = [
      { memberId: 'a', value: 1 },
      { memberId: 'b', value: 3 },
    ];
    assert.deepEqual([...computeShares(1001, 'equal', split)], [['a', 501], ['b', 500]]);
    assert.deepEqual([...computeShares(1000, 'shares', split)], [['a', 250], ['b', 750]]);
    assert.deepEqual([...computeShares(1000, 'percent', [{ memberId: 'a', value: 30 }, { memberId: 'b', value: 70 }])], [['a', 300], ['b', 700]]);
    assert.deepEqual([...computeShares(1000, 'exact', [{ memberId: 'a', value: 400 }, { memberId: 'b', value: 600 }])], [['a', 400], ['b', 600]]);
  });
  it('validates splits', () => {
    assert.equal(validateSplit(1000, 'exact', [{ memberId: 'a', value: 400 }]), 'sum_mismatch');
    assert.equal(validateSplit(1000, 'percent', [{ memberId: 'a', value: 50 }, { memberId: 'b', value: 50 }]), null);
    assert.equal(validateSplit(1000, 'equal', []), 'no_participants');
    assert.equal(validateSplit(1000, 'shares', [{ memberId: 'a', value: 0 }]), 'zero_weights');
  });
  it('parses German and English amounts', () => {
    assert.equal(parseAmount('12,50'), 1250);
    assert.equal(parseAmount('12.5'), 1250);
    assert.equal(parseAmount('1.234,56'), 123456);
    assert.equal(parseAmount('1,234.56'), 123456);
    assert.equal(parseAmount('1.234'), 123400);
    assert.equal(parseAmount('€ 7'), 700);
    assert.equal(parseAmount('0,99 €'), 99);
    assert.equal(parseAmount(''), null);
    assert.equal(parseAmount('abc'), null);
  });
  it('formats money', () => {
    assert.equal(formatMoney(123456, 'EUR', 'de-DE').replace(/\s/g, ' '), '1.234,56 €');
    assert.equal(formatMoney(-500, 'EUR', 'en-US'), '-€5.00');
    assert.equal(formatMoney(500, 'EUR', 'de-DE', { sign: true }).replace(/\s/g, ' '), '+5,00 €');
  });
});

describe('balances', () => {
  const members = ['a', 'b', 'c'];
  const expenses = [
    expense({ amount: 3000, paidBy: 'a', split: members.map((m) => ({ memberId: m, value: 1 })) }),
    expense({ amount: 1500, paidBy: 'b', split: [{ memberId: 'a', value: 1 }, { memberId: 'b', value: 1 }, { memberId: 'c', value: 1 }] }),
  ];
  it('balances sum to zero', () => {
    const b = computeBalances(expenses, members);
    assert.equal(b.get('a'), 3000 - 1000 - 500);
    assert.equal(b.get('b'), 1500 - 1000 - 500);
    assert.equal(b.get('c'), -1500);
    assert.equal([...b.values()].reduce((x, y) => x + y, 0), 0);
  });
  it('ignores deleted expenses and handles transfers', () => {
    const transfer = expense({ kind: 'transfer', amount: 1500, paidBy: 'c', splitMode: 'exact', split: [{ memberId: 'a', value: 1500 }] });
    const b = computeBalances([...expenses, transfer, { ...expenses[0]!, id: 'gone', deleted: true }], members);
    assert.equal(b.get('c'), 0);
    assert.equal(b.get('a'), 0);
    assert.equal(b.get('b'), 0);
  });
  it('simplifies debts to at most n-1 transfers that settle everything', () => {
    const balances = new Map([
      ['a', 5000],
      ['b', -2000],
      ['c', -2000],
      ['d', -1000],
      ['e', 0],
    ]);
    const transfers = simplifyDebts(balances);
    assert.ok(transfers.length <= 3);
    const after = new Map(balances);
    for (const t of transfers) {
      after.set(t.from, after.get(t.from)! + t.amount);
      after.set(t.to, after.get(t.to)! - t.amount);
    }
    assert.ok([...after.values()].every((v) => v === 0));
  });
  it('computes the impact of an expense for a member', () => {
    assert.equal(expenseImpact(expenses[0]!, 'a'), 2000);
    assert.equal(expenseImpact(expenses[0]!, 'c'), -1000);
  });
  it('builds spending stats without transfers', () => {
    const transfer = expense({ kind: 'transfer', amount: 999, paidBy: 'c', splitMode: 'exact', split: [{ memberId: 'a', value: 999 }] });
    const s = spendingStats([...expenses, transfer]);
    assert.equal(s.total, 4500);
    assert.equal(s.paidBy.get('a'), 3000);
    assert.equal(s.consumedBy.get('c'), 1500);
  });
  it('creates PayPal links and validates IBANs', () => {
    assert.equal(paypalLink('@lisa', 1250), 'https://paypal.me/lisa/12.50EUR');
    assert.equal(paypalLink('https://paypal.me/max_m', 500), 'https://paypal.me/max_m/5.00EUR');
    assert.ok(isValidIban('DE89 3704 0044 0532 0130 00'));
    assert.ok(!isValidIban('DE89 3704 0044 0532 0130 01'));
  });
});

describe('recurring payments', () => {
  const rent: Recurring = {
    id: 'rent',
    title: 'Miete',
    amount: 180000,
    category: 'rent',
    paidBy: 'a',
    splitMode: 'equal',
    split: [{ memberId: 'a', value: 1 }, { memberId: 'b', value: 1 }],
    frequency: { unit: 'month', every: 1 },
    startDate: '2026-01-31',
    autoBook: true,
    active: true,
    ...base,
  };
  it('keeps the anchor day for monthly schedules', () => {
    assert.equal(occurrence('2026-01-31', { unit: 'month', every: 1 }, 1), '2026-02-28');
    assert.equal(occurrence('2026-01-31', { unit: 'month', every: 1 }, 2), '2026-03-31');
    assert.equal(occurrence('2026-01-01', { unit: 'week', every: 2 }, 2), '2026-01-29');
  });
  it('lists due occurrences since the last booking', () => {
    assert.deepEqual(dueOccurrences(rent, '2026-04-01'), ['2026-01-31', '2026-02-28', '2026-03-31']);
    assert.deepEqual(dueOccurrences({ ...rent, lastBooked: '2026-02-28' }, '2026-04-01'), ['2026-03-31']);
    assert.deepEqual(dueOccurrences({ ...rent, autoBook: false }, '2026-04-01'), []);
    assert.deepEqual(dueOccurrences({ ...rent, endDate: '2026-02-28' }, '2026-06-01'), ['2026-01-31', '2026-02-28']);
  });
  it('computes the next due date', () => {
    assert.equal(nextDue(rent, '2026-02-01'), '2026-02-28');
    assert.equal(nextDue({ ...rent, lastBooked: '2026-03-31' }, '2026-03-31'), '2026-04-30');
    assert.equal(nextDue({ ...rent, endDate: '2026-02-28' }, '2026-03-01'), null);
  });
  it('creates deterministic expenses', () => {
    const e = recurringToExpense(rent, '2026-02-28', 1);
    assert.equal(e.id, recurringExpenseId('rent', '2026-02-28'));
    assert.equal(e.amount, 180000);
    assert.equal(e.recurringId, 'rent');
  });
  it('normalises to monthly costs', () => {
    assert.equal(monthlyEquivalent(12000, { unit: 'year', every: 1 }), 1000);
    assert.equal(monthlyEquivalent(1000, { unit: 'week', every: 1 }), 4333);
  });
});

describe('chores', () => {
  const members = [member('a'), member('b'), member('c')];
  const chore: Chore = {
    id: 'bath',
    title: 'Bad',
    emoji: '🛁',
    frequency: { unit: 'week', every: 1 },
    points: 30,
    rotation: 'rotate',
    memberIds: ['a', 'b', 'c'],
    assigneeId: 'a',
    dueDate: '2026-10-27',
    ...base,
  };
  it('rotates to the next person after whoever did it', () => {
    assert.equal(nextAssignee(chore, 'a', members, [], '2026-11-03'), 'b');
    assert.equal(nextAssignee(chore, 'c', members, [], '2026-11-03'), 'a');
  });
  it('skips members who are away or moved out', () => {
    const away = [member('a'), member('b', { awayFrom: '2026-11-01', awayUntil: '2026-11-10' }), member('c')];
    assert.equal(nextAssignee(chore, 'a', away, [], '2026-11-03'), 'c');
    const moved = [member('a'), member('b', { leftAt: 1 }), member('c')];
    assert.equal(nextAssignee(chore, 'a', moved, [], '2026-11-03'), 'c');
    const event: CalendarEvent = { id: 'e', title: 'Urlaub', type: 'away', date: '2026-11-01', endDate: '2026-11-05', memberIds: ['c'], ...base };
    assert.ok(isAway(members[2]!, '2026-11-03', [event]));
    assert.equal(nextAssignee(chore, 'b', members, [], '2026-11-03', [event]), 'a');
  });
  it('fair mode picks the member with the fewest recent points', () => {
    const logs: ChoreLog[] = [
      { id: '1', choreId: 'x', memberId: 'a', date: '2026-10-20', points: 50, action: 'done', title: '', emoji: '', ...base },
      { id: '2', choreId: 'x', memberId: 'b', date: '2026-10-21', points: 10, action: 'done', title: '', emoji: '', ...base },
      { id: '3', choreId: 'x', memberId: 'c', date: '2026-10-22', points: 30, action: 'done', title: '', emoji: '', ...base },
    ];
    assert.equal(nextAssignee({ ...chore, rotation: 'fair' }, 'a', members, logs, '2026-10-27'), 'b');
  });
  it('fixed and anyone modes', () => {
    assert.equal(nextAssignee({ ...chore, rotation: 'fixed' }, 'b', members, [], '2026-11-03'), 'a');
    assert.equal(nextAssignee({ ...chore, rotation: 'anyone' }, 'b', members, [], '2026-11-03'), undefined);
  });
  it('schedules the next due date', () => {
    assert.equal(nextDueDate(chore, '2026-10-29'), '2026-11-05'); // flexible: from completion
    assert.equal(nextDueDate({ ...chore, fixedSchedule: true }, '2026-10-29'), '2026-11-03');
    assert.equal(nextDueDate({ ...chore, fixedSchedule: true }, '2026-11-12'), '2026-11-17');
    assert.equal(nextDueDate({ ...chore, fixedSchedule: true }, '2026-10-25'), '2026-11-03'); // early
    assert.equal(nextDueDate({ ...chore, frequency: null }, '2026-10-29'), null);
  });
  it('completes a chore: log, next date and assignee', () => {
    const r = completeChore(chore, 'a', '2026-10-27', members, []);
    assert.deepEqual(r.patch, { dueDate: '2026-11-03', assigneeId: 'b' });
    assert.equal(r.log.points, 30);
    const skipped = completeChore(chore, 'a', '2026-10-27', members, [], [], 'skipped');
    assert.equal(skipped.patch!.assigneeId, 'a');
    assert.equal(skipped.log.points, 0);
    assert.equal(completeChore({ ...chore, frequency: null }, 'a', '2026-10-27', members, []).patch, null);
  });
  it('derives states, leaderboard and streaks', () => {
    assert.equal(choreState(chore, '2026-10-28'), 'overdue');
    assert.equal(choreState(chore, '2026-10-27'), 'today');
    assert.equal(choreState(chore, '2026-10-22'), 'soon');
    assert.equal(choreState(chore, '2026-10-01'), 'later');
    const logs: ChoreLog[] = [
      { id: '1', choreId: 'x', memberId: 'a', date: '2026-10-26', points: 30, action: 'done', title: '', emoji: '', ...base },
      { id: '2', choreId: 'x', memberId: 'a', date: '2026-10-19', points: 10, action: 'done', title: '', emoji: '', ...base },
      { id: '3', choreId: 'x', memberId: 'b', date: '2026-10-12', points: 50, action: 'done', title: '', emoji: '', ...base },
    ];
    const board = leaderboard(logs, ['a', 'b', 'c']);
    assert.deepEqual(board.map((e) => [e.memberId, e.points]), [['b', 50], ['a', 40], ['c', 0]]);
    assert.equal(weeklyStreak(logs, 'a', '2026-10-27'), 2);
    assert.equal(weeklyStreak(logs, 'b', '2026-10-27'), 0);
  });
});

describe('contracts', () => {
  const internet: Contract = {
    id: 'i',
    name: 'Internet',
    provider: 'Telekom',
    category: 'internet',
    startDate: '2025-03-15',
    minTermMonths: 24,
    renewalMonths: 0,
    noticeValue: 1,
    noticeUnit: 'month',
    ...base,
  };
  it('is in the minimum term with a deadline before the term ends', () => {
    const s = contractStatus(internet, '2026-10-27');
    assert.equal(s.phase, 'minTerm');
    assert.equal(s.termEnd, '2027-03-14');
    assert.equal(s.cancelBy, '2027-02-14');
    assert.equal(s.daysLeft, 110);
    assert.equal(s.urgency, 'info');
  });
  it('flags upcoming deadlines', () => {
    assert.equal(contractStatus(internet, '2027-01-01').urgency, 'soon');
    assert.equal(contractStatus(internet, '2027-02-05').urgency, 'urgent');
  });
  it('becomes cancellable any time after the minimum term (open-ended)', () => {
    const s = contractStatus(internet, '2027-06-01');
    assert.equal(s.phase, 'openEnded');
    assert.equal(s.cancelBy, '2027-06-01');
    assert.equal(s.termEnd, '2027-07-01');
  });
  it('handles automatic yearly renewals', () => {
    const insurance: Contract = { ...internet, startDate: '2024-01-01', minTermMonths: 12, renewalMonths: 12, noticeValue: 3 };
    const s = contractStatus(insurance, '2026-10-27');
    assert.equal(s.phase, 'renewing');
    assert.equal(s.termEnd, '2027-12-31');
    assert.equal(s.cancelBy, '2027-09-30');
    const s2 = contractStatus(insurance, '2026-09-20');
    assert.equal(s2.termEnd, '2026-12-31');
    assert.equal(s2.cancelBy, '2026-09-30');
    assert.equal(s2.urgency, 'urgent');
  });
  it('handles cancelled, ended and unknown contracts', () => {
    assert.equal(contractStatus({ ...internet, cancelled: true, endDate: '2026-12-31' }, '2026-10-27').phase, 'cancelled');
    assert.equal(contractStatus({ ...internet, cancelled: true, endDate: '2026-01-31' }, '2026-10-27').phase, 'ended');
    assert.equal(contractStatus({ ...internet, startDate: undefined, noticeValue: undefined }, '2026-10-27').phase, 'unknown');
    assert.equal(contractStatus({ ...internet, startDate: undefined }, '2026-10-27').phase, 'openEnded');
  });
  it('writes a cancellation letter', () => {
    const letter = cancellationLetter({
      locale: 'de',
      holderName: 'Lisa Müller',
      provider: 'Telekom',
      contractName: 'Internet',
      customerNumber: '123',
      termEnd: '14.03.2027',
      dateLine: 'Berlin, 27.10.2026',
    });
    assert.match(letter, /Kündigung meines Vertrags: Internet/);
    assert.match(letter, /Kundennummer: 123/);
    assert.match(letter, /zum 14\.03\.2027/);
    assert.match(cancellationLetter({ locale: 'en', holderName: 'L', provider: 'P', contractName: 'C', dateLine: 'x' }), /Dear Sir or Madam/);
  });
});

describe('shopping', () => {
  it('categorises items with longest keyword wins', () => {
    assert.equal(categorizeItem('Hafermilch'), 'dairy');
    assert.equal(categorizeItem('Zahnpasta'), 'drugstore');
    assert.equal(categorizeItem('Pasta'), 'pantry');
    assert.equal(categorizeItem('Tomaten'), 'produce');
    assert.equal(categorizeItem('Tomatenmark'), 'pantry');
    assert.equal(categorizeItem('Klopapier'), 'household');
    assert.equal(categorizeItem('Club-Mate'), 'drinks');
    assert.equal(categorizeItem('Äpfel'), 'produce');
    assert.equal(categorizeItem('Reis'), 'pantry');
    assert.equal(categorizeItem('Teelichter'), 'home');
    assert.equal(categorizeItem('Weißwein'), 'drinks');
    assert.equal(categorizeItem('Shampoo'), 'drugstore');
    assert.equal(categorizeItem('Flux capacitor'), 'other');
  });
  it('parses quantities', () => {
    assert.deepEqual(parseItemInput('2x Milch'), { quantity: '2x', name: 'Milch' });
    assert.deepEqual(parseItemInput('milch 2l'), { quantity: '2l', name: 'Milch' });
    assert.deepEqual(parseItemInput('3 Äpfel'), { quantity: '3', name: 'Äpfel' });
    assert.deepEqual(parseItemInput('500 g Hack'), { quantity: '500g', name: 'Hack' });
    assert.deepEqual(parseItemInput('Brot'), { name: 'Brot' });
  });
  it('picks expense categories and list kinds', () => {
    assert.equal(expenseCategoryForItems(['drugstore', 'drugstore', 'produce']), 'drugstore');
    assert.equal(expenseCategoryForItems(['produce', 'dairy']), 'groceries');
    assert.equal(listKind('dm', '🧴'), 'drugstore');
    assert.equal(listKind('IKEA', '🛋️'), 'home');
    assert.equal(listKind('Supermarkt', '🛒'), 'supermarket');
  });
  it('guesses expense categories from titles', () => {
    assert.equal(guessExpenseCategory('Pizza Freitag'), 'food');
    assert.equal(guessExpenseCategory('Miete November'), 'rent');
    assert.equal(guessExpenseCategory('REWE Einkauf'), 'groceries');
    assert.equal(guessExpenseCategory('Netflix'), 'subscriptions');
    assert.equal(guessExpenseCategory('Stromabschlag'), 'utilities');
    assert.equal(guessExpenseCategory('dm'), 'drugstore');
    assert.equal(guessExpenseCategory('Irgendwas'), null);
  });
});

describe('ids', () => {
  it('creates unique ids and normalises invite codes', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uid()));
    assert.equal(ids.size, 1000);
    assert.equal(normalizeInviteCode(' k7q-9xm '), 'K7Q9XM');
    assert.equal(formatInviteCode('k7q9xm'), 'K7Q-9XM');
  });
});
