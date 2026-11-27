/**
 * Payload del botón quick-reply "Confirmar" de los reminders `CONFIRMATION`
 * (spec 13). Lo genera el backend al enviar y lo devuelve Meta en el webhook.
 */
const CONFIRM_PREFIX = 'CONFIRM:';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const confirmPayload = (reminderId: string) =>
  `${CONFIRM_PREFIX}${reminderId}`;

/** `CONFIRM:<uuid>` → `<uuid>`; cualquier otra cosa → `null`. */
export function parseConfirmPayload(
  payload: string | undefined,
): string | null {
  if (!payload?.startsWith(CONFIRM_PREFIX)) return null;
  const id = payload.slice(CONFIRM_PREFIX.length);
  return UUID.test(id) ? id : null;
}
