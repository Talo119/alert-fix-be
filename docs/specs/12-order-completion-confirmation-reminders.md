# Spec 12 — Reminders de confirmación al completar una orden

> Roadmap: [00 — Roadmap de recursos](./00-roadmap.md) · Base: [07 — Service](./07-resource-service.md), [08 — OrderHeader](./08-resource-order-header.md), [10 — Maestro-detalle](./10-order-header-master-detail.md), [11 — Reminder](./11-resource-reminder.md)
> Envío: [01 — Cron](./01-reminders-cron.md) · [02 — Cola](./02-reminders-queue-bullmq.md) · [03 — WhatsApp](./03-reminders-whatsapp.md)

## Contexto

Al terminar un servicio de mantenimiento, el técnico marca la orden como `COMPLETED`. A partir de ese momento AlertFix debe encargarse solo de que el cliente confirme el **próximo** servicio: calcular cuándo toca y enviarle recordatorios por WhatsApp antes de esa fecha.

Hoy no existe nada de esto:

| Pieza | Estado actual |
|---|---|
| `Service` | No tiene frecuencia: no hay forma de saber cada cuánto se repite un servicio. |
| `OrderHeader.nextServiceDate` | Está en el contract, pero lo envía el usuario a mano en `POST`/`PATCH` y **no tiene migración**: `migrations/app/refs/db.json` está en `62cc…` y `contract.json` en `0ca4…`. Además hay dos carpetas vacías sin trackear: `migrations/app/20261127T1740_order_next_service_date` y `…_order_previous_order_reminder_type`. |
| `Reminder.type` | No existe. `src/common/types.ts` define `ReminderType` (`CONFIRMATION` / `REMINDER`), pero sin `as const` (su tipo es `string`) y nadie lo importa (ver *Notas* del spec 11). |
| `OrderHeaderService.update` | Cambiar `status` a `COMPLETED` solo guarda el estado. |
| `WhatsappReminderSender` | Siempre usa `WHATSAPP_TEMPLATE_NAME` y `order.serviceDate` como `{{2}}`. |

## Objetivo

- Cada `Service` puede tener una **frecuencia** configurable en días o meses.
- Al pasar una orden de `OPEN` a `COMPLETED` (`PATCH /order-header/:id`), el backend:
  1. calcula `nextServiceDate` = momento de completar + la frecuencia **más corta** entre los servicios de la orden;
  2. crea hasta **3 reminders de tipo `CONFIRMATION`**, en `PENDING` y con `orderId` = la orden completada, con `remindAt`:
     - 1 mes antes de `nextServiceDate`;
     - 15 días antes;
     - 1 semana (7 días) antes;
  3. todo en la misma transacción que el cambio de estado: si algo falla, la orden no queda `COMPLETED`.
- `Reminder` tiene un campo `type` (`REMINDER` por defecto).
- Los reminders `CONFIRMATION` se envían con su propia plantilla de WhatsApp y muestran `nextServiceDate`.

`orderId` del reminder es la orden completada. Servirá de referencia para crear la orden del próximo servicio cuando el cliente confirme (spec futuro); **no** se añade un campo `orderReferenceId`.

## Alcance

**Dentro:** cambios de contract y migración, frecuencia en el recurso `service`, `type` en el recurso `reminder`, cálculo de fechas, creación de reminders en `OrderHeaderService.update`, `nextServiceDate` de solo lectura, plantilla de confirmación en el sender, tests y roadmap.

**Fuera (futuro):**
- El webhook que recibe la confirmación del cliente desde WhatsApp (botones de la plantilla) y crea la orden siguiente.
- Eliminar o cancelar los reminders `CONFIRMATION` restantes cuando el cliente ya confirmó.
- Recalcular `nextServiceDate` o los reminders si cambia la frecuencia del servicio, las líneas de una orden ya completada, o si la orden se reabre (`COMPLETED → OPEN`).
- Disparar el flujo en `POST` (orden creada directamente `COMPLETED`) o en `CANCELLED → COMPLETED`.
- No enviar reminders de órdenes canceladas (pendiente desde el spec 11).

## Reglas de negocio

| Regla | Comportamiento |
|---|---|
| Disparador | `PATCH /order-header/:id` donde el estado **guardado** es `OPEN` y el body trae `status: "COMPLETED"`. |
| Idempotencia | Si la orden ya estaba `COMPLETED`, el PATCH no recalcula nada ni crea reminders, aunque el body vuelva a traer `COMPLETED`. |
| Fecha base | `now` (momento del PATCH) + frecuencia. No se usa `serviceDate`, así `nextServiceDate` siempre queda en el futuro. |
| Varias frecuencias | Se calcula `now + frecuencia` por cada servicio de la orden y gana la fecha **más cercana**. |
| Servicios sin frecuencia | Se ignoran. Las líneas sin `serviceId` también. |
| Ninguna frecuencia | La orden se completa igual, `nextServiceDate = null`, no se crean reminders y se registra un `logger.warn`. |
| Fechas vencidas | Solo se crea un reminder si su `remindAt > now`. Con una frecuencia menor a 1 mes se omite el de 1 mes (p. ej. 20 días → solo 15 y 7 días antes); con 7 días o menos no se crea ninguno. |
| Meses | Aritmética de calendario en UTC con ajuste a fin de mes: 31-ene + 1 mes = 28/29-feb; 31-mar − 1 mes = 28/29-feb. |
| Hora | `remindAt` conserva la hora de `now`; el cron es diario y solo cuenta el día en `REMINDER_TZ` (spec 01). |

## Modelo

### Cambios en `src/prisma/contract.prisma`

```prisma
model Service {
  // ...campos actuales
  frequencyValue Int?
  frequencyUnit  String?            // FrequencyUnit: DAY | MONTH
  // ...
}

model Reminder {
  // ...campos actuales
  type      String             @default("REMINDER")   // ReminderType: REMINDER | CONFIRMATION
  // ...
}
```

`OrderHeader.nextServiceDate DateTime?` ya está en el contract; no cambia.

| Modelo | Campo | Tipo | En DTO | Validación |
|---|---|---|---|---|
| `Service` | `frequencyValue` | `Int?` | sí | `@IsOptional() @IsInt() @Min(1)` |
| `Service` | `frequencyUnit` | `String?` | sí | `@IsOptional() @IsIn(FREQUENCY_UNITS)` |
| `Reminder` | `type` | `String`, default `REMINDER` | sí (opcional en create) | `@IsOptional() @IsIn(REMINDER_TYPES)` |
| `OrderHeader` | `nextServiceDate` | `DateTime?` | **no** (sale de los DTOs) | Lo escribe el service al completar |

`frequencyValue` y `frequencyUnit` van **los dos o ninguno**: un servicio con solo uno de ellos responde 400.

## Pasos de implementación

### 1. Contract y migración

1. Editar `src/prisma/contract.prisma` como arriba. Verificar la sintaxis de `@default` para strings en Prisma 8 (`prisma-8.md`).
2. `npm run contract:emit`.
3. Borrar las carpetas vacías `migrations/app/20261127T1740_order_next_service_date` y `migrations/app/20261127T1740_order_previous_order_reminder_type`.
4. Generar **una** migración desde el hash de la BD (`62cc…`) hasta el contract nuevo, con el mismo proceso que la de `20261118T1636_reminder_external_message_id`. Debe contener:
   - `addColumn` `OrderHeader.nextServiceDate` (`timestamptz`, nullable): pendiente desde el último commit;
   - `addColumn` `Service.frequencyValue` (`int4`, nullable) y `Service.frequencyUnit` (`text`, nullable);
   - `addColumn` `Reminder.type` (`text`, `NOT NULL DEFAULT 'REMINDER'`): las filas existentes quedan como `REMINDER`.
5. Aplicarla y comprobar con `npx prisma migration status` que `refs/db.json` coincide con `storageHash` de `contract.json`.
6. Commitear `contract.prisma`, `contract.json`, `contract.d.ts`, la migración y su snapshot juntos.

### 2. Constantes

Nuevo `src/reminder/reminder-type.ts` (mismo patrón que `reminder-status.ts`); borrar `src/common/types.ts`:

```ts
export const ReminderType = {
  REMINDER: 'REMINDER', // recordatorio manual de una orden (spec 11)
  CONFIRMATION: 'CONFIRMATION', // pide confirmar el próximo servicio (spec 12)
} as const;

export type ReminderType = (typeof ReminderType)[keyof typeof ReminderType];

export const REMINDER_TYPES = Object.values(ReminderType);
```

Nuevo `src/service/frequency-unit.ts`:

```ts
export const FrequencyUnit = {
  DAY: 'DAY',
  MONTH: 'MONTH',
} as const;

export type FrequencyUnit = (typeof FrequencyUnit)[keyof typeof FrequencyUnit];

export const FREQUENCY_UNITS = Object.values(FrequencyUnit);
```

### 3. Recurso Service (`/resource-sync Service`)

`src/service/dto/create-service.dto.ts`:

```ts
  /** Cada cuántas unidades se repite el servicio. Va junto con `frequencyUnit`. */
  @IsOptional()
  @IsInt()
  @Min(1)
  frequencyValue?: number;

  /** Unidad de la frecuencia: `DAY` o `MONTH`. Va junto con `frequencyValue`. */
  @ApiProperty({ enum: FREQUENCY_UNITS, required: false })
  @IsOptional()
  @IsIn(FREQUENCY_UNITS)
  frequencyUnit?: FrequencyUnit;
```

`UpdateServiceDto` no cambia (`PartialType`); `@IsOptional()` deja pasar `null` para quitar la frecuencia.

`src/service/service.service.ts`: nuevo método privado, llamado en `create` con el DTO y en `update` con el registro combinado (`{ ...existing, ...dto }`, usando el resultado de `findOne`):

```ts
private assertFrequency({ frequencyValue, frequencyUnit }: {
  frequencyValue?: number | null;
  frequencyUnit?: string | null;
}) {
  if ((frequencyValue == null) !== (frequencyUnit == null)) {
    throw new BadRequestException(
      'frequencyValue and frequencyUnit must be set together',
    );
  }
}
```

### 4. Recurso Reminder (`/resource-sync Reminder`)

`src/reminder/dto/create-reminder.dto.ts`:

```ts
  /** Tipo: `REMINDER` (por defecto) o `CONFIRMATION`. */
  @ApiProperty({ enum: REMINDER_TYPES, required: false })
  @IsOptional()
  @IsIn(REMINDER_TYPES)
  type?: ReminderType;
```

`ReminderService.create` no cambia: si no llega `type`, aplica el default del contract. Revisar `update-reminder.dto.spec.ts`: `{ type: null }` debe responder 400, porque la columna es `NOT NULL` (con `skipNullProperties: false` el `@IsOptional` deja pasar `null`; añadir `@ValidateIf((_, v) => v !== undefined)` como en `status`).

### 5. Cálculo de fechas: `src/order-header/next-service.ts`

Funciones puras, sin BD, fáciles de probar:

```ts
import { FrequencyUnit } from '../service/frequency-unit.js';

type Frequency = {
  frequencyValue: number | null;
  frequencyUnit: string | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** Suma meses en UTC; si el día no existe en el mes destino, usa el último día. */
export function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

/** La fecha más cercana entre `now + frecuencia` de cada servicio; `null` si ninguno tiene. */
export function computeNextServiceDate(
  services: Frequency[],
  now: Date,
): Date | null {
  const candidates = services.flatMap(({ frequencyValue, frequencyUnit }) => {
    if (!frequencyValue || !frequencyUnit) return [];
    return frequencyUnit === FrequencyUnit.MONTH
      ? [addMonths(now, frequencyValue)]
      : [addDays(now, frequencyValue)];
  });
  if (candidates.length === 0) return null;
  return new Date(Math.min(...candidates.map((d) => d.getTime())));
}

/** 1 mes, 15 días y 7 días antes de `next`, sin las que ya pasaron. */
export function confirmationReminderDates(next: Date, now: Date): Date[] {
  return [addMonths(next, -1), addDays(next, -15), addDays(next, -7)].filter(
    (date) => date.getTime() > now.getTime(),
  );
}
```

### 6. `OrderHeaderService.update`

`src/order-header/order-header.service.ts`. Se queda el esquema actual (`try/catch` + `handleError`, todo dentro de `db.transaction`). Después de reemplazar `entries` (para usar las líneas nuevas si el mismo PATCH las trae) y antes del `return`:

```ts
const completing =
  existing.status === OrderStatus.OPEN &&
  rest.status === OrderStatus.COMPLETED;

let result = header;
if (completing) {
  result = await this.scheduleConfirmation(orm, id, header);
}
```

Nuevo método privado:

```ts
/**
 * Calcula `nextServiceDate` con la frecuencia más corta de los servicios de la
 * orden y crea los reminders `CONFIRMATION`. Corre dentro de la transacción
 * del `update`: si falla, la orden no queda `COMPLETED`.
 */
private async scheduleConfirmation(orm: Orm, orderId: string, header: OrderHeader) {
  const now = new Date();
  const entries = await orm.OrderEntry.where({ orderId })
    .include('service')
    .all();
  const services = entries.flatMap(({ service }) => (service ? [service] : []));
  const nextServiceDate = computeNextServiceDate(services, now);

  const updated =
    (await orm.OrderHeader.whereUnique({ id: orderId }).update({
      nextServiceDate,
    })) ?? header;

  if (!nextServiceDate) {
    this.logger.warn(
      `Order ${orderId} completed without service frequency: no confirmation reminders`,
    );
    return updated;
  }

  // En secuencia, como `createEntries`: una sola conexión en la transacción.
  const dates = confirmationReminderDates(nextServiceDate, now);
  for (const remindAt of dates) {
    await orm.Reminder.create({
      orderId,
      type: ReminderType.CONFIRMATION,
      status: ReminderStatus.PENDING,
      message: CONFIRMATION_MESSAGE,
      remindAt,
    });
  }
  this.logger.log(
    `Order ${orderId} completed: next service ${nextServiceDate.toISOString()}, ${dates.length} confirmation reminders`,
  );
  return updated;
}
```

- `CONFIRMATION_MESSAGE` es una constante en `next-service.ts`, en español, que va en `{{3}}` de la plantilla, p. ej. `'Responde a este mensaje para confirmar tu próximo mantenimiento.'`. El texto final depende de la plantilla aprobada en Meta.
- `OrderHeader` es `Scalars<Models.public_OrderHeader>`; ya está en `src/reminder/reminder.types.ts`.
- Si alguna línea de la orden tiene un servicio inactivo (`active: false`), su frecuencia **sí** cuenta: el servicio se prestó.

**`nextServiceDate` pasa a ser de solo lectura:**

- Quitar la propiedad de `src/order-header/dto/create-order-header.dto.ts` (y por herencia de `UpdateOrderHeaderDto`). Con `forbidNonWhitelisted`, enviarla responde 400.
- Quitar su manejo en `create` y `update` (las ramas `nextServiceDate && …` / `nextServiceDate !== undefined && …`).
- Actualizar la tabla *Modelo* del spec 08 (`En DTO: no`) y el ejemplo de `create` del spec 10, con un enlace a este spec.

### 7. Envío por WhatsApp

`src/whatsapp/whatsapp.config.ts`: nueva clave obligatoria.

```ts
export interface WhatsappConfig {
  // ...
  templateName: string;
  /** Plantilla de los reminders `CONFIRMATION` (spec 12). */
  confirmationTemplateName: string;
  // ...
}

const REQUIRED = {
  // ...
  confirmationTemplateName: 'WHATSAPP_CONFIRMATION_TEMPLATE_NAME',
  // ...
} as const satisfies Record<keyof WhatsappConfig, string>;
```

`src/reminder/whatsapp-reminder-sender.ts`: la plantilla y la fecha `{{2}}` dependen del tipo.

```ts
const isConfirmation = reminder.type === ReminderType.CONFIRMATION;
const date = isConfirmation ? order.nextServiceDate : order.serviceDate;
if (!date) {
  throw new UnrecoverableError(
    `Reminder ${reminder.id}: la orden no tiene nextServiceDate`,
  );
}
// ...
template: isConfirmation ? this.cfg.confirmationTemplateName : this.cfg.templateName,
bodyParams: [client.name, formatServiceDate(date, this.timeZone), reminder.message].map(sanitizeParam),
```

Los reminders `REMINDER` se envían igual que hoy. El resto del flujo (cron → cola → worker, specs 01–03) no cambia: los `CONFIRMATION` son reminders `PENDING` normales.

### 8. Tests

**`src/order-header/next-service.spec.ts`** (nuevo, con fechas fijas):

- `addMonths`: +1 mes normal; 31-ene + 1 = 28-feb (29 en bisiesto); 31-mar − 1 = 28-feb; cruce de año (15-dic + 1 = 15-ene).
- `computeNextServiceDate`: 3 meses; 90 días; `[3 MONTH, 45 DAY]` → la de 45 días; servicios sin frecuencia o con solo uno de los campos → ignorados; lista vacía → `null`.
- `confirmationReminderDates`: frecuencia de 1 año → 3 fechas exactas (−1 mes, −15 d, −7 d); 20 días → 2; 10 días → 1; 7 días → 0.

**`src/order-header/order-header.service.spec.ts`** (con `vi.useFakeTimers()` + `vi.setSystemTime(...)`; ampliar el mock con `Reminder: { create }` y `entryFiltered.include(...)`):

- `OPEN → COMPLETED` con un servicio de 3 meses: `update({ nextServiceDate })` con la fecha esperada y 3 `Reminder.create` con `{ orderId, type: 'CONFIRMATION', status: 'PENDING', remindAt }`. La respuesta trae `nextServiceDate`.
- `COMPLETED → COMPLETED`: no consulta servicios ni crea reminders.
- `OPEN → OPEN` (PATCH de otros campos): no crea reminders.
- Sin frecuencia: `nextServiceDate: null`, 0 reminders, `logger.warn`.
- PATCH que reemplaza `entries` y completa a la vez: la frecuencia sale de las líneas nuevas (la consulta de entries con `include('service')` corre después de `createEntries`).
- `Reminder.create` lanza: el error llega al `catch` (500) y la transacción se aborta.
- Body con `nextServiceDate` → 400 (test de DTO, como `update-reminder.dto.spec.ts`).

**`src/service/service.service.spec.ts`**: `create` con solo `frequencyValue` → 400; `update` que deja la combinación incompleta (el registro tiene ambos y el DTO pone `frequencyUnit: null`) → 400; `{ frequencyValue: null, frequencyUnit: null }` → la quita.

**`src/reminder/whatsapp-reminder-sender.spec.ts`** (añadir `type` al fixture y `confirmationTemplateName` a `cfg`): `CONFIRMATION` usa `confirmationTemplateName` y `nextServiceDate` en `{{2}}`; `CONFIRMATION` sin `nextServiceDate` → `UnrecoverableError`; `REMINDER` sin cambios.

**`src/whatsapp/whatsapp.config.spec.ts`**: falta `WHATSAPP_CONFIRMATION_TEMPLATE_NAME` → lanza.

### 9. Variables de entorno

Añadir a `.env.example`, debajo de `WHATSAPP_TEMPLATE_NAME`:

```bash
WHATSAPP_CONFIRMATION_TEMPLATE_NAME="confirmacion_proximo_servicio"
```

Es obligatoria: sin ella la app no arranca.

### 10. Configuración en Meta

Crear la plantilla `confirmacion_proximo_servicio` (Utility, `es`) con los mismos 3 parámetros que `recordatorio_mantenimiento`: `{{1}}` nombre del cliente, `{{2}}` fecha del próximo servicio, `{{3}}` mensaje. Esperar su aprobación. Los botones de respuesta rápida para confirmar se definirán con el spec del webhook.

### 11. Roadmap

En `docs/specs/00-roadmap.md`, enlazar este spec en las filas de `Service`, `OrderHeader` y `Reminder`, y actualizar la fecha.

## Endpoints afectados

| Método | Ruta | Cambio |
|---|---|---|
| `POST` / `PATCH` | `/service`, `/service/:id` | Aceptan `frequencyValue` y `frequencyUnit` (los dos o ninguno; 400 si no). |
| `POST` / `PATCH` | `/reminder`, `/reminder/:id` | Aceptan `type` opcional (`REMINDER` / `CONFIRMATION`). |
| `POST` / `PATCH` | `/order-header`, `/order-header/:id` | `nextServiceDate` ya no se acepta (400). |
| `PATCH` | `/order-header/:id` | `OPEN → COMPLETED` calcula `nextServiceDate` y crea los reminders `CONFIRMATION`. La respuesta trae `nextServiceDate`. |

## Criterios de aceptación

- [ ] La migración se aplica y `npx prisma migration status` no muestra cambios pendientes; los reminders existentes quedan con `type = 'REMINDER'`.
- [ ] Un `Service` acepta `frequencyValue` + `frequencyUnit` (`DAY` / `MONTH`); con solo uno de los dos responde 400.
- [ ] `PATCH` `OPEN → COMPLETED` con un servicio de 3 meses fija `nextServiceDate = now + 3 meses` y crea 3 reminders `CONFIRMATION`, en `PENDING`, con `orderId` = la orden, a −1 mes, −15 días y −7 días.
- [ ] Con varios servicios gana la frecuencia más corta.
- [ ] Con una frecuencia de 20 días se crean 2 reminders; con 7 días o menos, ninguno.
- [ ] Sin frecuencia en ningún servicio: la orden queda `COMPLETED`, `nextServiceDate = null`, 0 reminders.
- [ ] Repetir el PATCH sobre una orden ya `COMPLETED` no crea reminders duplicados.
- [ ] Si falla la creación de un reminder, la orden sigue `OPEN` (rollback).
- [ ] Enviar `nextServiceDate` en `POST`/`PATCH /order-header` responde 400.
- [ ] Un reminder `CONFIRMATION` vencido lo envía el cron con `WHATSAPP_CONFIRMATION_TEMPLATE_NAME` y `nextServiceDate` en `{{2}}`; los `REMINDER` siguen igual.
- [ ] `/docs` muestra los campos nuevos en los esquemas de `service` y `reminder`.
- [ ] `npm run lint` y `npm test` pasan.

## Verificación

> Con credenciales reales en `.env`, un reminder vencido **envía un WhatsApp**. Los reminders de este flujo quedan al menos 1 semana en el futuro, así que no se envían durante la prueba; borrarlos al terminar.

```bash
npm run lint
npx vitest run src/order-header src/service src/reminder src/whatsapp
npm test
npx prisma migration status

npm run start:dev
SERVICE_ID=$(curl -s -X POST localhost:3000/service -H 'Content-Type: application/json' \
  -d '{"name":"Limpieza de A/C","frequencyValue":3,"frequencyUnit":"MONTH"}' | jq -r .id)
curl -i -X POST localhost:3000/service -H 'Content-Type: application/json' \
  -d '{"name":"x","frequencyValue":3}'                                                   # 400
ORDER_ID=$(curl -s -X POST localhost:3000/order-header -H 'Content-Type: application/json' \
  -d "{\"clientId\":\"<client>\",\"serviceDate\":\"2026-11-27T15:00:00.000Z\",\"status\":\"OPEN\",\"entries\":[{\"serviceId\":\"$SERVICE_ID\",\"quantity\":1}]}" | jq -r .id)
curl -s -X PATCH localhost:3000/order-header/$ORDER_ID -H 'Content-Type: application/json' \
  -d '{"status":"COMPLETED"}' | jq .nextServiceDate                                       # ≈ hoy + 3 meses
curl -s localhost:3000/reminder | jq "map(select(.orderId==\"$ORDER_ID\")) | map({type,status,remindAt})"   # 3 CONFIRMATION
curl -s -X PATCH localhost:3000/order-header/$ORDER_ID -H 'Content-Type: application/json' -d '{"status":"COMPLETED"}'
curl -s localhost:3000/reminder | jq "map(select(.orderId==\"$ORDER_ID\")) | length"     # sigue en 3
curl -i -X PATCH localhost:3000/order-header/$ORDER_ID -H 'Content-Type: application/json' \
  -d '{"nextServiceDate":"2027-01-01T00:00:00.000Z"}'                                    # 400
```

Repetir con un servicio de `20 DAY` (2 reminders) y con uno sin frecuencia (`nextServiceDate: null`, 0 reminders).

## Notas

- **Borrar órdenes completadas:** `DELETE /order-header/:id` ya fallaba (500) si la orden tenía reminders (spec 11). Ahora casi toda orden completada los tendrá; hay que borrarlos antes o resolver la cascada en un spec futuro.
- **Orden reabierta:** si una orden vuelve de `COMPLETED` a `OPEN` y se completa de nuevo, se crean otros 3 reminders y se recalcula `nextServiceDate`; los anteriores siguen `PENDING`. Se resolverá junto con la eliminación de reminders restantes.
- **`CANCELLED → COMPLETED`:** no dispara el flujo (solo `OPEN`). Si se considera válido, ampliar la condición.
- **Cambiar la frecuencia después:** no afecta a órdenes ya completadas ni a sus reminders.
- **Orden cancelada después de completar:** el sender no mira `OrderHeader.status` (spec 11), así que los `CONFIRMATION` se enviarían igual.
- **Problema previo, fuera de este spec:** `OrderHeaderController.findAll()` llama a `orderHeaderService.findAll()` sin el `clientId` que exige la firma.
- **Carrera:** dos PATCH simultáneos `OPEN → COMPLETED` podrían leer ambos `OPEN` y duplicar los reminders. Con un único técnico por orden el riesgo es bajo; si importa, hacer el cambio de estado condicional (`where({ id, status: OPEN })` con `updateAndCount`) y crear reminders solo si actualizó 1 fila.
