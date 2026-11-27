import { Module } from '@nestjs/common';
import { OrderHeaderModule } from '../order-header/order-header.module.js';
import { WhatsappModule } from '../whatsapp/whatsapp.module.js';
import { WhatsappConfirmationService } from './whatsapp-confirmation.service.js';
import { WhatsappSignatureGuard } from './whatsapp-signature.guard.js';
import { WhatsappWebhookController } from './whatsapp-webhook.controller.js';

@Module({
  imports: [WhatsappModule, OrderHeaderModule],
  controllers: [WhatsappWebhookController],
  providers: [WhatsappConfirmationService, WhatsappSignatureGuard],
})
export class WhatsappWebhookModule {}
