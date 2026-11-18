/**
 * Códigos de error de la Cloud API que son temporales aunque lleguen con un
 * `4xx` (sobre todo `400`): límites de throughput y fallos del lado de Meta.
 * https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
 */
const RETRYABLE_META_CODES = new Set([
  1, // API Unknown: solicitud inválida o posible error del servidor
  2, // API Service: servicio no disponible temporalmente
  4, // Too many calls: límite de llamadas de la app
  80007, // Rate limit de la cuenta de WhatsApp Business
  130429, // Rate limit hit: throughput del número
  131000, // Something went wrong
  131016, // Service unavailable
  131056, // Pair rate limit: demasiados mensajes al mismo destinatario
  133004, // Server temporarily unavailable
]);

export interface WhatsappApiErrorInit {
  /** Estado HTTP; `undefined` si no hubo respuesta (timeout, error de red). */
  status?: number;
  /** Código de error de Meta (`error.code`), si la respuesta lo trae. */
  code?: number;
  retryable: boolean;
  cause?: unknown;
}

export class WhatsappApiError extends Error {
  readonly status?: number;
  readonly code?: number;
  readonly retryable: boolean;

  constructor(message: string, init: WhatsappApiErrorInit) {
    super(message, { cause: init.cause });
    this.name = 'WhatsappApiError';
    this.status = init.status;
    this.code = init.code;
    this.retryable = init.retryable;
  }
}

/** `429`, `5xx` y los códigos de Meta temporales se reintentan; el resto de `4xx`, no. */
export function isRetryable(status: number, code?: number): boolean {
  if (status === 429 || status >= 500) return true;
  return code !== undefined && RETRYABLE_META_CODES.has(code);
}
