import type { Mock } from 'vitest';
import type { Reminder } from './reminder.types.js';

// TZ y CRON se leen al importar el servicio: fijarlos antes de cualquier import.
const query = vi.hoisted(() => {
  process.env.REMINDER_TZ = 'America/Tegucigalpa';
  const chain = {
    where: vi.fn(),
    orderBy: vi.fn(),
    all: vi.fn(),
  };
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  return chain;
});

vi.mock('../prisma/db.js', () => ({
  db: { orm: { public: { Reminder: query } } },
}));

import { ReminderSchedulerService } from './reminder-scheduler.service.js';
import { ReminderStatus } from './reminder-status.js';

const reminder = (id: string, remindAt: string): Reminder => ({
  id,
  orderId: 'order-1',
  message: `Mensaje ${id}`,
  remindAt: new Date(remindAt),
  status: ReminderStatus.PENDING,
  sentAt: null,
  lastError: null,
  createdAt: new Date('2026-11-01T00:00:00Z'),
  updatedAt: new Date('2026-11-01T00:00:00Z'),
});

/** Ejecuta el callback del `.where` de fechas sobre un proxy falso y devuelve el `until`. */
function untilPassedToQuery(): Date {
  const dateFilter = query.where.mock.calls[1][0] as (r: unknown) => unknown;
  const lt = vi.fn();
  dateFilter({ remindAt: { lt } });
  expect(lt).toHaveBeenCalledTimes(1);
  return lt.mock.calls[0][0] as Date;
}

describe('ReminderSchedulerService', () => {
  let dispatch: Mock<(reminders: Reminder[]) => Promise<void>>;
  let service: ReminderSchedulerService;

  beforeEach(() => {
    query.where.mockClear();
    query.orderBy.mockClear();
    query.all.mockReset();
    dispatch = vi.fn().mockResolvedValue(undefined);
    service = new ReminderSchedulerService({ dispatch });
  });

  it('sin pendientes no llama a dispatch y devuelve 0', async () => {
    query.all.mockResolvedValue([]);

    await expect(service.processDueReminders()).resolves.toBe(0);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('con pendientes llama a dispatch una vez con todos', async () => {
    const due = [
      reminder('r1', '2026-11-15T14:00:00Z'),
      reminder('r2', '2026-11-17T14:00:00Z'),
    ];
    query.all.mockResolvedValue(due);

    await expect(service.processDueReminders()).resolves.toBe(2);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(due);
  });

  it('filtra por PENDING y ordena por remindAt ascendente', async () => {
    query.all.mockResolvedValue([]);

    await service.processDueReminders();

    expect(query.where).toHaveBeenNthCalledWith(1, {
      status: ReminderStatus.PENDING,
    });
    const order = query.orderBy.mock.calls[0][0] as (r: unknown) => unknown;
    const asc = vi.fn();
    order({ remindAt: { asc } });
    expect(asc).toHaveBeenCalledTimes(1);
  });

  it('pasa until = inicio del día siguiente según REMINDER_TZ', async () => {
    query.all.mockResolvedValue([]);

    // 2026-11-16 23:30 en Tegucigalpa (UTC-6) = 2026-11-17 05:30 UTC
    await service.processDueReminders(new Date('2026-11-17T05:30:00Z'));

    expect(untilPassedToQuery()).toEqual(new Date('2026-11-17T06:00:00Z'));
  });

  it('no se traga los errores de la base de datos', async () => {
    query.all.mockRejectedValue(new Error('db down'));

    await expect(service.processDueReminders()).rejects.toThrow('db down');
    expect(dispatch).not.toHaveBeenCalled();
  });
});
