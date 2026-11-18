import { Inject, Injectable, Logger } from '@nestjs/common';
import { WHATSAPP_CONFIG, type WhatsappConfig } from './whatsapp.config.js';
import { isRetryable, WhatsappApiError } from './whatsapp-api.error.js';

const REQUEST_TIMEOUT_MS = 10_000;

export interface SendTemplateInput {
  /** E.164 sin '+', p. ej. '50499998888'. */
  to: string;
  template: string;
  language: string;
  bodyParams: string[];
}

interface GraphErrorBody {
  error?: { message?: string; code?: number; error_subcode?: number };
}

interface SendMessageResponse {
  messages?: { id?: string }[];
}

/** `50499998888` → `504****8888`. */
export function maskPhone(phone: string): string {
  if (phone.length <= 7) return '****';
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

/** Cliente mínimo de la WhatsApp Cloud API (Meta), con `fetch` nativo. */
@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(@Inject(WHATSAPP_CONFIG) private readonly cfg: WhatsappConfig) {}

  /**
   * Envía un mensaje de plantilla. Lanza `WhatsappApiError`; su `retryable`
   * indica si tiene sentido reintentar.
   */
  async sendTemplate(input: SendTemplateInput): Promise<{ messageId: string }> {
    const url = `https://graph.facebook.com/${this.cfg.apiVersion}/${this.cfg.phoneNumberId}/messages`;
    const masked = maskPhone(input.to);

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.cfg.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: input.to,
          type: 'template',
          template: {
            name: input.template,
            language: { code: input.language },
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
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      // Timeout (TimeoutError/AbortError) o error de red: sin respuesta de Meta.
      const reason = error instanceof Error ? error.name : 'Error';
      throw new WhatsappApiError(
        `WhatsApp: sin respuesta de la API (${reason})`,
        { retryable: true, cause: error },
      );
    }

    const body = await this.readJson(res);

    if (!res.ok) {
      const {
        message,
        code,
        error_subcode: subcode,
      } = (body as GraphErrorBody | null)?.error ?? {};
      const retryable = isRetryable(res.status, code);
      // p. ej. `#190/463` = token caducado; el subcódigo distingue la causa.
      const ref =
        code === undefined
          ? ''
          : ` (#${code}${subcode !== undefined ? `/${subcode}` : ''})`;
      this.logger.warn(`WhatsApp ${res.status}${ref} enviando a ${masked}`);
      throw new WhatsappApiError(
        `WhatsApp ${res.status}${ref}: ${message ?? res.statusText ?? 'error'}`,
        { status: res.status, code, retryable },
      );
    }

    const messageId = (body as SendMessageResponse | null)?.messages?.[0]?.id;
    if (!messageId) {
      // Meta aceptó la petición: reintentar podría duplicar el mensaje.
      throw new WhatsappApiError(
        `WhatsApp ${res.status}: respuesta sin id de mensaje`,
        { status: res.status, retryable: false },
      );
    }

    this.logger.log(`WhatsApp enviado a ${masked} (${messageId})`);
    return { messageId };
  }

  private async readJson(res: Response): Promise<unknown> {
    try {
      return await res.json();
    } catch {
      return null; // p. ej. un 502 con HTML de un proxy
    }
  }
}
