import {
  addDays,
  addMonths,
  computeNextServiceDate,
  confirmationReminderDates,
} from './next-service.js';

const d = (iso: string) => new Date(iso);
const iso = (dates: Date[]) => dates.map((date) => date.toISOString());

describe('addDays', () => {
  it('suma y resta días conservando la hora', () => {
    expect(addDays(d('2026-11-27T15:30:00.000Z'), 90).toISOString()).toBe(
      '2027-02-25T15:30:00.000Z',
    );
    expect(addDays(d('2027-02-25T15:30:00.000Z'), -15).toISOString()).toBe(
      '2027-02-10T15:30:00.000Z',
    );
  });
});

describe('addMonths', () => {
  it.each([
    ['2026-11-27T15:30:00.000Z', 1, '2026-12-27T15:30:00.000Z'],
    ['2026-01-31T10:00:00.000Z', 1, '2026-02-28T10:00:00.000Z'],
    ['2028-01-31T10:00:00.000Z', 1, '2028-02-29T10:00:00.000Z'], // bisiesto
    ['2026-03-31T10:00:00.000Z', -1, '2026-02-28T10:00:00.000Z'],
    ['2026-12-15T10:00:00.000Z', 1, '2027-01-15T10:00:00.000Z'], // cruce de año
    ['2027-01-15T10:00:00.000Z', -1, '2026-12-15T10:00:00.000Z'],
    ['2026-11-27T15:30:00.000Z', 12, '2027-11-27T15:30:00.000Z'],
  ])('%s %+d meses → %s', (from, months, expected) => {
    expect(addMonths(d(from), months).toISOString()).toBe(expected);
  });

  it('no modifica la fecha original', () => {
    const date = d('2026-01-31T10:00:00.000Z');
    addMonths(date, 1);
    expect(date.toISOString()).toBe('2026-01-31T10:00:00.000Z');
  });
});

describe('computeNextServiceDate', () => {
  const now = d('2026-11-27T15:30:00.000Z');

  it('suma meses', () => {
    expect(
      computeNextServiceDate(
        [{ frequencyValue: 3, frequencyUnit: 'MONTH' }],
        now,
      )?.toISOString(),
    ).toBe('2027-02-27T15:30:00.000Z');
  });

  it('suma días', () => {
    expect(
      computeNextServiceDate(
        [{ frequencyValue: 90, frequencyUnit: 'DAY' }],
        now,
      )?.toISOString(),
    ).toBe('2027-02-25T15:30:00.000Z');
  });

  it('gana la fecha más cercana', () => {
    expect(
      computeNextServiceDate(
        [
          { frequencyValue: 3, frequencyUnit: 'MONTH' },
          { frequencyValue: 45, frequencyUnit: 'DAY' },
        ],
        now,
      )?.toISOString(),
    ).toBe('2027-01-11T15:30:00.000Z');
  });

  it('ignora servicios sin frecuencia o con solo uno de los campos', () => {
    expect(
      computeNextServiceDate(
        [
          { frequencyValue: null, frequencyUnit: null },
          { frequencyValue: 10, frequencyUnit: null },
          { frequencyValue: null, frequencyUnit: 'DAY' },
          { frequencyValue: 6, frequencyUnit: 'MONTH' },
        ],
        now,
      )?.toISOString(),
    ).toBe('2027-05-27T15:30:00.000Z');
    expect(
      computeNextServiceDate(
        [
          { frequencyValue: null, frequencyUnit: null },
          { frequencyValue: 10, frequencyUnit: null },
        ],
        now,
      ),
    ).toBeNull();
  });

  it('lista vacía → null', () => {
    expect(computeNextServiceDate([], now)).toBeNull();
  });
});

describe('confirmationReminderDates', () => {
  const now = d('2026-11-27T15:30:00.000Z');

  it('frecuencia de 1 año → 1 mes, 15 días y 7 días antes', () => {
    const next = addMonths(now, 12);
    expect(iso(confirmationReminderDates(next, now))).toEqual([
      '2027-10-27T15:30:00.000Z',
      '2027-11-12T15:30:00.000Z',
      '2027-11-20T15:30:00.000Z',
    ]);
  });

  it.each([
    [20, 2],
    [10, 1],
    [8, 1],
    [7, 0],
    [3, 0],
  ])('frecuencia de %d días → %d fechas', (days, count) => {
    expect(confirmationReminderDates(addDays(now, days), now)).toHaveLength(
      count,
    );
  });

  it('20 días → 15 y 7 días antes', () => {
    expect(iso(confirmationReminderDates(addDays(now, 20), now))).toEqual([
      '2026-12-02T15:30:00.000Z',
      '2026-12-10T15:30:00.000Z',
    ]);
  });
});
