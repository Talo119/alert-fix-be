import type {
  ButtonReply,
  WhatsappWebhookBody,
} from './whatsapp-webhook.types.js';

const asArray = <T>(value: T[] | undefined): T[] =>
  Array.isArray(value) ? value : [];

/**
 * Extrae las pulsaciones de botones quick-reply de un evento de Meta:
 * `entry[].changes[]` con `field = 'messages'` y `value.messages[]` con
 * `type = 'button'`. Todo lo demás (texto, `statuses`…) se ignora.
 * Nunca lanza: un body vacío o mal formado da `[]`.
 */
export function parseButtonReplies(body: unknown): ButtonReply[] {
  if (!body || typeof body !== 'object') return [];
  const replies: ButtonReply[] = [];
  for (const entry of asArray((body as WhatsappWebhookBody).entry)) {
    for (const change of asArray(entry?.changes)) {
      if (change?.field !== 'messages') continue;
      for (const message of asArray(change.value?.messages)) {
        if (message?.type !== 'button') continue;
        const from = message.from;
        const payload = message.button?.payload;
        if (typeof from !== 'string' || typeof payload !== 'string') continue;
        replies.push({ from, payload, messageId: message.id });
      }
    }
  }
  return replies;
}
