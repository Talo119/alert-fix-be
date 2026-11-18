type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let fmt = formatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, fmt);
  }
  return fmt;
}

function localParts(date: Date, timeZone: string): LocalParts {
  const parts: Record<string, number> = {};
  for (const p of formatterFor(timeZone).formatToParts(date)) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

/** Desfase (ms) de `timeZone` respecto a UTC en el instante `date`: local − UTC. */
function offsetAt(date: Date, timeZone: string): number {
  const p = localParts(date, timeZone);
  const asUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * Inicio (00:00 local) del día siguiente a `now` en la zona horaria `timeZone`,
 * devuelto como instante UTC.
 */
export function startOfNextDay(now: Date, timeZone: string): Date {
  const { year, month, day } = localParts(now, timeZone);
  // Medianoche del día siguiente leída como si fuera UTC; Date.UTC normaliza fin de mes/año.
  const naive = Date.UTC(year, month - 1, day + 1);
  // Primera aproximación con el desfase en ese instante; se recalcula una vez
  // por si un cambio de horario (DST) cae entre ambos puntos.
  const guess = naive - offsetAt(new Date(naive), timeZone);
  return new Date(naive - offsetAt(new Date(guess), timeZone));
}
