# Spec 03 — Envío de reminders por WhatsApp (Meta Cloud API)

> Etapa 3 de 3 del envío de reminders por WhatsApp.
> Anteriores: [01 — Cron diario](./01-reminders-cron.md) · [02 — Cola BullMQ](./02-reminders-queue-bullmq.md)

## Contexto

Tras el spec 02, el worker de BullMQ procesa cada reminder y llama a `ReminderSender.send()`, que por ahora solo loguea. Este spec implementa el envío real por **WhatsApp** con la **API oficial de Meta (WhatsApp Cloud API)** y reemplaza a `LoggingReminderSender`.

## Objetivo

- Un módulo `WhatsappModule` que envía mensajes de plantilla por la Cloud API.
- `WhatsappReminderSender`, que arma el mensaje del reminder y lo envía al teléfono del cliente.
- Distinguir errores recuperables (reintentar) de no recuperables (marcar `FAILED` de inmediato).
- Guardar el id del mensaje de WhatsApp (`wamid`) en el reminder.

## Alcance

**Dentro:** cliente HTTP de la Cloud API, plantilla de mensaje, validación del teléfono, clasificación de errores, campo `externalMessageId`, configuración en Meta, tests.

**Fuera (futuro):** webhook de estados de entrega (`sent`, `delivered`, `read`, `failed`) con `@nestjs/webhooks`; mensajes de texto libre; respuestas del cliente.

## Por qué plantilla

Un mensaje iniciado por la empresa fuera de la ventana de 24 h de atención solo se puede enviar con una **plantilla aprobada** por Meta. Los reminders siempre son iniciados por la empresa, así que se envían como `type: "template"`.

Plantilla sugerida (categoría **Utility**, idioma `es`), nombre `recordatorio_mantenimiento`:

```
Hola {{1}}, te recordamos tu servicio de mantenimiento programado para el {{2}}.
{{3}}
```

- `{{1}}` = `Client.name`
- `{{2}}` = `OrderHeader.serviceDate` formateada en `REMINDER_TZ` (p. ej. `martes, 25 de noviembre, 9:00 a. m.`) con `Intl.DateTimeFormat('es', …)`
- `{{3}}` = `Reminder.message`

Los parámetros no pueden contener saltos de línea, tabs ni más de 4 espacios seguidos: normalizarlos antes de enviar.

## Diseño

### `WhatsappModule` (`src/whatsapp/`)

- `whatsapp.config.ts`: lee y valida las variables de entorno al arrancar (falla el arranque si falta alguna).
- `whatsapp.service.ts`:

```ts
@Injectable()
export class WhatsappService {
  async sendTemplate(input: {
    to: string;               // E.164 sin '+', p. ej. '50499998888'
    template: string;
    language: string;
    bodyParams: string[];
  }): Promise<{ messageId: string }> {
    const url = `https://graph.facebook.com/${cfg.apiVersion}/${cfg.phoneNumberId}/messages`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: input.to,
        type: 'template',
        template: {
          name: input.template,
          language: { code: input.language },
          components: [{ type: 'body', parameters: input.bodyParams.map((text) => ({ type: 'text', text })) }],
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    // ver "Errores" abajo
    const json = await res.json();
    return { messageId: json.messages[0].id };
  }
}
```

- Sin SDK: `fetch` nativo de Node.
- No loguear el token ni el cuerpo completo de la respuesta; el teléfono, enmascarado (`504****8888`).
- Exporta `WhatsappService`; `ReminderModule` importa `WhatsappModule`.

### Errores

`WhatsappApiError extends Error` con `status`, `code` (código de error de Meta) y `retryable`. `WhatsappService` siempre lanza `WhatsappApiError` (así `WhatsappModule` no depende de BullMQ); `WhatsappReminderSender` convierte los que tienen `retryable: false` en `UnrecoverableError`.

| Caso | Acción |
|---|---|
| `2xx` | OK, devolver `messages[0].id` |
| `429` o código de Meta de rate limit | error normal → BullMQ reintenta |
| `5xx`, timeout, error de red | error normal → BullMQ reintenta |
| otro `4xx` (token inválido, plantilla inexistente, número no válido…) | `UnrecoverableError` → `FAILED` sin reintentos |
| `2xx` sin `messages[0].id` | `UnrecoverableError` (Meta aceptó la petición; reintentar podría duplicar) |

Algunos `4xx` son temporales y se reintentan según el código de Meta (`RETRYABLE_META_CODES` en `src/whatsapp/whatsapp-api.error.ts`): `1`, `2`, `4`, `80007`, `130429`, `131000`, `131016`, `131056`, `133004`. `131048` (spam rate limit) **no** se reintenta a propósito: insistir empeora la calidad del número.

### `WhatsappReminderSender` (`src/reminder/whatsapp-reminder-sender.ts`)

Reemplaza a `LoggingReminderSender` en `ReminderModule` (`{ provide: ReminderSender, useClass: WhatsappReminderSender }`).

```ts
async send(reminder: ReminderWithClient): Promise<ReminderSendResult> {
  const client = reminder.order?.client;
  const to = normalizePhone(client?.phoneNumber);
  if (!client || !to) throw new UnrecoverableError(`Reminder ${reminder.id}: el cliente no tiene teléfono válido`);

  const { messageId } = await this.whatsapp.sendTemplate({
    to,
    template: cfg.templateName,
    language: cfg.templateLang,
    bodyParams: [client.name, formatServiceDate(reminder.order!.serviceDate), reminder.message].map(sanitizeParam),
  });
  return { externalMessageId: messageId };
}
```

- `normalizePhone`: quita espacios, guiones, paréntesis y `+`; si el número no trae código de país, antepone `WHATSAPP_DEFAULT_COUNTRY_CODE`; valida 8–15 dígitos. Devuelve `null` si no es válido.
- `ReminderProcessor` (spec 02) ya guarda `result.externalMessageId` al marcar `SENT`.
- Clientes con `active = false`: no enviar → `UnrecoverableError('cliente inactivo')`.

## Variables de entorno

Añadir a `.env.example`:

```bash
# WhatsApp Cloud API (Meta)
WHATSAPP_ACCESS_TOKEN=""            # token de usuario de sistema (permanente)
WHATSAPP_PHONE_NUMBER_ID=""         # id del número emisor, no el número
WHATSAPP_API_VERSION="v23.0"        # versión de Graph API; revisar la vigente
WHATSAPP_TEMPLATE_NAME="recordatorio_mantenimiento"
WHATSAPP_TEMPLATE_LANG="es"
WHATSAPP_DEFAULT_COUNTRY_CODE="504" # se antepone a números sin código de país
```

## Cambios de contrato

En `Reminder`:

```prisma
  externalMessageId String?
```

`npm run contract:emit`, migración, y commitear `contract.prisma`, `contract.json` y `contract.d.ts` juntos.

## Configuración en Meta (una vez)

1. Crear una app en developers.facebook.com con el producto **WhatsApp** y una cuenta de WhatsApp Business.
2. Para pruebas: usar el número de prueba que da Meta y registrar hasta 5 teléfonos destinatarios.
3. Crear un **usuario de sistema** en Business Manager con permisos `whatsapp_business_messaging` y generar un token permanente → `WHATSAPP_ACCESS_TOKEN`.
4. Copiar el **Phone number ID** → `WHATSAPP_PHONE_NUMBER_ID`.
5. Crear la plantilla `recordatorio_mantenimiento` (Utility, `es`) y esperar su aprobación.
6. Para producción: registrar y verificar el número propio de la empresa.

## Plan de pruebas

- `whatsapp.service.spec.ts` con `vi.spyOn(globalThis, 'fetch')`:
  - 200 → devuelve `messageId`; el body enviado tiene `messaging_product`, `to`, plantilla y parámetros correctos; header `Authorization`.
  - 400/401 → `WhatsappApiError` con `retryable: false`.
  - 429, 500, 502 sin JSON y `400` con código de throughput → `retryable: true`.
  - Timeout (`TimeoutError`/`AbortError`) y error de red → reintentable.
  - El token no aparece en logs y el teléfono sale enmascarado.
- `whatsapp-format.spec.ts`: normalización (`+504 9999-8888` → `50499998888`, `99998888` → `50499998888`, `00…`, otros países) y saneado de parámetros.
- `whatsapp.config.spec.ts`: variables faltantes hacen fallar la carga.
- `whatsapp-reminder-sender.spec.ts`: teléfono faltante/inválido → `UnrecoverableError`; cliente inactivo; parámetros y fecha formateada; `WhatsappApiError` no reintentable → `UnrecoverableError`, reintentable → se propaga tal cual.
- Prueba manual: con el número de prueba de Meta y un teléfono registrado, crear un reminder `PENDING` vencido, ejecutar `processDueReminders()` y comprobar que llega el WhatsApp y el reminder queda `SENT` con `externalMessageId`.

## Criterios de aceptación

- [ ] Un reminder vencido llega como WhatsApp al teléfono del cliente con la plantilla aprobada.
- [ ] El reminder queda `SENT`, con `sentAt` y `externalMessageId`.
- [ ] Un cliente sin teléfono deja el reminder en `FAILED` al primer intento, con `lastError`.
- [ ] Un 5xx simulado se reintenta con backoff y, al agotar intentos, queda `FAILED`.
- [ ] El token no aparece en logs.
- [ ] `npm test`, `npm run lint` y `npm run build` pasan.

## Riesgos / puntos a verificar

- Aprobación de la plantilla por Meta (puede tardar o ser rechazada); sin ella no hay envío.
- Límites de mensajería por número (tiers) y calidad del número: un volumen alto de mensajes bloqueados o reportados baja el límite.
- Coste por conversación de categoría Utility según el país del destinatario.
- `Client.phoneNumber` es opcional y sin formato fijo: conviene validar el formato también al crear/editar clientes.
- Versión de Graph API: fijarla por `.env` y revisarla cuando Meta la deprecie.
