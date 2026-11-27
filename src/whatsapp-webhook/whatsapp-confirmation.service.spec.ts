import { Logger } from '@nestjs/common';
import type { OrderHeaderService } from '../order-header/order-header.service.js';
import { OrderStatus } from '../order-header/order-status.js';
import { ReminderType } from '../reminder/reminder-type.js';
import type { WhatsappConfig } from '../whatsapp/whatsapp.config.js';
import { WhatsappApiError } from '../whatsapp/whatsapp-api.error.js';
import type { WhatsappService } from '../whatsapp/whatsapp.service.js';

const { reminderIncluded, reminderModel } = vi.hoisted(() => {
  process.env.REMINDER_TZ = 'America/Tegucigalpa';
  const reminderIncluded = { first: vi.fn() };
  const reminderModel = { include: vi.fn(() => reminderIncluded) };
  return { reminderIncluded, reminderModel };
});

vi.mock('../prisma/db.js', () => ({
  db: { orm: { public: { Reminder: reminderModel } } },
}));

import { WhatsappConfirmationService } from './whatsapp-confirmation.service.js';

const cfg = { defaultCountryCode: '504' } as WhatsappConfig;
const reminderId = '6f1c2b1e-4c8a-4f5e-9a51-3b0b9d5f2a10';
const orderId = 'a1b2c3d4-1234-4abc-8def-0123456789ab';
const from = '50499998888';
const payload = `CONFIRM:${reminderId}`;

const client = {
  id: 'c1',
  name: 'Ana López',
  phoneNumber: '+504 9999-8888',
  active: true,
};
const reminder = (overrides: object = {}, clientOverrides: object = {}) => ({
  id: reminderId,
  orderId,
  type: ReminderType.CONFIRMATION,
  status: 'SENT',
  order: {
    id: orderId,
    status: OrderStatus.COMPLETED,
    client: { ...client, ...clientOverrides },
  },
  ...overrides,
});
const followUp = {
  id: 'f1',
  // 10:00 en Tegucigalpa (UTC-6)
  serviceDate: new Date('2027-02-25T16:00:00Z'),
};
const DATE = 'jueves, 25 de febrero, 10:00 a. m.';

describe('WhatsappConfirmationService', () => {
  let createFollowUp: ReturnType<typeof vi.fn>;
  let sendText: ReturnType<typeof vi.fn>;
  let warn: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;
  let service: WhatsappConfirmationService;

  beforeEach(() => {
    vi.clearAllMocks();
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    createFollowUp = vi.fn().mockResolvedValue({
      order: followUp,
      created: true,
    });
    sendText = vi.fn().mockResolvedValue({ messageId: 'wamid.OUT' });
    reminderIncluded.first.mockResolvedValue(reminder());
    service = new WhatsappConfirmationService(
      { createFollowUp } as unknown as OrderHeaderService,
      { sendText } as unknown as WhatsappService,
      cfg,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('crea la orden y responde con la fecha agendada', async () => {
    await service.handle({ from, payload, messageId: 'wamid.IN' });

    expect(reminderModel.include).toHaveBeenCalledWith(
      'order',
      expect.any(Function),
    );
    expect(reminderIncluded.first).toHaveBeenCalledWith({ id: reminderId });
    expect(createFollowUp).toHaveBeenCalledWith(orderId);
    expect(sendText).toHaveBeenCalledWith(
      from,
      `¡Listo, Ana López! Agendamos tu mantenimiento para el ${DATE}`,
    );
  });

  it('duplicada → responde "ya está agendado" con la fecha de la orden existente', async () => {
    createFollowUp.mockResolvedValue({ order: followUp, created: false });

    await service.handle({ from, payload, messageId: undefined });
    expect(sendText).toHaveBeenCalledWith(
      from,
      `Ana López, tu mantenimiento ya está agendado para el ${DATE}`,
    );
  });

  it('acepta un reminder ya SENT y un teléfono local del cliente', async () => {
    reminderIncluded.first.mockResolvedValue(
      reminder({ status: 'SENT' }, { phoneNumber: '9999-8888' }),
    );
    await service.handle({ from, payload, messageId: undefined });
    expect(createFollowUp).toHaveBeenCalled();
  });

  const ignored = (label: string, setup: () => void, logs = true) =>
    it(`${label} → se ignora`, async () => {
      setup();
      await service.handle({ from, payload, messageId: undefined });
      expect(createFollowUp).not.toHaveBeenCalled();
      expect(sendText).not.toHaveBeenCalled();
      if (logs) expect(warn).toHaveBeenCalled();
    });

  describe('rechazos', () => {
    it.each([['OTRO:x'], ['CONFIRM:no-uuid'], ['']])(
      'payload %j → se ignora sin consultar la BD',
      async (p) => {
        await service.handle({ from, payload: p, messageId: undefined });
        expect(reminderIncluded.first).not.toHaveBeenCalled();
        expect(createFollowUp).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalled();
      },
    );

    ignored('reminder inexistente', () =>
      reminderIncluded.first.mockResolvedValue(null),
    );
    ignored('type = REMINDER', () =>
      reminderIncluded.first.mockResolvedValue(
        reminder({ type: ReminderType.REMINDER }),
      ),
    );
    ignored('reminder sin orderId', () =>
      reminderIncluded.first.mockResolvedValue(reminder({ orderId: null })),
    );
    ignored('orden sin cliente', () =>
      reminderIncluded.first.mockResolvedValue(
        reminder({ order: { id: orderId, client: null } }),
      ),
    );
    ignored('cliente inactivo', () =>
      reminderIncluded.first.mockResolvedValue(reminder({}, { active: false })),
    );
    ignored('cliente sin teléfono', () =>
      reminderIncluded.first.mockResolvedValue(
        reminder({}, { phoneNumber: null }),
      ),
    );

    it('remitente distinto → se ignora y no loguea el teléfono completo', async () => {
      await service.handle({
        from: '50488887777',
        payload,
        messageId: undefined,
      });
      expect(createFollowUp).not.toHaveBeenCalled();
      const logged = warn.mock.calls.map((c) => String(c[0])).join('\n');
      expect(logged).not.toContain('50488887777');
      expect(logged).toContain('504****7777');
    });

    it('createFollowUp → null: no responde', async () => {
      createFollowUp.mockResolvedValue(null);
      await service.handle({ from, payload, messageId: undefined });
      expect(sendText).not.toHaveBeenCalled();
    });
  });

  it('si sendText falla no propaga (la orden ya está creada)', async () => {
    sendText.mockRejectedValue(
      new WhatsappApiError('WhatsApp 400 (#131047)', {
        status: 400,
        code: 131047,
        retryable: false,
      }),
    );
    await expect(
      service.handle({ from, payload, messageId: undefined }),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
  });

  it('error de BD al leer el reminder → propaga', async () => {
    reminderIncluded.first.mockRejectedValue(new Error('connection refused'));
    await expect(
      service.handle({ from, payload, messageId: undefined }),
    ).rejects.toThrow('connection refused');
  });

  it('error de BD en createFollowUp → propaga', async () => {
    createFollowUp.mockRejectedValue(new Error('connection refused'));
    await expect(
      service.handle({ from, payload, messageId: undefined }),
    ).rejects.toThrow('connection refused');
    expect(sendText).not.toHaveBeenCalled();
  });
});
