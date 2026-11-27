import { UnrecoverableError } from 'bullmq';
import type { WhatsappConfig } from '../whatsapp/whatsapp.config.js';
import { WhatsappApiError } from '../whatsapp/whatsapp-api.error.js';
import type { WhatsappService } from '../whatsapp/whatsapp.service.js';
import { ReminderStatus } from './reminder-status.js';
import { ReminderType } from './reminder-type.js';
import type { Client, ReminderWithClient } from './reminder.types.js';

vi.hoisted(() => {
  process.env.REMINDER_TZ = 'America/Tegucigalpa';
});

import { WhatsappReminderSender } from './whatsapp-reminder-sender.js';

const cfg: WhatsappConfig = {
  accessToken: 'token',
  phoneNumberId: '123',
  apiVersion: 'v23.0',
  templateName: 'recordatorio_mantenimiento',
  confirmationTemplateName: 'confirmacion_proximo_servicio',
  templateLang: 'es',
  defaultCountryCode: '504',
};

const baseClient: Client = {
  id: 'c1',
  name: 'Ana López',
  email: 'ana@example.com',
  phoneNumber: '+504 9999-8888',
  companyId: null,
  active: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

const reminder = (
  client: Partial<Client> | null = {},
  message = 'Cambio de filtro',
): ReminderWithClient => ({
  id: 'r1',
  orderId: 'o1',
  message,
  remindAt: new Date('2026-11-24T14:00:00Z'),
  status: ReminderStatus.QUEUED,
  sentAt: null,
  lastError: null,
  externalMessageId: null,
  type: ReminderType.REMINDER,
  createdAt: new Date('2026-11-01T00:00:00Z'),
  updatedAt: new Date('2026-11-01T00:00:00Z'),
  order: {
    id: 'o1',
    clientId: 'c1',
    companyId: null,
    // 09:00 en Tegucigalpa (UTC-6)
    serviceDate: new Date('2026-11-25T15:00:00Z'),
    nextServiceDate: null,
    status: 'OPEN',
    createdAt: new Date('2026-11-01T00:00:00Z'),
    updatedAt: new Date('2026-11-01T00:00:00Z'),
    client: client ? { ...baseClient, ...client } : null,
  },
});

describe('WhatsappReminderSender', () => {
  let sendTemplate: ReturnType<typeof vi.fn>;
  let sender: WhatsappReminderSender;

  beforeEach(() => {
    sendTemplate = vi.fn().mockResolvedValue({ messageId: 'wamid.ABC' });
    sender = new WhatsappReminderSender(
      { sendTemplate } as unknown as WhatsappService,
      cfg,
    );
  });

  it('envía la plantilla y devuelve el wamid', async () => {
    await expect(sender.send(reminder())).resolves.toEqual({
      externalMessageId: 'wamid.ABC',
    });
    expect(sendTemplate).toHaveBeenCalledWith({
      to: '50499998888',
      template: 'recordatorio_mantenimiento',
      language: 'es',
      bodyParams: [
        'Ana López',
        'miércoles, 25 de noviembre, 9:00 a. m.',
        'Cambio de filtro',
      ],
    });
  });

  describe('CONFIRMATION', () => {
    const confirmation = (nextServiceDate: Date | null): ReminderWithClient => {
      const base = reminder({}, 'Responde para confirmar');
      return {
        ...base,
        type: ReminderType.CONFIRMATION,
        order: base.order && { ...base.order, nextServiceDate },
      };
    };

    it('usa la plantilla de confirmación y nextServiceDate en {{2}}', async () => {
      // 10:00 en Tegucigalpa (UTC-6)
      await sender.send(confirmation(new Date('2027-02-25T16:00:00Z')));
      expect(sendTemplate).toHaveBeenCalledWith({
        to: '50499998888',
        template: 'confirmacion_proximo_servicio',
        language: 'es',
        bodyParams: [
          'Ana López',
          'jueves, 25 de febrero, 10:00 a. m.',
          'Responde para confirmar',
        ],
      });
    });

    it('sin nextServiceDate → UnrecoverableError sin enviar', async () => {
      await expect(sender.send(confirmation(null))).rejects.toBeInstanceOf(
        UnrecoverableError,
      );
      expect(sendTemplate).not.toHaveBeenCalled();
    });
  });

  it('antepone el código de país a números locales', async () => {
    await sender.send(reminder({ phoneNumber: '99998888' }));
    expect(sendTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ to: '50499998888' }),
    );
  });

  it('sanea los parámetros', async () => {
    await sender.send(
      reminder({ name: ' Ana\tLópez ' }, 'Línea 1\nLínea 2      fin'),
    );
    const { bodyParams } = sendTemplate.mock.calls[0][0] as {
      bodyParams: string[];
    };
    expect(bodyParams[0]).toBe('Ana López');
    expect(bodyParams[2]).toBe('Línea 1 Línea 2 fin');
  });

  it.each([
    ['sin teléfono', { phoneNumber: null }],
    ['teléfono inválido', { phoneNumber: '123' }],
    ['cliente inactivo', { active: false }],
  ])('%s → UnrecoverableError sin enviar', async (_, client) => {
    await expect(sender.send(reminder(client))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it('sin cliente → UnrecoverableError', async () => {
    await expect(sender.send(reminder(null))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });

  it('sin orden → UnrecoverableError', async () => {
    await expect(
      sender.send({ ...reminder(), order: null }),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('error no reintentable de la API → UnrecoverableError', async () => {
    sendTemplate.mockRejectedValue(
      new WhatsappApiError('WhatsApp 400 (#132001): plantilla', {
        status: 400,
        code: 132001,
        retryable: false,
      }),
    );
    const promise = sender.send(reminder());
    await expect(promise).rejects.toBeInstanceOf(UnrecoverableError);
    await expect(promise).rejects.toThrow('WhatsApp 400 (#132001): plantilla');
  });

  it('error reintentable de la API → error normal (BullMQ reintenta)', async () => {
    const apiError = new WhatsappApiError('WhatsApp 500', {
      status: 500,
      retryable: true,
    });
    sendTemplate.mockRejectedValue(apiError);

    const error: unknown = await sender.send(reminder()).catch((e) => e);
    expect(error).toBe(apiError);
    expect(error).not.toBeInstanceOf(UnrecoverableError);
  });
});
