# Spec 13 — Webhook de confirmación del próximo servicio por WhatsApp

> Roadmap: [00 — Roadmap de recursos](./00-roadmap.md) · Base: [08 — OrderHeader](./08-resource-order-header.md), [10 — Maestro-detalle](./10-order-header-master-detail.md), [11 — Reminder](./11-resource-reminder.md), [12 — Reminders de confirmación](./12-order-completion-confirmation-reminders.md)
> Envío: [03 — WhatsApp](./03-reminders-whatsapp.md)

## Contexto

El spec 12 deja, al completar una orden, `nextServiceDate` calculado y hasta 3 reminders `CONFIRMATION` cuyo `orderId` es la orden completada. El cliente recibe la plantilla `confirmacion_proximo_servicio`, pero no puede responder nada útil: nadie escucha su respuesta.

Este spec añade el webhook que AlertFix expone a Meta. Cuando el cliente pulsa **"Confirmar"** en el mensaje, el backend crea una orden nueva en `OPEN` para el próximo servicio, copiando los servicios de la orden de referencia (`Reminder.orderId`), y le contesta al cliente con la fecha agendada.

| Pieza | Estado actual |
|---|---|
| `src/whatsapp-webhook/` | Carpeta vacía. No hay ningún endpoint que reciba eventos de Meta. |
| Plantilla `confirmacion_proximo_servicio` | Sin botones (spec 12, paso 10). |
| `WhatsappService.sendTemplate` | Solo envía el componente `body`; no admite botones ni mensajes de texto libre. |
| `WhatsappReminderSender` | Los `CONFIRMATION` usan su plantilla y `nextServiceDate`, pero no identifican al reminder dentro del mensaje. |
| `OrderHeader` | No guarda de qué orden viene otra: no hay forma de saber si una confirmación ya generó su orden. |
| `main.ts` | Sin `rawBody`: no se puede verificar la firma de Meta. |

## Objetivo

- Exponer `GET /whatsapp/webhook` (verificación de Meta) y `POST /whatsapp/webhook` (eventos), con la firma `X-Hub-Signature-256` verificada.
- Los reminders `CONFIRMATION` se envían con un botón quick-reply **"Confirmar"** cuyo payload es `CONFIRM:<reminderId>`.
- Al recibir ese botón, en una transacción:
  1. se localiza el reminder y su orden de referencia (`Reminder.orderId`);
  2. se crea una `OrderHeader` nueva en `OPEN`, del mismo cliente y empresa, con `serviceDate = nextServiceDate` de la orden de referencia y `previousOrderId` = la orden de referencia;
  3. se copian sus líneas (`serviceId` + `quantity`), sin los servicios inactivos.
- Después se le responde al cliente con un mensaje de texto: "¡Listo, {nombre}! Agendamos tu mantenimiento para el {fecha}."
- Pulsar el botón varias veces, o en varios de los 3 reminders, nunca crea más de una orden por orden de referencia.

## Alcance

**Dentro:** campo `previousOrderId` y su migración, botón con payload en el envío, `sendText` en `WhatsappService`, módulo `whatsapp-webhook` (handshake, firma, parseo, confirmación), `createFollowUp` en `OrderHeaderService`, variables de entorno, configuración en Meta, tests y roadmap.

**Fuera (futuro):**
- Eliminar o cancelar los reminders `CONFIRMATION` restantes cuando el cliente ya confirmó. Hasta entonces se seguirán enviando; si el cliente vuelve a pulsar, recibe "ya está agendado" (regla *Duplicado*).
- Botones de rechazo o reprogramación ("No, gracias", "Otra fecha") y la interpretación de texto libre.
- Webhook de estados de entrega (`statuses`: `sent`, `delivered`, `read`, `failed`), pendiente desde el spec 03. Llegan a la misma URL y se ignoran.
- Crear reminders `REMINDER` para la orden nueva antes de su `serviceDate`.
- Notificar a la empresa o al técnico de que hay una orden nueva.

## Reglas de negocio

| Regla | Comportamiento |
|---|---|
| Mensajes procesados | Solo `entry[].changes[]` con `field = 'messages'` y, dentro, `value.messages[]` con `type = 'button'`. Todo lo demás (`text`, `interactive`, `statuses`…) se ignora. |
| Payload | Debe ser `CONFIRM:<uuid>`. Cualquier otro valor se ignora con `logger.warn`. |
| Reminder | Debe existir, ser `type = CONFIRMATION` y tener `orderId`. Si no, se ignora. Su `status` no importa (puede seguir `SENT`). |
| Remitente | `message.from` debe ser igual a `normalizePhone(client.phoneNumber, defaultCountryCode)` del cliente de la orden de referencia. Si no coincide, se ignora con `logger.warn` (sin el teléfono completo: `maskPhone`). |
| Cliente | Debe existir y estar `active`. |
| Orden de referencia | Debe estar `COMPLETED` y tener `nextServiceDate`. Una orden reabierta (`OPEN`) o cancelada no genera nada. |
| Cualquiera de los 3 | Da igual cuál de los reminders `CONFIRMATION` de la orden se confirme, y aunque `nextServiceDate` ya haya pasado. |
| Duplicado | Si ya existe una orden con `previousOrderId` = la orden de referencia, no se crea otra; se responde "Tu mantenimiento ya está agendado para el {fecha}" con la fecha de esa orden. Una violación del `@unique` (dos webhooks a la vez) se trata igual. |
| Nueva orden | `clientId` y `companyId` de la referencia, `serviceDate = referencia.nextServiceDate`, `status = OPEN`, `previousOrderId = referencia.id`, `nextServiceDate = null`. |
| Líneas | Se copian `serviceId` y `quantity` de cada línea de la referencia. Las de servicios con `active = false` se omiten; las líneas sin `serviceId` se copian. |
| Sin líneas | Si tras omitir los inactivos no queda ninguna línea, no se crea la orden, se registra `logger.warn` y no se responde al cliente. |
| Respuesta | Se envía con `sendText` **después** del commit. Si falla, se registra `logger.error` y el webhook responde 200 igualmente: la orden ya está creada. |
| Respuesta HTTP | Firma inválida → 401. Cualquier rechazo de negocio → **200** (si no, Meta reintenta durante días). Error inesperado (BD caída) → 500 para que Meta reintente; es seguro porque el proceso es idempotente (regla *Duplicado*). |

## Modelo

### Cambio en `src/prisma/contract.prisma`

```prisma
model OrderHeader {
  // ...campos actuales
  previousOrderId String?      @unique   // orden de la que viene (spec 13)
  // ...
}
```

Columna simple con índice único, **sin `@relation`**: así un `DELETE` de la orden de referencia no queda bloqueado por la FK (ver *Notas*), y no dependemos de la sintaxis de relaciones a la misma tabla en Prisma 8, que `prisma-8.md` no documenta.

| Modelo | Campo | Tipo | En DTO | Validación |
|---|---|---|---|---|
| `OrderHeader` | `previousOrderId` | `String?`, `@unique` | **no** | Lo escribe `createFollowUp`. Enviarlo en `POST`/`PATCH /order-header` responde 400 (`forbidNonWhitelisted`). |

## Pasos de implementación

### 1. Contract y migración

1. Editar `src/prisma/contract.prisma` como arriba.
2. `npm run contract:emit`.
3. Generar una migración desde el hash actual de la BD hasta el contract nuevo, con el mismo proceso que `20261127T2048_order_completion_confirmation`. Debe contener `addColumn` `OrderHeader.previousOrderId` (`text`, nullable) y el índice único.
4. Aplicarla y comprobar con `npx prisma migration status` que `refs/db.json` coincide con `storageHash` de `contract.json`.
5. Commitear `contract.prisma`, `contract.json`, `contract.d.ts`, la migración y su snapshot juntos.

### 2. Envío: botón con payload y mensajes de texto

`src/whatsapp/whatsapp.service.ts`:

- Extraer a un método privado `post(body, masked)` la parte común de `sendTemplate`: `fetch`, timeout, `readJson`, clasificación de errores y `messageId`.
- `SendTemplateInput` gana `buttonPayloads?: string[]`. Por cada payload se añade un componente:

```ts
{
  type: 'button',
  sub_type: 'quick_reply',
  index: String(i),
  parameters: [{ type: 'payload', payload }],
}
```

- Nuevo método para la respuesta (texto libre, permitido porque el cliente escribió en las últimas 24 h):

```ts
/** Mensaje de texto libre. Solo válido dentro de la ventana de 24 h del cliente. */
async sendText(to: string, body: string): Promise<{ messageId: string }> {
  return this.post(
    {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { body },
    },
    maskPhone(to),
  );
}
```

`src/whatsapp/whatsapp-format.ts` (o un archivo nuevo `src/whatsapp-webhook/confirm-payload.ts`, importado por el sender):

```ts
const CONFIRM_PREFIX = 'CONFIRM:';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const confirmPayload = (reminderId: string) => `${CONFIRM_PREFIX}${reminderId}`;

/** `CONFIRM:<uuid>` → `<uuid>`; cualquier otra cosa → `null`. */
export function parseConfirmPayload(payload: string | undefined): string | null {
  if (!payload?.startsWith(CONFIRM_PREFIX)) return null;
  const id = payload.slice(CONFIRM_PREFIX.length);
  return UUID.test(id) ? id : null;
}
```

`src/reminder/whatsapp-reminder-sender.ts`: los `CONFIRMATION` añaden `buttonPayloads: [confirmPayload(reminder.id)]` a `sendTemplate`. Los `REMINDER` no cambian.

### 3. Orden de seguimiento: `OrderHeaderService.createFollowUp`

`src/order-header/order-header.service.ts`, nuevo método público. Reutiliza `createEntries` y `handleError`:

```ts
/**
 * Crea la orden del próximo servicio a partir de una orden COMPLETED (spec 13).
 * Idempotente: si ya existe una orden con `previousOrderId = originId`, la devuelve.
 */
async createFollowUp(
  originId: string,
): Promise<{ order: OrderHeader; created: boolean } | null>
```

Dentro de `db.transaction`:

1. `existing = orm.OrderHeader.where({ previousOrderId: originId }).first()` → si existe, `{ order: existing, created: false }`.
2. Cargar la referencia con `include('entries', e => e.include('service'))`. Si no existe, no está `COMPLETED` o no tiene `nextServiceDate` → `null` (con `logger.warn`).
3. Filtrar las líneas: fuera las que tienen `service?.active === false`. Si no queda ninguna → `null` (con `logger.warn`).
4. `orm.OrderHeader.create({ clientId, companyId, serviceDate: origin.nextServiceDate, status: OrderStatus.OPEN, previousOrderId: origin.id })` y `createEntries(orm, header.id, lines)`.
5. Devolver `{ order, created: true }`.

Si el `create` falla por el índice único de `previousOrderId` (código PostgreSQL `23505`), se relee la orden existente fuera de la transacción abortada y se devuelve `{ order, created: false }`. Prisma 8 normaliza ese error a un `SqlQueryError` (`kind: 'sql_query'`, `sqlState: '23505'`), pero no exporta la clase desde `@prisma/orm-postgres`. Por eso `isUniqueViolation` mira `sqlState`/`code` recorriendo la cadena `cause`.

`src/order-header/order-header.module.ts`: añadir `exports: [OrderHeaderService]`.

### 4. Módulo `src/whatsapp-webhook/`

```
src/whatsapp-webhook/
  whatsapp-webhook.module.ts       # imports: WhatsappModule, OrderHeaderModule
  whatsapp-webhook.controller.ts   # GET/POST /whatsapp/webhook
  whatsapp-webhook.types.ts        # interfaces del payload de Meta
  parse-button-replies.ts          # payload de Meta → [{ from, payload, messageId }]
  whatsapp-confirmation.service.ts # reglas de negocio
```

Registrar `WhatsappWebhookModule` en `src/app.module.ts`. Añadir `@ApiTags('whatsapp-webhook')`; si se prefiere no exponerlo en `/docs`, `@ApiExcludeController()`.

**Handshake (`GET`)**:

```ts
@Get()
verify(
  @Query('hub.mode') mode: string,
  @Query('hub.verify_token') token: string,
  @Query('hub.challenge') challenge: string,
) {
  if (mode !== 'subscribe' || token !== this.cfg.webhookVerifyToken) {
    throw new ForbiddenException();
  }
  return challenge; // texto plano
}
```

**Firma (`POST`)**: Meta firma el body crudo con el App Secret y lo envía como `X-Hub-Signature-256: sha256=<hex>`, igual que GitHub.

- Opción preferida (AGENTS.md): `@nestjs/webhooks`, receiver `whatsapp` con `scheme: 'github'`, `secret: WHATSAPP_APP_SECRET`, `outgoing: false` y `dedupe: false` (la idempotencia la da `previousOrderId`), y `@VerifyWebhook('whatsapp')` en el handler. **Antes de implementar**, comprobar en https://docs.nestjs.com/http/webhooks.md que `dedupe: false` no exige registrar `OutboxModule` y que el scheme `github` no requiere cabeceras propias de GitHub.
- Si alguna de las dos cosas falla: un guard propio `WhatsappSignatureGuard` que calcula `createHmac('sha256', appSecret).update(req.rawBody)` y compara con `timingSafeEqual` (longitudes iguales primero). Sin cabecera o con firma distinta → 401.
- **Implementado con el guard propio** (`src/whatsapp-webhook/whatsapp-signature.guard.ts`): según la doc, `WebhooksModule` exige registrar `OutboxModule` para arrancar, y el scheme `github` deduplica por `X-GitHub-Delivery`, una cabecera que Meta no envía.
- En los dos casos, `src/main.ts` pasa a `NestFactory.create(AppModule, { instrument: ObserveInstrument, rawBody: true })`, **sin quitar** `ObserveInstrument`.

**Handler**:

```ts
@Post()
@HttpCode(HttpStatus.OK)
async receive(@Body() body: WhatsappWebhookBody) {
  for (const reply of parseButtonReplies(body)) {
    await this.confirmation.handle(reply); // en secuencia
  }
}
```

- `WhatsappWebhookBody` es una **interfaz**, no una clase DTO: el `ValidationPipe` global no la valida (con `forbidNonWhitelisted` rechazaría los campos de Meta). `parseButtonReplies` recorre el body de forma defensiva (`?.` y `Array.isArray`) y nunca lanza.
- Forma relevante del payload (ver fixtures en los tests):

```json
{
  "object": "whatsapp_business_account",
  "entry": [{
    "id": "<WABA_ID>",
    "changes": [{
      "field": "messages",
      "value": {
        "messaging_product": "whatsapp",
        "metadata": { "phone_number_id": "<PHONE_NUMBER_ID>" },
        "messages": [{
          "from": "50499998888",
          "id": "wamid.REPLY",
          "type": "button",
          "context": { "from": "<business>", "id": "wamid.ORIGINAL" },
          "button": { "payload": "CONFIRM:<reminderId>", "text": "Confirmar" }
        }]
      }
    }]
  }]
}
```

**`WhatsappConfirmationService.handle({ from, payload })`**: aplica las reglas en orden.

1. `parseConfirmPayload(payload)`; si da `null`, se ignora.
2. Reminder con `include('order', o => o.include('client'))`; `type` y `orderId`.
3. Cliente activo y remitente igual al teléfono normalizado.
4. `orderHeaderService.createFollowUp(reminder.orderId)`.
5. Si da `null`, termina. Si `created`, envía el texto de confirmación; si no, el de "ya está agendado". En los dos casos usa `formatServiceDate(order.serviceDate, REMINDER_TZ)` (`src/reminder/date-utils.ts`) y `sanitizeParam` no hace falta (texto libre).
6. `sendText` va en su propio `try/catch` (regla *Respuesta*).

Los errores de BD en los pasos 2–4 se propagan: el controlador responde 500 y Meta reintenta.

Textos (constantes en `whatsapp-confirmation.service.ts`):

- Creada: `¡Listo, {nombre}! Agendamos tu mantenimiento para el {fecha}.`
- Duplicada: `{nombre}, tu mantenimiento ya está agendado para el {fecha}.`

`{fecha}` pasa por `sanitizeParam`, porque `Intl` separa `a. m.` con espacios no separables. Como la fecha ya termina en punto (`10:00 a. m.`), no se añade otro al final.

### 5. Configuración y variables de entorno

`src/whatsapp/whatsapp.config.ts`: dos claves nuevas, obligatorias.

```ts
/** App Secret de la app de Meta: firma de los webhooks (spec 13). */
appSecret: string;
/** Token que Meta envía en el handshake `GET /whatsapp/webhook` (spec 13). */
webhookVerifyToken: string;
// REQUIRED:
appSecret: 'WHATSAPP_APP_SECRET',
webhookVerifyToken: 'WHATSAPP_WEBHOOK_VERIFY_TOKEN',
```

`.env.example`, debajo de `WHATSAPP_DEFAULT_COUNTRY_CODE`:

```bash
WHATSAPP_APP_SECRET=""              # App Secret (Configuración > Básica); firma los webhooks
WHATSAPP_WEBHOOK_VERIFY_TOKEN=""    # valor aleatorio, el mismo que se pone en Meta
```

### 6. Configuración en Meta

1. Editar la plantilla `confirmacion_proximo_servicio`: añadir un botón **quick reply** "Confirmar". El payload no se define en la plantilla: lo envía el backend en cada mensaje. Modificar una plantilla aprobada la manda otra vez a revisión.
2. En la app de Meta, en WhatsApp > Configuración > Webhook: Callback URL `https://<host>/whatsapp/webhook` (HTTPS público; en local, un túnel) y Verify token = `WHATSAPP_WEBHOOK_VERIFY_TOKEN`. Meta hace el `GET` del handshake al guardar.
3. Suscribirse al campo `messages` de la WABA.

### 7. Tests

**`src/whatsapp-webhook/parse-button-replies.spec.ts`** (fixtures con la forma real de Meta): un `button` → 1 resultado con `from` y `payload`; un `text` → 0; solo `statuses` → 0; varias `entry`/`changes`/`messages` → todos los `button`; body vacío, `null` o mal formado → 0 sin lanzar.

**`confirm-payload` spec**: `CONFIRM:<uuid>` → uuid; prefijo distinto, uuid inválido, `undefined` → `null`; `confirmPayload` y `parseConfirmPayload` son inversas.

**`src/order-header/order-header.service.spec.ts`** (`createFollowUp`):

- Referencia `COMPLETED` con 2 líneas → crea `OPEN` con `serviceDate = nextServiceDate`, `previousOrderId`, `clientId`, `companyId`, y 2 líneas.
- Una línea con servicio inactivo → se omite; una línea sin `serviceId` → se copia.
- Todas inactivas → `null`, sin `create`.
- Ya existe orden con ese `previousOrderId` → `{ created: false }`, sin `create`.
- Error `23505` en el `create` → `{ created: false }` con la orden existente.
- Referencia `OPEN`, `CANCELLED`, sin `nextServiceDate` o inexistente → `null`.

**`src/whatsapp-webhook/whatsapp-confirmation.service.spec.ts`**: un caso por cada regla de la tabla (payload inválido, reminder inexistente, `type = REMINDER`, remitente distinto, cliente inactivo, `createFollowUp` → `null`); creada → `sendText` con el texto de confirmación; duplicada → texto de "ya agendado"; `sendText` lanza → no propaga; error de BD → propaga.

**`src/whatsapp-webhook/whatsapp-webhook.controller.spec.ts`** (o e2e con supertest): `GET` con token correcto → `challenge`; token incorrecto o `mode` distinto → 403; `POST` sin firma o con firma incorrecta → 401; `POST` firmado → 200 y llama a `handle` por cada botón.

**`src/whatsapp/whatsapp.service.spec.ts`**: `buttonPayloads` genera los componentes `button` con `index` correcto; sin `buttonPayloads` el body no cambia; `sendText` envía `type: 'text'` y comparte la clasificación de errores.

**`src/reminder/whatsapp-reminder-sender.spec.ts`**: `CONFIRMATION` envía `buttonPayloads: ['CONFIRM:<id>']`; `REMINDER` no envía botones.

**`src/whatsapp/whatsapp.config.spec.ts`**: falta `WHATSAPP_APP_SECRET` o `WHATSAPP_WEBHOOK_VERIFY_TOKEN` → lanza.

**`src/order-header/dto/order-header.dto.spec.ts`**: `previousOrderId` en `create` o `update` → 400.

### 8. Roadmap

En `docs/specs/00-roadmap.md`: enlazar este spec en las filas de `OrderHeader` y `Reminder`, y en **Flujos** cambiar el estado de "Confirmación del próximo servicio por WhatsApp" a **Implementado**.

## Endpoints

| Método | Ruta | Cambio |
|---|---|---|
| `GET` | `/whatsapp/webhook` | **Nuevo.** Handshake de Meta: `hub.challenge` o 403. |
| `POST` | `/whatsapp/webhook` | **Nuevo.** Eventos de Meta con firma verificada; el botón "Confirmar" crea la orden siguiente. Siempre 200 salvo firma inválida (401) o error inesperado (500). |
| `POST` / `PATCH` | `/order-header`, `/order-header/:id` | `previousOrderId` no se acepta (400). Las respuestas lo incluyen. |

## Criterios de aceptación

- [ ] La migración se aplica y `npx prisma migration status` no muestra cambios pendientes.
- [ ] Los reminders `CONFIRMATION` se envían con el botón "Confirmar" y payload `CONFIRM:<reminderId>`; los `REMINDER`, sin botones.
- [ ] Meta valida la Callback URL (`GET` con el verify token correcto); con otro token, 403.
- [ ] Un `POST` sin firma o con firma incorrecta responde 401 y no crea nada.
- [ ] Pulsar "Confirmar" crea una orden `OPEN` con el cliente y la empresa de la referencia, `serviceDate = nextServiceDate`, `previousOrderId` = la referencia y sus líneas sin los servicios inactivos.
- [ ] El cliente recibe "¡Listo, {nombre}! Agendamos tu mantenimiento para el {fecha}."
- [ ] Pulsar otra vez, o en otro reminder de la misma orden, no crea otra orden y responde "ya está agendado".
- [ ] Si la referencia no está `COMPLETED`, el reminder no es `CONFIRMATION`, el remitente no es el cliente o no quedan líneas: 200, sin orden, con log.
- [ ] Si falla el envío de la respuesta, la orden queda creada y el webhook responde 200.
- [ ] Los eventos `statuses` y los mensajes de texto responden 200 sin efectos.
- [ ] Enviar `previousOrderId` en `POST`/`PATCH /order-header` responde 400.
- [ ] `npm run lint` y `npm test` pasan.

## Verificación

```bash
npm run lint
npx vitest run src/whatsapp-webhook src/whatsapp src/order-header src/reminder
npm test
npx prisma migration status

npm run start:dev

# Handshake
curl -s "localhost:3000/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=$WHATSAPP_WEBHOOK_VERIFY_TOKEN&hub.challenge=123"   # 123
curl -i "localhost:3000/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=otro&hub.challenge=123"                              # 403

# Confirmación simulada: REMINDER_ID = un reminder CONFIRMATION de una orden COMPLETED (spec 12)
# y FROM = teléfono normalizado de su cliente.
BODY=$(jq -cn --arg p "CONFIRM:$REMINDER_ID" --arg f "$FROM" \
  '{object:"whatsapp_business_account",entry:[{id:"0",changes:[{field:"messages",value:{messaging_product:"whatsapp",messages:[{from:$f,id:"wamid.TEST",type:"button",button:{payload:$p,text:"Confirmar"}}]}}]}]}')
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$WHATSAPP_APP_SECRET" | sed 's/^.* //')

curl -i -X POST localhost:3000/whatsapp/webhook -H 'Content-Type: application/json' \
  -H "X-Hub-Signature-256: sha256=$SIG" -d "$BODY"                                       # 200
curl -i -X POST localhost:3000/whatsapp/webhook -H 'Content-Type: application/json' \
  -H "X-Hub-Signature-256: sha256=00" -d "$BODY"                                         # 401
curl -s -X POST localhost:3000/whatsapp/webhook -H 'Content-Type: application/json' \
  -H "X-Hub-Signature-256: sha256=$SIG" -d "$BODY"                                       # 200, sin orden nueva
```

Comprobar en la BD que hay **una** `OrderHeader` con `previousOrderId` = la orden del reminder, en `OPEN`, con `serviceDate` = su `nextServiceDate`, y sus líneas.

> Con credenciales reales, `sendText` falla con la simulación si el teléfono no escribió al número de negocio en las últimas 24 h (la orden se crea igual). La prueba de punta a punta es con el número de prueba de Meta: enviar un reminder `CONFIRMATION` vencido (spec 12), pulsar "Confirmar" en el teléfono y comprobar la orden y la respuesta.

## Notas

- **Reminders restantes:** tras confirmar, los otros `CONFIRMATION` `PENDING` de la orden se seguirán enviando hasta que se implemente su cancelación (fuera de este spec). La regla *Duplicado* evita órdenes repetidas.
- **Borrar la orden de referencia:** `previousOrderId` no tiene FK, así que el `DELETE` no se bloquea por la orden de seguimiento (sí por sus reminders, spec 11). La orden nueva conserva un `previousOrderId` huérfano; si se borrara y se reenviara una confirmación vieja, el reminder ya no existiría y se ignoraría.
- **Orden de referencia reabierta** (`COMPLETED → OPEN`) después de confirmar: la orden de seguimiento ya existe; nuevas confirmaciones se ignoran porque la referencia no está `COMPLETED`.
- **Cancelar la orden nueva:** si se cancela la orden de seguimiento, `previousOrderId` sigue ocupado y el cliente ya no puede volver a confirmar desde los reminders viejos. Si se quiere permitirlo, la regla *Duplicado* debería ignorar órdenes `CANCELLED` (y el índice único dejaría de servir).
- **Tiempo de respuesta:** Meta espera la respuesta en pocos segundos; la transacción y el `sendText` (timeout de 10 s) caben, pero si `sendText` se vuelve lento, moverlo a un job de BullMQ.
- **Seguridad:** el payload lo genera el backend y la firma garantiza que viene de Meta; la comprobación del remitente evita que un mensaje reenviado por otro número cree órdenes.
