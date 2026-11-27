import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
  type RawBodyRequest,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  WHATSAPP_CONFIG,
  type WhatsappConfig,
} from '../whatsapp/whatsapp.config.js';

const SIGNATURE_HEADER = 'x-hub-signature-256';
const PREFIX = 'sha256=';

/**
 * Verifica `X-Hub-Signature-256: sha256=<hex>`: HMAC-SHA256 del body crudo
 * con el App Secret de Meta. Requiere `rawBody: true` en `NestFactory.create`.
 * Sin cabecera o con firma distinta → 401.
 */
@Injectable()
export class WhatsappSignatureGuard implements CanActivate {
  private readonly logger = new Logger(WhatsappSignatureGuard.name);

  constructor(@Inject(WHATSAPP_CONFIG) private readonly cfg: WhatsappConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RawBodyRequest<Request>>();
    const header = req.headers[SIGNATURE_HEADER];
    if (typeof header !== 'string' || !header.startsWith(PREFIX)) {
      this.logger.warn('Webhook de WhatsApp sin firma');
      throw new UnauthorizedException();
    }
    if (!req.rawBody) {
      // `rawBody: true` falta en main.ts: no se puede verificar nada.
      this.logger.error('Webhook de WhatsApp sin rawBody');
      throw new UnauthorizedException();
    }

    const expected = createHmac('sha256', this.cfg.appSecret)
      .update(req.rawBody)
      .digest();
    const received = Buffer.from(header.slice(PREFIX.length), 'hex');
    if (
      received.length !== expected.length ||
      !timingSafeEqual(received, expected)
    ) {
      this.logger.warn('Webhook de WhatsApp con firma inválida');
      throw new UnauthorizedException();
    }
    return true;
  }
}
