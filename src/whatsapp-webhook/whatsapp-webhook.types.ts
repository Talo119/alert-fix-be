/**
 * Forma (parcial) de los eventos que Meta envía a `POST /whatsapp/webhook`.
 * Son interfaces, no DTOs: el `ValidationPipe` global no las valida, y todo
 * campo es opcional porque el body se recorre de forma defensiva.
 * https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components
 */
export interface WhatsappWebhookBody {
  object?: string;
  entry?: WhatsappWebhookEntry[];
}

export interface WhatsappWebhookEntry {
  id?: string;
  changes?: WhatsappWebhookChange[];
}

export interface WhatsappWebhookChange {
  field?: string;
  value?: {
    messaging_product?: string;
    metadata?: { display_phone_number?: string; phone_number_id?: string };
    messages?: WhatsappIncomingMessage[];
    statuses?: unknown[];
  };
}

export interface WhatsappIncomingMessage {
  /** Teléfono del remitente, E.164 sin '+'. */
  from?: string;
  id?: string;
  type?: string;
  context?: { from?: string; id?: string };
  /** Solo en `type = 'button'` (respuesta a un quick-reply de plantilla). */
  button?: { payload?: string; text?: string };
}

/** Pulsación de un botón quick-reply, ya extraída del evento. */
export interface ButtonReply {
  from: string;
  payload: string;
  messageId: string | undefined;
}
