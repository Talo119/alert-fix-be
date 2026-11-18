import { Logger } from '@nestjs/common';
import type { WhatsappConfig } from './whatsapp.config.js';
import { WhatsappApiError } from './whatsapp-api.error.js';
import { maskPhone, WhatsappService } from './whatsapp.service.js';

const cfg: WhatsappConfig = {
  accessToken: 'secret-token',
  phoneNumberId: '123456',
  apiVersion: 'v23.0',
  templateName: 'recordatorio_mantenimiento',
  templateLang: 'es',
  defaultCountryCode: '504',
};

const input = {
  to: '50499998888',
  template: 'recordatorio_mantenimiento',
  language: 'es',
  bodyParams: ['Ana', 'martes, 25 de noviembre, 9:00 a. m.', 'Mensaje'],
};

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const graphError = (status: number, code: number, message = 'error') =>
  jsonResponse(status, { error: { message, code, fbtrace_id: 'x' } });

async function caught(promise: Promise<unknown>): Promise<WhatsappApiError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(WhatsappApiError);
    return error as WhatsappApiError;
  }
  throw new Error('se esperaba un error');
}

describe('WhatsappService', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn<typeof globalThis, 'fetch'>>;
  let logs: string[];
  let service: WhatsappService;

  beforeEach(() => {
    logs = [];
    const capture = (msg: unknown) => {
      logs.push(String(msg));
    };
    vi.spyOn(Logger.prototype, 'log').mockImplementation(capture);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(capture);
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    service = new WhatsappService(cfg);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('200 → devuelve el messageId y envía la plantilla correcta', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse(200, {
        messaging_product: 'whatsapp',
        contacts: [{ input: input.to, wa_id: input.to }],
        messages: [{ id: 'wamid.ABC' }],
      }),
    );

    await expect(service.sendTemplate(input)).resolves.toEqual({
      messageId: 'wamid.ABC',
    });

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://graph.facebook.com/v23.0/123456/messages');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer secret-token',
      'Content-Type': 'application/json',
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body as string)).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '50499998888',
      type: 'template',
      template: {
        name: 'recordatorio_mantenimiento',
        language: { code: 'es' },
        components: [
          {
            type: 'body',
            parameters: input.bodyParams.map((text) => ({
              type: 'text',
              text,
            })),
          },
        ],
      },
    });
  });

  it('400 (plantilla inexistente) → no reintentable', async () => {
    fetchSpy.mockResolvedValue(
      graphError(400, 132001, 'Template name does not exist'),
    );

    const error = await caught(service.sendTemplate(input));
    expect(error).toMatchObject({
      status: 400,
      code: 132001,
      retryable: false,
    });
    expect(error.message).toContain('Template name does not exist');
  });

  it('401 (token inválido) → no reintentable', async () => {
    fetchSpy.mockResolvedValue(graphError(401, 190));
    const error = await caught(service.sendTemplate(input));
    expect(error.retryable).toBe(false);
  });

  it('incluye el subcódigo de Meta en el mensaje (token caducado)', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse(401, {
        error: {
          message: 'Session has expired',
          code: 190,
          error_subcode: 463,
        },
      }),
    );
    const error = await caught(service.sendTemplate(input));
    expect(error.message).toBe('WhatsApp 401 (#190/463): Session has expired');
    expect(error.retryable).toBe(false);
  });

  it('429 → reintentable', async () => {
    fetchSpy.mockResolvedValue(graphError(429, 4));
    const error = await caught(service.sendTemplate(input));
    expect(error).toMatchObject({ status: 429, retryable: true });
  });

  it('400 con código de throughput de Meta → reintentable', async () => {
    fetchSpy.mockResolvedValue(graphError(400, 130429));
    const error = await caught(service.sendTemplate(input));
    expect(error).toMatchObject({ status: 400, retryable: true });
  });

  it('500 sin JSON → reintentable', async () => {
    fetchSpy.mockResolvedValue(
      new Response('<html>bad gateway</html>', { status: 502 }),
    );
    const error = await caught(service.sendTemplate(input));
    expect(error).toMatchObject({ status: 502, retryable: true });
  });

  it('500 → reintentable', async () => {
    fetchSpy.mockResolvedValue(graphError(500, 131000));
    const error = await caught(service.sendTemplate(input));
    expect(error).toMatchObject({ status: 500, retryable: true });
  });

  it('timeout → reintentable', async () => {
    fetchSpy.mockRejectedValue(
      new DOMException('The operation was aborted', 'TimeoutError'),
    );
    const error = await caught(service.sendTemplate(input));
    expect(error).toMatchObject({ status: undefined, retryable: true });
  });

  it('AbortError → reintentable', async () => {
    fetchSpy.mockRejectedValue(new DOMException('aborted', 'AbortError'));
    const error = await caught(service.sendTemplate(input));
    expect(error.retryable).toBe(true);
  });

  it('error de red → reintentable', async () => {
    fetchSpy.mockRejectedValue(new TypeError('fetch failed'));
    const error = await caught(service.sendTemplate(input));
    expect(error.retryable).toBe(true);
  });

  it('2xx sin id de mensaje → no reintentable (evita duplicar)', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(200, { messages: [] }));
    const error = await caught(service.sendTemplate(input));
    expect(error.retryable).toBe(false);
  });

  it('no loguea el token y enmascara el teléfono', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(200, { messages: [{ id: 'wamid.ABC' }] }),
    );
    await service.sendTemplate(input);
    fetchSpy.mockResolvedValueOnce(graphError(400, 131026));
    await caught(service.sendTemplate(input));

    const all = logs.join('\n');
    expect(all).not.toContain('secret-token');
    expect(all).not.toContain('50499998888');
    expect(all).toContain('504****8888');
  });
});

describe('maskPhone', () => {
  it('deja visibles el prefijo y los 4 últimos dígitos', () => {
    expect(maskPhone('50499998888')).toBe('504****8888');
  });

  it('oculta del todo números cortos', () => {
    expect(maskPhone('1234')).toBe('****');
  });
});
