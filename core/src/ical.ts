import type { ISODate } from './types.ts';

/* Minimal iCalendar (RFC 5545) writer for exporting the flat's calendar. */

export interface IcsEvent {
  uid: string;
  title: string;
  date: ISODate;
  /** Inclusive last day for multi-day all-day events. */
  endDate?: ISODate;
  /** `HH:MM` local time; omitted for all-day events. */
  time?: string;
  endTime?: string;
  description?: string;
  location?: string;
  /** Repeat yearly (birthdays). */
  yearly?: boolean;
}

function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Folds lines longer than 75 octets as required by RFC 5545 §3.1. */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (size + n > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = '';
      size = 0;
    }
    current += ch;
    size += n;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

function compactDate(d: ISODate): string {
  return d.replace(/-/g, '');
}

function nextDay(d: ISODate): ISODate {
  const dt = new Date(d + 'T12:00:00Z');
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

function stamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function buildIcs(calendarName: string, events: IcsEvent[], now = new Date()): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Nestly//WG App//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${escapeText(calendarName)}`];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.uid}@nestly`, `DTSTAMP:${stamp(now)}`);
    if (e.time) {
      const t = e.time.replace(':', '') + '00';
      lines.push(`DTSTART:${compactDate(e.date)}T${t}`);
      const endT = (e.endTime ?? e.time).replace(':', '') + '00';
      const endD = e.endDate ?? e.date;
      lines.push(e.endTime || e.endDate ? `DTEND:${compactDate(endD)}T${endT}` : 'DURATION:PT1H');
    } else {
      lines.push(`DTSTART;VALUE=DATE:${compactDate(e.date)}`, `DTEND;VALUE=DATE:${compactDate(nextDay(e.endDate ?? e.date))}`);
    }
    if (e.yearly) lines.push('RRULE:FREQ=YEARLY');
    lines.push(`SUMMARY:${escapeText(e.title)}`);
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
