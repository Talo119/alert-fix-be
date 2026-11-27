import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import {
  WHATSAPP_CONFIG,
  type WhatsappConfig,
} from '../whatsapp/whatsapp.config.js';
import { parseButtonReplies } from './parse-button-replies.js';
import { WhatsappConfirmationService } from './whatsapp-confirmation.service.js';
import { WhatsappSignatureGuard } from './whatsapp-signature.guard.js';
import type { WhatsappWebhookBody } from './whatsapp-webhook.types.js';

/** Webhook que AlertFix expone a Meta (spec 13). Fuera de `/docs`: no es una API para clientes. */
@ApiExcludeController()
@Controller('whatsapp/webhook')
export class WhatsappWebhookController {
  constructor(
    private readonly confirmation: WhatsappConfirmationService,
    @Inject(WHATSAPP_CONFIG) private readonly cfg: WhatsappConfig,
  ) {}

  /** Handshake de Meta al guardar la Callback URL. */
  @Get()
  @Header('Content-Type', 'text/plain')
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ): string {
    if (mode !== 'subscribe' || token !== this.cfg.webhookVerifyToken) {
      throw new ForbiddenException();
    }
    return challenge;
  }

  /**
   * Eventos de Meta. Siempre 200 salvo firma inválida (401, guard) o error
   * inesperado (500, para que Meta reintente; el proceso es idempotente).
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  @UseGuards(WhatsappSignatureGuard)
  async receive(@Body() body: WhatsappWebhookBody): Promise<void> {
    for (const reply of parseButtonReplies(body)) {
      await this.confirmation.handle(reply); // en secuencia
    }
  }
}
