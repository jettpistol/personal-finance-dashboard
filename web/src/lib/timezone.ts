import dayjs from 'dayjs';

// Instants travel as UTC milliseconds; these helpers show them in any IANA time zone with the
// browser's own Intl data (daylight saving included), independent of the device's zone.

export const DEFAULT_ZONE = 'America/Argentina/Buenos_Aires';

export function isValidZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export function deviceZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_ZONE;
  } catch {
    return DEFAULT_ZONE;
  }
}

const FALLBACK_ZONES = [
  'America/Argentina/Buenos_Aires', 'America/Montevideo', 'America/Santiago', 'America/Sao_Paulo', 'America/Bogota', 'America/Lima', 'America/Mexico_City',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Madrid', 'Europe/Paris', 'Europe/Berlin', 'Europe/Rome',
  'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Kolkata', 'Australia/Sydney', 'Pacific/Auckland', 'UTC',
];

export function allZones(): string[] {
  try {
    const list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone');
    if (list?.length) return list.includes('UTC') ? list : [...list, 'UTC'];
  } catch {
    /* older browsers */
  }
  return FALLBACK_ZONES;
}

type Parts = { year: string; month: string; day: string; hour: string; minute: string; second: string; offset: string };

const cache = new Map<string, Intl.DateTimeFormat>();
function formatter(zone: string) {
  let f = cache.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'shortOffset',
    });
    cache.set(zone, f);
  }
  return f;
}

export function zonedParts(ms: number, zone: string): Parts {
  const parts = formatter(zone).formatToParts(new Date(ms));
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? '';
  const offset = get('timeZoneName') === 'GMT' ? 'GMT+0' : get('timeZoneName');
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second'), offset };
}

/** "GMT-3", "GMT+5:30" at that instant. */
export function zoneOffset(zone: string, ms = Date.now()): string {
  return zonedParts(ms, zone).offset;
}

/** "Hora de Argentina (GMT-3)"; the zone id itself when the browser has no name for it. */
export function zoneLabel(zone: string, ms = Date.now()): string {
  let name = zone;
  try {
    const p = new Intl.DateTimeFormat('es-AR', { timeZone: zone, timeZoneName: 'longGeneric' }).formatToParts(new Date(ms));
    const n = p.find((x) => x.type === 'timeZoneName')?.value;
    if (n && !/^GMT|^UTC[+-]/.test(n)) name = n;
  } catch {
    /* keep the id */
  }
  if (zone === 'UTC' || zone === 'Etc/UTC') name = 'UTC';
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} (${zoneOffset(zone, ms)})`;
}

/** Calendar day of an instant in a zone, "YYYY-MM-DD". */
export function dayKey(ms: number, zone: string): string {
  const p = zonedParts(ms, zone);
  return `${p.year}-${p.month}-${p.day}`;
}

export const timeIn = (ms: number, zone: string) => {
  const p = zonedParts(ms, zone);
  return `${p.hour}:${p.minute}`;
};

/** "28/10/2026 14:32:05 (GMT-3)" */
export const fullTimeIn = (ms: number, zone: string) => {
  const p = zonedParts(ms, zone);
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}:${p.second} (${p.offset})`;
};

/** "Miércoles 28 de octubre de 2026" for a calendar day. */
export function dayTitle(key: string): string {
  const s = dayjs(key).format('dddd D [de] MMMM [de] YYYY');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The UTC instant at which a calendar day ("YYYY-MM-DD") starts in a zone. */
export function startOfDayUtc(key: string, zone: string): number {
  const [y, m, d] = key.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d);
  // Offset of the zone near that moment, then correct once more for a DST change in between.
  let guess = wall;
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(guess, zone);
    const shown = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
    const next = guess + (wall - shown);
    if (next === guess) break;
    guess = next;
  }
  return guess;
}

/** The day after a calendar day, "YYYY-MM-DD". */
export function nextDay(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return t.toISOString().slice(0, 10);
}
