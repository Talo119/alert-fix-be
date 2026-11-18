import { Module } from '@nestjs/common';
import { loadWhatsappConfig, WHATSAPP_CONFIG } from './whatsapp.config.js';
import { WhatsappService } from './whatsapp.service.js';

@Module({
  providers: [
    // Se valida al crear el módulo: si falta una variable, la app no arranca.
    { provide: WHATSAPP_CONFIG, useFactory: () => loadWhatsappConfig() },
    WhatsappService,
  ],
  exports: [WHATSAPP_CONFIG, WhatsappService],
})
export class WhatsappModule {}
