import { FrequencyUnit } from '../service/frequency-unit.js';

/** Frecuencia de un `Service` (los dos campos o ninguno). */
export type Frequency = {
  frequencyValue: number | null;
  frequencyUnit: string | null;
};

/** Texto de los reminders `CONFIRMATION`: parámetro `{{3}}` de su plantilla. */
export const CONFIRMATION_MESSAGE =
  'Responde a este mensaje para confirmar tu próximo mantenimiento.';

const DAY_MS = 24 * 60 * 60 * 1000;

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** Suma meses en UTC; si el día no existe en el mes destino, usa el último día. */
export function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

/** La fecha más cercana entre `now + frecuencia` de cada servicio; `null` si ninguno tiene. */
export function computeNextServiceDate(
  services: Frequency[],
  now: Date,
): Date | null {
  const candidates = services.flatMap(({ frequencyValue, frequencyUnit }) => {
    if (!frequencyValue || !frequencyUnit) return [];
    if (frequencyUnit === FrequencyUnit.MONTH) {
      return [addMonths(now, frequencyValue)];
    }
    if (frequencyUnit === FrequencyUnit.DAY) {
      return [addDays(now, frequencyValue)];
    }
    return [];
  });
  if (candidates.length === 0) return null;
  return new Date(Math.min(...candidates.map((d) => d.getTime())));
}

/** 1 mes, 15 días y 7 días antes de `next`, sin las que ya pasaron. */
export function confirmationReminderDates(next: Date, now: Date): Date[] {
  return [addMonths(next, -1), addDays(next, -15), addDays(next, -7)].filter(
    (date) => date.getTime() > now.getTime(),
  );
}
