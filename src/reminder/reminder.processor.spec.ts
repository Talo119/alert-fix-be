import { Logger } from '@nestjs/common';
import { UnrecoverableError, type Job } from 'bullmq';
import type { SendReminderJobData } from './reminder-queue.js';
import type { ReminderSender } from './reminder-sender.js';
import type { ReminderWithClient } from './reminder.types.js';

const reminders = vi.hoisted(() => {
  const chain = {
    include: vi.fn(),
    where: vi.fn(),
    first: vi.fn(),
    update: vi.fn(),
  };
  chain.include.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  return chain;
});

vi.mock('../prisma/db.js', () => ({
  db: { orm: { public: { Reminder: reminders } } },
}));

import { ReminderProcessor } from './reminder.processor.js';
import { ReminderStatus } from './reminder-status.js';

const reminderWithClient = (
  status: ReminderStatus = ReminderStatus.QUEUED,
): ReminderWithClient => ({
  id: 'r1',
  orderId: 'order-1',
  message: 'Mensaje',
  remindAt: new Date('2026-11-17T14:00:00Z'),
  status,
  sentAt: null,
  lastError: null,
  externalMessageId: null,
  createdAt: new Date('2026-11-01T00:00:00Z'),
  updatedAt: new Date('2026-11-01T00:00:00Z'),
  order: null,
});

const job = (attemptsMade = 0, attempts = 5) =>
  ({
    data: { reminderId: 'r1' },
    attemptsMade,
    opts: { attempts },
  }) as unknown as Job<SendReminderJobData>;

describe('ReminderProcessor', () => {
  let send: ReturnType<typeof vi.fn>;
  let processor: ReminderProcessor;

  beforeAll(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  beforeEach(() => {
    reminders.include.mockClear();
    reminders.where.mockClear();
    reminders.first.mockReset();
    reminders.update.mockReset().mockResolvedValue(null);
    send = vi.fn().mockResolvedValue({});
    processor = new ReminderProcessor({ send } as unknown as ReminderSender);
  });

  describe('process', () => {
    it('envía y marca SENT con sentAt y externalMessageId', async () => {
      const r = reminderWithClient();
      reminders.first.mockResolvedValue(r);
      send.mockResolvedValue({ externalMessageId: 'wamid.ABC' });

      await processor.process(job());

      expect(reminders.first).toHaveBeenCalledWith({ id: 'r1' });
      expect(send).toHaveBeenCalledWith(r);
      expect(reminders.where).toHaveBeenCalledWith({ id: 'r1' });
      expect(reminders.update).toHaveBeenCalledWith({
        status: ReminderStatus.SENT,
        sentAt: expect.any(Date) as Date,
        lastError: null,
        externalMessageId: 'wamid.ABC',
      });
    });

    it('sin externalMessageId guarda null', async () => {
      reminders.first.mockResolvedValue(reminderWithClient());

      await processor.process(job());

      expect(reminders.update).toHaveBeenCalledWith(
        expect.objectContaining({ externalMessageId: null }),
      );
    });

    it('carga la orden con su cliente', async () => {
      reminders.first.mockResolvedValue(reminderWithClient());
      await processor.process(job());

      expect(reminders.include).toHaveBeenCalledWith(
        'order',
        expect.any(Function),
      );
      const refine = reminders.include.mock.calls[0][1] as (
        o: unknown,
      ) => unknown;
      const nested = { include: vi.fn() };
      refine(nested);
      expect(nested.include).toHaveBeenCalledWith('client');
    });

    it('si ya está SENT no vuelve a enviar', async () => {
      reminders.first.mockResolvedValue(
        reminderWithClient(ReminderStatus.SENT),
      );

      await processor.process(job());

      expect(send).not.toHaveBeenCalled();
      expect(reminders.update).not.toHaveBeenCalled();
    });

    it('si el reminder no existe lanza UnrecoverableError', async () => {
      reminders.first.mockResolvedValue(null);

      await expect(processor.process(job())).rejects.toBeInstanceOf(
        UnrecoverableError,
      );
      expect(send).not.toHaveBeenCalled();
    });

    it('si el envío falla propaga el error y no marca SENT', async () => {
      reminders.first.mockResolvedValue(reminderWithClient());
      send.mockRejectedValue(new Error('timeout'));

      await expect(processor.process(job())).rejects.toThrow('timeout');
      expect(reminders.update).not.toHaveBeenCalled();
    });
  });

  describe('onFailed', () => {
    it('con intentos restantes solo guarda lastError', async () => {
      await processor.onFailed(job(2), new Error('timeout'));

      expect(reminders.where).toHaveBeenCalledWith({ id: 'r1' });
      expect(reminders.update).toHaveBeenCalledWith({ lastError: 'timeout' });
    });

    it('en el último intento marca FAILED', async () => {
      await processor.onFailed(job(5), new Error('timeout'));

      expect(reminders.update).toHaveBeenCalledWith({
        lastError: 'timeout',
        status: ReminderStatus.FAILED,
      });
    });

    it('con UnrecoverableError marca FAILED aunque queden intentos', async () => {
      await processor.onFailed(job(1), new UnrecoverableError('no existe'));

      expect(reminders.update).toHaveBeenCalledWith({
        lastError: 'no existe',
        status: ReminderStatus.FAILED,
      });
    });

    it('recorta lastError a 1000 caracteres', async () => {
      await processor.onFailed(job(1), new Error('x'.repeat(2000)));

      const data = reminders.update.mock.calls[0][0] as { lastError: string };
      expect(data.lastError).toHaveLength(1000);
    });

    it('sin job no hace nada', async () => {
      await processor.onFailed(undefined, new Error('x'));
      expect(reminders.update).not.toHaveBeenCalled();
    });

    it('si el update falla no lanza', async () => {
      reminders.update.mockRejectedValue(new Error('db down'));

      await expect(
        processor.onFailed(job(5), new Error('timeout')),
      ).resolves.toBeUndefined();
    });
  });
});
