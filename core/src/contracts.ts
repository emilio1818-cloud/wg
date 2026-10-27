import { addDays, addMonths, diffDays } from './dates.ts';
import type { Contract, ContractCategory, ISODate } from './types.ts';

export type ContractPhase = 'unknown' | 'minTerm' | 'renewing' | 'openEnded' | 'cancelled' | 'ended';

export interface ContractStatus {
  phase: ContractPhase;
  /** End of the current term — the date the contract ends if cancelled in time. */
  termEnd?: ISODate;
  /** Last day the cancellation must reach the provider. */
  cancelBy?: ISODate;
  /** Days from today until `cancelBy`. */
  daysLeft?: number;
  /** End of the minimum term. */
  minTermEnd?: ISODate;
  /** 0..1 progress through the minimum term. */
  progress?: number;
  urgency: 'none' | 'info' | 'soon' | 'urgent';
}

function subtractNotice(date: ISODate, value: number, unit: 'day' | 'week' | 'month'): ISODate {
  if (unit === 'day') return addDays(date, -value);
  if (unit === 'week') return addDays(date, -7 * value);
  return addMonths(date, -value);
}

function addNotice(date: ISODate, value: number, unit: 'day' | 'week' | 'month'): ISODate {
  if (unit === 'day') return addDays(date, value);
  if (unit === 'week') return addDays(date, 7 * value);
  return addMonths(date, value);
}

/**
 * Works out where a contract stands and when it can be cancelled.
 *
 * Follows the common German consumer-contract pattern: a minimum term
 * (Mindestlaufzeit) followed either by automatic renewal for a fixed period or —
 * for contracts since the 2022 "Gesetz für faire Verbraucherverträge" — an
 * open-ended continuation that can be cancelled at any time with the notice period.
 */
export function contractStatus(c: Contract, todayDate: ISODate): ContractStatus {
  const noticeValue = c.noticeValue ?? 0;
  const noticeUnit = c.noticeUnit ?? 'month';
  const remind = c.remindDays ?? 60;

  const urgencyFor = (daysLeft: number): ContractStatus['urgency'] =>
    daysLeft <= 14 ? 'urgent' : daysLeft <= remind ? 'soon' : 'info';

  if (c.cancelled) {
    if (c.endDate && c.endDate < todayDate) return { phase: 'ended', termEnd: c.endDate, urgency: 'none' };
    return { phase: 'cancelled', termEnd: c.endDate, urgency: 'none' };
  }
  if (c.endDate && c.endDate < todayDate) return { phase: 'ended', termEnd: c.endDate, urgency: 'none' };

  const openEndedNow = (): ContractStatus => ({
    phase: 'openEnded',
    cancelBy: todayDate,
    termEnd: addNotice(todayDate, noticeValue, noticeUnit),
    daysLeft: 0,
    urgency: 'none',
  });

  if (!c.startDate || !c.minTermMonths) {
    if (c.noticeValue != null) return openEndedNow();
    return { phase: 'unknown', urgency: 'none' };
  }

  // Term ends the day before the anniversary: 24 months from 2024-03-15 → 2026-03-14.
  const minTermEnd = addDays(addMonths(c.startDate, c.minTermMonths), -1);
  const totalDays = Math.max(1, diffDays(c.startDate, minTermEnd));
  const progress = Math.min(1, Math.max(0, diffDays(c.startDate, todayDate) / totalDays));

  const minCancelBy = subtractNotice(minTermEnd, noticeValue, noticeUnit);
  if (todayDate <= minCancelBy) {
    const daysLeft = diffDays(todayDate, minCancelBy);
    return { phase: 'minTerm', termEnd: minTermEnd, cancelBy: minCancelBy, daysLeft, minTermEnd, progress, urgency: urgencyFor(daysLeft) };
  }

  const renewal = c.renewalMonths ?? 0;
  if (renewal <= 0) {
    // Deadline for the minimum term has passed: open-ended contract, cancellable any time.
    const termEnd = addNotice(todayDate, noticeValue, noticeUnit);
    return {
      phase: todayDate <= minTermEnd ? 'minTerm' : 'openEnded',
      termEnd: termEnd > minTermEnd ? termEnd : minTermEnd,
      cancelBy: todayDate,
      daysLeft: 0,
      minTermEnd,
      progress,
      urgency: 'none',
    };
  }

  // Fixed renewals: find the first term whose deadline is still ahead.
  const anniversary = addMonths(c.startDate, c.minTermMonths);
  for (let k = 1; k < 1000; k++) {
    const termEnd = addDays(addMonths(anniversary, renewal * k), -1);
    const cancelBy = subtractNotice(termEnd, noticeValue, noticeUnit);
    if (cancelBy >= todayDate) {
      const daysLeft = diffDays(todayDate, cancelBy);
      return { phase: 'renewing', termEnd, cancelBy, daysLeft, minTermEnd, progress: 1, urgency: urgencyFor(daysLeft) };
    }
  }
  return { phase: 'unknown', urgency: 'none' };
}

export interface ContractTemplate {
  category: ContractCategory;
  emoji: string;
  minTermMonths?: number;
  renewalMonths?: number;
  noticeValue?: number;
  noticeUnit?: 'day' | 'week' | 'month';
  monthlyCost?: number;
}

/** Sensible defaults for common household contracts in Germany. */
export const CONTRACT_TEMPLATES: ContractTemplate[] = [
  { category: 'electricity', emoji: '⚡', minTermMonths: 12, renewalMonths: 0, noticeValue: 1, noticeUnit: 'month' },
  { category: 'internet', emoji: '🌐', minTermMonths: 24, renewalMonths: 0, noticeValue: 1, noticeUnit: 'month' },
  { category: 'gas', emoji: '🔥', minTermMonths: 12, renewalMonths: 0, noticeValue: 1, noticeUnit: 'month' },
  { category: 'broadcast', emoji: '📺', monthlyCost: 1836 },
  { category: 'insurance', emoji: '🏠', minTermMonths: 12, renewalMonths: 12, noticeValue: 3, noticeUnit: 'month' },
  { category: 'liability', emoji: '🛡️', minTermMonths: 12, renewalMonths: 12, noticeValue: 3, noticeUnit: 'month' },
  { category: 'phone', emoji: '📱', minTermMonths: 24, renewalMonths: 0, noticeValue: 1, noticeUnit: 'month' },
  { category: 'streaming', emoji: '🎬', renewalMonths: 0, noticeValue: 0, noticeUnit: 'day' },
  { category: 'gym', emoji: '🏋️', minTermMonths: 12, renewalMonths: 0, noticeValue: 1, noticeUnit: 'month' },
  { category: 'water', emoji: '💧' },
  { category: 'rent', emoji: '🔑', noticeValue: 3, noticeUnit: 'month' },
  { category: 'other', emoji: '📄' },
];

export function contractEmoji(category: ContractCategory): string {
  return CONTRACT_TEMPLATES.find((t) => t.category === category)?.emoji ?? '📄';
}

export interface LetterInput {
  locale: 'de' | 'en';
  holderName: string;
  holderAddress?: string;
  provider: string;
  contractName: string;
  customerNumber?: string;
  contractNumber?: string;
  termEnd?: string;
  /** Pre-formatted current date and city line. */
  dateLine: string;
}

/** Generates a ready-to-send cancellation letter. */
export function cancellationLetter(i: LetterInput): string {
  const lines: string[] = [];
  if (i.locale === 'de') {
    lines.push(i.holderName);
    if (i.holderAddress) lines.push(i.holderAddress);
    lines.push('', i.provider, '', i.dateLine, '');
    lines.push(`Kündigung meines Vertrags: ${i.contractName}`);
    if (i.customerNumber) lines.push(`Kundennummer: ${i.customerNumber}`);
    if (i.contractNumber) lines.push(`Vertragsnummer: ${i.contractNumber}`);
    lines.push('', 'Sehr geehrte Damen und Herren,', '');
    lines.push(
      i.termEnd
        ? `hiermit kündige ich den oben genannten Vertrag fristgerecht zum ${i.termEnd}, hilfsweise zum nächstmöglichen Zeitpunkt.`
        : 'hiermit kündige ich den oben genannten Vertrag fristgerecht zum nächstmöglichen Zeitpunkt.',
    );
    lines.push('');
    lines.push('Bitte senden Sie mir eine schriftliche Bestätigung der Kündigung unter Angabe des Vertragsendes zu.');
    lines.push('');
    lines.push('Einer telefonischen Kontaktaufnahme zu Rückgewinnungszwecken sowie der weiteren Nutzung meiner Daten zu Werbezwecken widerspreche ich ausdrücklich.');
    lines.push('', 'Mit freundlichen Grüßen', '', i.holderName);
  } else {
    lines.push(i.holderName);
    if (i.holderAddress) lines.push(i.holderAddress);
    lines.push('', i.provider, '', i.dateLine, '');
    lines.push(`Cancellation of my contract: ${i.contractName}`);
    if (i.customerNumber) lines.push(`Customer number: ${i.customerNumber}`);
    if (i.contractNumber) lines.push(`Contract number: ${i.contractNumber}`);
    lines.push('', 'Dear Sir or Madam,', '');
    lines.push(
      i.termEnd
        ? `I hereby cancel the above contract with effect from ${i.termEnd}, or alternatively at the earliest possible date.`
        : 'I hereby cancel the above contract at the earliest possible date.',
    );
    lines.push('');
    lines.push('Please confirm the cancellation and the end date of the contract in writing.');
    lines.push('');
    lines.push('I expressly object to being contacted by phone for retention purposes and to any further use of my data for marketing.');
    lines.push('', 'Kind regards', '', i.holderName);
  }
  return lines.join('\n');
}
