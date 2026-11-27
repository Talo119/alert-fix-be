import type { Queue } from 'bullmq';
import type { Reminder } from './reminder.types.js';

const reminders = vi.hoisted(() => {
  const chain = { where: vi.fn(), update: vi.fn() };
  chain.where.mockReturnValue(chain);
  return chain;
});

vi.mock('../prisma/db.js', () => ({
  db: { orm: { public: { Reminder: reminders } } },
}));

import { QueueReminderDispatcher } from './queue-reminder-dispatcher.js';
import {
  SEND_REMINDER_ATTEMPTS,
  SEND_REMINDER_BACKOFF_MS,
  SEND_REMINDER_JOB,
} from './reminder-queue.js';
import { ReminderStatus } from './reminder-status.js';

const reminder = (id: string): Reminder => ({
  id,
  orderId: 'order-1',
  message: `Mensaje ${id}`,
  remindAt: new Date('2026-11-17T14:00:00Z'),
  status: ReminderStatus.PENDING,
  sentAt: null,
  lastError: null,
  externalMessageId: null,
  type: 'REMINDER',
  createdAt: new Date('2026-11-01T00:00:00Z'),
  updatedAt: new Date('2026-11-01T00:00:00Z'),
});

describe('QueueReminderDispatcher', () => {
  let add: ReturnType<typeof vi.fn>;
  let getJob: ReturnType<typeof vi.fn>;
  let dispatcher: QueueReminderDispatcher;

  beforeEach(() => {
    reminders.where.mockClear();
    reminders.update.mockReset().mockResolvedValue(null);
    add = vi.fn().mockResolvedValue({});
    getJob = vi.fn().mockResolvedValue(undefined);
    dispatcher = new QueueReminderDispatcher({
      add,
      getJob,
    } as unknown as Queue);
  });

  it('encola un job por reminder con jobId = reminder.id, attempts y backoff', async () => {
    await dispatcher.dispatch([reminder('r1'), reminder('r2')]);

    expect(add).toHaveBeenCalledTimes(2);
    expect(add).toHaveBeenNthCalledWith(
      1,
      SEND_REMINDER_JOB,
      { reminderId: 'r1' },
      expect.objectContaining({
        jobId: 'r1',
        attempts: SEND_REMINDER_ATTEMPTS,
        backoff: { type: 'exponential', delay: SEND_REMINDER_BACKOFF_MS },
      }),
    );
    expect(add.mock.calls[1][2]).toMatchObject({ jobId: 'r2' });
  });

  it('marca QUEUED solo si sigue PENDING, después de encolar', async () => {
    await dispatcher.dispatch([reminder('r1')]);

    expect(reminders.where).toHaveBeenCalledWith({
      id: 'r1',
      status: ReminderStatus.PENDING,
    });
    expect(reminders.update).toHaveBeenCalledWith({
      status: ReminderStatus.QUEUED,
    });
    expect(add.mock.invocationCallOrder[0]).toBeLessThan(
      reminders.update.mock.invocationCallOrder[0],
    );
  });

  it('si add lanza, no marca QUEUED', async () => {
    add.mockRejectedValue(new Error('queue down'));

    await expect(dispatcher.dispatch([reminder('r1')])).rejects.toThrow(
      'queue down',
    );
    expect(reminders.update).not.toHaveBeenCalled();
  });

  it('elimina un job fallido con el mismo id antes de encolar', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    getJob.mockResolvedValue({
      isFailed: vi.fn().mockResolvedValue(true),
      remove,
    });

    await dispatcher.dispatch([reminder('r1')]);

    expect(getJob).toHaveBeenCalledWith('r1');
    expect(remove).toHaveBeenCalled();
    expect(remove.mock.invocationCallOrder[0]).toBeLessThan(
      add.mock.invocationCallOrder[0],
    );
  });

  it('no elimina un job que no ha fallado (dedup)', async () => {
    const remove = vi.fn();
    getJob.mockResolvedValue({
      isFailed: vi.fn().mockResolvedValue(false),
      remove,
    });

    await dispatcher.dispatch([reminder('r1')]);

    expect(remove).not.toHaveBeenCalled();
    expect(add).toHaveBeenCalled();
  });
});
