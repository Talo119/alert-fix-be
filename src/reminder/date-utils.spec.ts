import { startOfNextDay } from './date-utils.js';

const iso = (s: string) => new Date(s);

describe('startOfNextDay', () => {
  describe('UTC', () => {
    it('devuelve la medianoche UTC del día siguiente', () => {
      expect(startOfNextDay(iso('2026-11-17T10:15:00Z'), 'UTC')).toEqual(
        iso('2026-11-18T00:00:00Z'),
      );
    });

    it('justo antes de medianoche sigue siendo el mismo día', () => {
      expect(startOfNextDay(iso('2026-11-17T23:59:59.999Z'), 'UTC')).toEqual(
        iso('2026-11-18T00:00:00Z'),
      );
    });

    it('a medianoche exacta salta al día siguiente', () => {
      expect(startOfNextDay(iso('2026-11-18T00:00:00Z'), 'UTC')).toEqual(
        iso('2026-11-19T00:00:00Z'),
      );
    });

    it('cruza fin de mes y de año', () => {
      expect(startOfNextDay(iso('2026-12-31T12:00:00Z'), 'UTC')).toEqual(
        iso('2027-01-01T00:00:00Z'),
      );
    });
  });

  describe('America/Tegucigalpa (UTC-6)', () => {
    const tz = 'America/Tegucigalpa';

    it('a media mañana local devuelve 06:00 UTC del día siguiente', () => {
      // 2026-11-17 10:00 local = 16:00 UTC
      expect(startOfNextDay(iso('2026-11-17T16:00:00Z'), tz)).toEqual(
        iso('2026-11-18T06:00:00Z'),
      );
    });

    it('23:30 local (05:30 UTC del día siguiente) sigue siendo el día local', () => {
      // 2026-11-16 23:30 local = 2026-11-17 05:30 UTC
      expect(startOfNextDay(iso('2026-11-17T05:30:00Z'), tz)).toEqual(
        iso('2026-11-17T06:00:00Z'),
      );
    });

    it('00:30 local ya es el día siguiente', () => {
      // 2026-11-17 00:30 local = 06:30 UTC
      expect(startOfNextDay(iso('2026-11-17T06:30:00Z'), tz)).toEqual(
        iso('2026-11-18T06:00:00Z'),
      );
    });
  });

  describe('zona con horario de verano (America/New_York)', () => {
    const tz = 'America/New_York';

    it('víspera del cambio a verano: medianoche aún en EST (UTC-5)', () => {
      // 2026-03-07 12:00 EST; el cambio es el 2026-03-08 a las 02:00
      expect(startOfNextDay(iso('2026-03-07T17:00:00Z'), tz)).toEqual(
        iso('2026-03-08T05:00:00Z'),
      );
    });

    it('víspera del fin del verano: medianoche aún en EDT (UTC-4)', () => {
      // 2026-10-31 12:00 EDT; el cambio es el 2026-11-01 a las 02:00
      expect(startOfNextDay(iso('2026-10-31T16:00:00Z'), tz)).toEqual(
        iso('2026-11-01T04:00:00Z'),
      );
    });

    it('día del fin del verano: medianoche siguiente en EST', () => {
      expect(startOfNextDay(iso('2026-11-01T16:00:00Z'), tz)).toEqual(
        iso('2026-11-02T05:00:00Z'),
      );
    });
  });
});
