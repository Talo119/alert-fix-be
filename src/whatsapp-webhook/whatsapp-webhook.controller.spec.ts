import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import {
  WHATSAPP_CONFIG,
  type WhatsappConfig,
} from '../whatsapp/whatsapp.config.js';
import { WhatsappConfirmationService } from './whatsapp-confirmation.service.js';
import { WhatsappSignatureGuard } from './whatsapp-signature.guard.js';
import { WhatsappWebhookController } from './whatsapp-webhook.controller.js';

// El servicio real importa `db`; aquí se sustituye entero.
vi.mock('../prisma/db.js', () => ({ db: {} }));

const cfg = {
  appSecret: 'app-secret',
  webhookVerifyToken: 'verify-token',
} as WhatsappConfig;

const sign = (body: string, secret = cfg.appSecret) =>
  `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

const button = (from: string, payload: string) => ({
  from,
  id: `wamid.${payload}`,
  type: 'button',
  button: { payload, text: 'Confirmar' },
});

const eventBody = JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'WABA_ID',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { phone_number_id: 'PHONE_NUMBER_ID' },
            messages: [
              button('50499998888', 'CONFIRM:a'),
              {
                from: '50499998888',
                id: 'wamid.T',
                type: 'text',
                text: { body: 'Hola' },
              },
              button('50477776666', 'CONFIRM:b'),
            ],
          },
        },
      ],
    },
  ],
});

describe('WhatsappWebhookController', () => {
  let app: INestApplication;
  const handle = vi.fn();

  beforeEach(async () => {
    handle.mockReset().mockResolvedValue(undefined);
    const moduleRef = await Test.createTestingModule({
      controllers: [WhatsappWebhookController],
      providers: [
        WhatsappSignatureGuard,
        { provide: WHATSAPP_CONFIG, useValue: cfg },
        { provide: WhatsappConfirmationService, useValue: { handle } },
      ],
    }).compile();
    // Igual que src/main.ts.
    app = moduleRef.createNestApplication({ rawBody: true, logger: false });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /whatsapp/webhook', () => {
    it('token correcto → devuelve hub.challenge en texto plano', async () => {
      const res = await request(app.getHttpServer())
        .get('/whatsapp/webhook')
        .query({
          'hub.mode': 'subscribe',
          'hub.verify_token': 'verify-token',
          'hub.challenge': '1158201444',
        })
        .expect(200);
      expect(res.text).toBe('1158201444');
      expect(res.headers['content-type']).toMatch(/^text\/plain/);
    });

    it.each([
      [
        'token incorrecto',
        { 'hub.mode': 'subscribe', 'hub.verify_token': 'otro' },
      ],
      [
        'mode distinto',
        { 'hub.mode': 'unsubscribe', 'hub.verify_token': 'verify-token' },
      ],
      ['sin parámetros', {}],
    ])('%s → 403', async (_, query) => {
      await request(app.getHttpServer())
        .get('/whatsapp/webhook')
        .query({ ...query, 'hub.challenge': '123' })
        .expect(403);
    });
  });

  describe('POST /whatsapp/webhook', () => {
    const post = (body: string, signature?: string) => {
      const req = request(app.getHttpServer())
        .post('/whatsapp/webhook')
        .set('Content-Type', 'application/json');
      if (signature !== undefined) req.set('X-Hub-Signature-256', signature);
      return req.send(body);
    };

    it('firmado → 200 y handle por cada botón, en orden', async () => {
      await post(eventBody, sign(eventBody)).expect(200);
      expect(handle).toHaveBeenCalledTimes(2);
      expect(handle).toHaveBeenNthCalledWith(1, {
        from: '50499998888',
        payload: 'CONFIRM:a',
        messageId: 'wamid.CONFIRM:a',
      });
      expect(handle).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ payload: 'CONFIRM:b' }),
      );
    });

    it('statuses o body vacío firmados → 200 sin efectos', async () => {
      const statuses = JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [
          {
            changes: [
              { field: 'messages', value: { statuses: [{ status: 'read' }] } },
            ],
          },
        ],
      });
      await post(statuses, sign(statuses)).expect(200);
      await post('{}', sign('{}')).expect(200);
      expect(handle).not.toHaveBeenCalled();
    });

    it.each([
      ['sin firma', undefined],
      ['firma incorrecta', 'sha256=00'],
      ['firma con otro secreto', sign(eventBody, 'otro-secreto')],
      ['sin prefijo sha256=', sign(eventBody).slice('sha256='.length)],
      ['hex inválido', 'sha256=zz'],
    ])('%s → 401 sin llamar a handle', async (_, signature) => {
      await post(eventBody, signature).expect(401);
      expect(handle).not.toHaveBeenCalled();
    });

    it('firma de otro body (body alterado) → 401', async () => {
      const tampered = eventBody.replace('CONFIRM:a', 'CONFIRM:c');
      await post(tampered, sign(eventBody)).expect(401);
      expect(handle).not.toHaveBeenCalled();
    });

    it('error inesperado en handle → 500 (Meta reintenta)', async () => {
      handle.mockRejectedValueOnce(new Error('connection refused'));
      await post(eventBody, sign(eventBody)).expect(500);
    });
  });
});
