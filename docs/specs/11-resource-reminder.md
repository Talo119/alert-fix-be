# Spec 11 — Recurso Reminder (CRUD)

> Roadmap: [00 — Roadmap de recursos](./00-roadmap.md) · Referencia: `src/order-entry/`, `src/order-header/`, `src/user/`
> Envío (ya implementado): [01 — Cron](./01-reminders-cron.md) · [02 — Cola](./02-reminders-queue-bullmq.md) · [03 — WhatsApp](./03-reminders-whatsapp.md)

## Contexto

`Reminder` es un recordatorio de una orden de mantenimiento (`orderId` → `OrderHeader`): el texto (`message`) que se envía por WhatsApp al cliente de la orden, cuándo (`remindAt`) y en qué estado está (`status`).

El **envío** ya funciona (specs 01–03): el cron toma los `PENDING` vencidos, los encola (`QUEUED`) y el worker los envía y los marca `SENT` o `FAILED`. Lo que falta es el **CRUD**: hoy no hay endpoint para crear un recordatorio, hay que insertarlo directamente en la base de datos.

`src/reminder/` ya existe, así que este spec **no** usa `nest g resource`. Estado actual:

| Archivo | Estado |
|---|---|
| `reminder.service.ts` | `create`, `findAll`, `update` y `remove` son stubs que devuelven strings. `findOne` consulta la BD, pero responde 200 vacío si no existe y se traga los errores de BD. |
| `reminder.controller.ts` | Ya tiene `@ApiTags('reminder')`. Faltan `ParseUUIDPipe` y los JSDoc. |
| `dto/create-reminder.dto.ts` | Clase vacía. Con `forbidNonWhitelisted`, hoy cualquier campo en el body responde 400. |
| `dto/update-reminder.dto.ts` | Ya usa `PartialType` de `@nestjs/swagger`. |
| `reminder.service.spec.ts`, `reminder.controller.spec.ts` | Solo `should be defined`. |
| `entities/reminder.entity.ts` | Clase vacía; se queda así. |

## Objetivo

- Un recurso REST `reminder` con CRUD completo sobre `db.orm.public.Reminder`.
- DTOs validados con class-validator a partir del contract.
- Errores HTTP correctos: 400 / 404 / 409 / 500. No hay campos `@unique`; el 409 es por estado (ver *Reglas de estado*).
- `remindAt` se recibe como string ISO 8601 y se guarda como `Date`.
- El cliente de la API no puede falsear el estado del envío (`SENT`, `sentAt`, `externalMessageId`…).
- Cada endpoint documentado en Swagger (`/docs`) bajo el tag `reminder`.
- Tests unitarios del service y del controller.

## Alcance

**Dentro:** métodos de `ReminderService`, controller, DTOs, documentación Swagger y los dos specs (`reminder.service.spec.ts`, `reminder.controller.spec.ts`).

**No se toca:** `reminder.module.ts`, `reminder-scheduler.service.ts`, `date-utils.ts`, `reminder-dispatcher.ts`, `queue-reminder-dispatcher.ts`, `reminder-queue.ts`, `reminder.processor.ts`, `reminder-sender.ts`, `whatsapp-reminder-sender.ts`, `reminder-status.ts`, `reminder.types.ts`, sus specs y el contract.

**Fuera (futuro):** paginación y filtros en `findAll` (por `orderId`, `status` o rango de `remindAt`), filtrado por tenant (`companyId` del usuario autenticado), autenticación/autorización, borrado lógico (el modelo no tiene `active`), crear recordatorios automáticamente al crear una orden o cuando cambia `serviceDate` / `nextServiceDate`, cancelar los recordatorios de una orden `CANCELLED`, enviar uno de inmediato por API, incluir la orden o el cliente en las respuestas, y el tipo de recordatorio (`CONFIRMATION` / `REMINDER`, ver *Notas*).

## Modelo

Tomado de `src/prisma/contract.prisma`:

| Campo | Tipo | Requerido | En DTO | Validación |
|---|---|---|---|---|
| `id` | `String` (uuid) | generado | no | — |
| `orderId` | `String?` (FK) | no | sí | `@IsOptional() @IsUUID()` |
| `message` | `String` | sí | sí | `@IsString() @IsNotEmpty()` |
| `remindAt` | `DateTime` | sí | sí | `@IsDateString()` |
| `status` | `String` | sí | solo en update | Create: lo fija el service en `PENDING`. Update: `@IsIn([ReminderStatus.PENDING])` |
| `sentAt` | `DateTime?` | no | no | Lo escribe `ReminderProcessor` |
| `lastError` | `String?` | no | no | Lo escribe `ReminderProcessor` |
| `externalMessageId` | `String?` | no | no | Lo escribe `ReminderProcessor` (`wamid`) |
| `createdAt` | `DateTime` | generado | no | — |
| `updatedAt` | `temporal.UpdatedAt` | generado | no | — |

Relaciones: `order` → `OrderHeader` vía `orderId` (el objeto de relación no entra en el DTO).

El modelo **no** tiene campo `active`: `findAll` usa `all()` sin filtro.

**Diferencia con la regla general:** `sentAt`, `lastError` y `externalMessageId` quedan fuera de los DTOs, y `status` está restringido, porque son el registro de lo que hizo el worker. Si la API pudiera escribirlos, un `POST` con `status: "QUEUED"` dejaría un recordatorio que nadie envía (no hay job en la cola) y uno con `SENT` simularía un envío que no ocurrió.

## Reglas de estado

| Estado actual | `PATCH` | `DELETE` |
|---|---|---|
| `PENDING` | sí | sí |
| `FAILED` | sí; con `{ "status": "PENDING" }` se reintenta en el siguiente cron (spec 02: el dispatcher elimina el job fallido antes de encolar) | sí |
| `QUEUED` | **409**: el job ya está en la cola; cambiar `remindAt` no detendría el envío | sí: si el job aún no empezó, el worker falla con `UnrecoverableError` y no envía |
| `SENT` | **409**: el mensaje ya se envió; volverlo a `PENDING` lo mandaría dos veces | sí |

## Dependencias

| Modelo | FK | Estado en roadmap |
|---|---|---|
| OrderHeader | `orderId` | Implementado |

**Modelos que dependen de este:** ninguno. `remove` no choca con restricciones de FK.

## Pasos de implementación

### 1. Punto de partida

No regenerar el recurso. Completar los métodos stub de `reminder.service.ts` y conservar los archivos listados en *No se toca*. `ReminderModule` ya está registrado en `src/app.module.ts`; no hay que cambiarlo.

**Requisito previo:** al 2026-11-24 hay cambios sin commitear que impiden compilar: `OrderHeaderService.findAll(clientId)` y `ServiceService.findAll(companyId)` ahora piden un argumento, pero sus controllers y tests los llaman sin él (TS2554). Resolverlo antes de `npm run build` / `npm run start:dev`; no forma parte de este spec.

### 2. DTOs

`src/reminder/dto/create-reminder.dto.ts`:

```ts
import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateReminderDto {
  /** Orden (`OrderHeader`) sobre la que se avisa al cliente. */
  @IsOptional()
  @IsUUID()
  orderId?: string;

  /** Texto del recordatorio: parámetro `{{3}}` de la plantilla de WhatsApp. */
  @IsString()
  @IsNotEmpty()
  message: string;

  /** Cuándo enviarlo, en ISO 8601 (p. ej. `2026-11-30T14:00:00.000Z`). El cron es diario: cuenta el día, no la hora. */
  @IsDateString()
  remindAt: string;
}
```

`src/reminder/dto/update-reminder.dto.ts`:

```ts
import { ApiProperty, PartialType } from '@nestjs/swagger';
import { IsIn, ValidateIf } from 'class-validator';
import { ReminderStatus } from '../reminder-status.js';
import { CreateReminderDto } from './create-reminder.dto.js';

export class UpdateReminderDto extends PartialType(CreateReminderDto, {
  skipNullProperties: false,
}) {
  /** Solo `PENDING`: reintenta un recordatorio `FAILED` en el siguiente cron. */
  @ApiProperty({ enum: [ReminderStatus.PENDING], required: false })
  @ValidateIf((_, value) => value !== undefined)
  @IsIn([ReminderStatus.PENDING])
  status?: typeof ReminderStatus.PENDING;
}
```

- **`skipNullProperties: false` es necesario.** Por defecto `PartialType` aplica `@IsOptional()`, que deja pasar `null`: `PATCH { "remindAt": null }` llegaría a `new Date(null)` = 1970 y el cron **enviaría el WhatsApp** en la siguiente ejecución. Con esta opción, `null` en `remindAt` o `message` responde 400. `orderId: null` sigue permitido, porque `CreateReminderDto` ya lleva `@IsOptional()`.
- `@ValidateIf` en `status`, en lugar de `@IsOptional()`, por la misma razón.
- `@ApiProperty` solo en `status`: el plugin no puede deducir el enum de `@IsIn` (mismo criterio que `CreateOrderHeaderDto`).

No se crean más DTOs.

### 3. Service

`src/reminder/reminder.service.ts`. Toma de base `src/order-entry/order-entry.service.ts`:

- **Sin `db.close()`.** `db` es compartido (lo usan también el cron y el worker).
- `findOne` lanza `NotFoundException` si `whereUnique({ id }).first()` devuelve `null`. Se elimina el `catch` actual, que se traga el error.
- `update` y `remove` llaman primero a `this.findOne(id)`, así el 404 sale de un solo lugar.
- En el `catch`, las `HttpException` se relanzan; el resto se loguea y lanza `InternalServerErrorException`.
- **FK `orderId`:** helper privado `assertOrderExists(orderId)` en `create` y `update`; si no existe, `BadRequestException(\`OrderHeader ${orderId} does not exist\`)`.
- **`create`** fija siempre `status: ReminderStatus.PENDING`.
- **`update`** lanza `ConflictException` si el recordatorio está `QUEUED` o `SENT`.
- **`remindAt`** se convierte con `new Date(...)`; en `update`, solo si viene.
- **Sin `@unique`:** no hay comprobación de duplicados.
- **`findAll`** usa `all()`: el modelo no tiene `active`.

```ts
import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { db } from '../prisma/db.js';
import { CreateReminderDto } from './dto/create-reminder.dto.js';
import { UpdateReminderDto } from './dto/update-reminder.dto.js';
import { ReminderStatus } from './reminder-status.js';

/** Estados en los que el envío ya está en curso o terminó: no se pueden editar. */
const LOCKED_STATUSES: string[] = [ReminderStatus.QUEUED, ReminderStatus.SENT];

@Injectable()
export class ReminderService {
  private readonly logger = new Logger(ReminderService.name);

  async create(createReminderDto: CreateReminderDto) {
    try {
      const { remindAt, ...rest } = createReminderDto;
      await this.assertOrderExists(rest.orderId);
      const reminder = await db.orm.public.Reminder.create({
        ...rest,
        remindAt: new Date(remindAt),
        status: ReminderStatus.PENDING,
      });
      this.logger.log(`Created reminder ${reminder.id}`);
      return reminder;
    } catch (error) {
      this.handleError('Failed to create reminder', error);
    }
  }

  async findAll() {
    try {
      return await db.orm.public.Reminder.all();
    } catch (error) {
      this.handleError('Failed to fetch reminders', error);
    }
  }

  async findOne(id: string) {
    try {
      const reminder = await db.orm.public.Reminder.whereUnique({ id }).first();
      if (!reminder) throw new NotFoundException(`Reminder ${id} not found`);
      return reminder;
    } catch (error) {
      this.handleError(`Failed to fetch reminder ${id}`, error);
    }
  }

  async update(id: string, updateReminderDto: UpdateReminderDto) {
    try {
      const { status } = await this.findOne(id);
      if (LOCKED_STATUSES.includes(status)) {
        throw new ConflictException(
          `Reminder ${id} is ${status} and cannot be modified`,
        );
      }
      const { remindAt, ...rest } = updateReminderDto;
      await this.assertOrderExists(rest.orderId);
      const reminder = await db.orm.public.Reminder.whereUnique({ id }).update({
        ...rest,
        ...(remindAt !== undefined && { remindAt: new Date(remindAt) }),
      });
      this.logger.log(`Updated reminder ${id}`);
      return reminder;
    } catch (error) {
      this.handleError(`Failed to update reminder ${id}`, error);
    }
  }

  async remove(id: string) {
    try {
      await this.findOne(id);
      const reminder = await db.orm.public.Reminder.where({ id }).delete();
      this.logger.log(`Removed reminder ${id}`);
      return reminder;
    } catch (error) {
      this.handleError(`Failed to remove reminder ${id}`, error);
    }
  }

  private async assertOrderExists(orderId?: string | null) {
    if (!orderId) return;
    const order = await db.orm.public.OrderHeader.whereUnique({
      id: orderId,
    }).first();
    if (!order) {
      throw new BadRequestException(`OrderHeader ${orderId} does not exist`);
    }
  }

  private handleError(message: string, error: unknown): never {
    if (error instanceof HttpException) throw error;
    this.logger.error(
      message,
      error instanceof Error ? error.message : String(error),
    );
    throw new InternalServerErrorException(message);
  }
}
```

- El ORM ignora las propiedades `undefined`, y un `update` sin campos devuelve la fila sin escribir. No hace falta tratar aparte `PATCH {}`.
- La FK se comprueba con `whereUnique` sobre `OrderHeader`, no con `OrderHeaderService.findOne`, que excluye las órdenes `CANCELLED` y obligaría a importar `OrderHeaderModule`.

### 4. Controller

`src/reminder/reminder.controller.ts`: conservar la estructura y `@ApiTags('reminder')`; añadir `ParseUUIDPipe` en `findOne`, `update` y `remove`, y un JSDoc de una línea por método (se convierte en el `summary` de Swagger). Referencia: `src/order-entry/order-entry.controller.ts`.

```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ReminderService } from './reminder.service.js';
import { CreateReminderDto } from './dto/create-reminder.dto.js';
import { UpdateReminderDto } from './dto/update-reminder.dto.js';

@ApiTags('reminder')
@Controller('reminder')
export class ReminderController {
  constructor(private readonly reminderService: ReminderService) {}

  /** Programa un recordatorio (queda en `PENDING`). */
  @Post()
  create(@Body() createReminderDto: CreateReminderDto) {
    return this.reminderService.create(createReminderDto);
  }

  /** Lista los recordatorios. */
  @Get()
  findAll() {
    return this.reminderService.findAll();
  }

  /** Obtiene un recordatorio por id. */
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.reminderService.findOne(id);
  }

  /** Actualiza o reintenta un recordatorio; 409 si está `QUEUED` o `SENT`. */
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateReminderDto: UpdateReminderDto,
  ) {
    return this.reminderService.update(id, updateReminderDto);
  }

  /** Elimina un recordatorio. */
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.reminderService.remove(id);
  }
}
```

### 5. Swagger

- `src/swagger.ts` ya tiene `.addTag('reminder')`, y `docs/specs/05-openapi-swagger.md` ya lista `reminder` en *Contexto* y en *Implementación*. Solo hay que comprobarlo.
- Comprobar en `/docs` que `CreateReminderDto` y `UpdateReminderDto` ya no aparecen vacíos y que `UpdateReminderDto.status` muestra el enum `PENDING`.
- No hacen falta más `@ApiProperty`: el plugin CLI (`nest-cli.json`) genera el resto desde los DTOs y class-validator.

### 6. Tests

`src/reminder/reminder.service.spec.ts` (reemplaza el actual): mock de `../prisma/db.js` con `vi.hoisted` y `vi.fn()` encadenables, como en `src/order-entry/order-entry.service.spec.ts`:

```ts
const { unique, filtered, reminderModel, orderUnique, orderModel, close } =
  vi.hoisted(() => {
    const unique = { first: vi.fn(), update: vi.fn() };
    const filtered = { delete: vi.fn() };
    const reminderModel = {
      create: vi.fn(),
      all: vi.fn(),
      whereUnique: vi.fn(() => unique),
      where: vi.fn(() => filtered),
    };
    const orderUnique = { first: vi.fn() };
    const orderModel = { whereUnique: vi.fn(() => orderUnique) };
    return {
      unique,
      filtered,
      reminderModel,
      orderUnique,
      orderModel,
      close: vi.fn(),
    };
  });

vi.mock('../prisma/db.js', () => ({
  db: {
    orm: { public: { Reminder: reminderModel, OrderHeader: orderModel } },
    close,
  },
}));
```

Casos:
- `create` ok: la orden existe; llama a `Reminder.create` con `remindAt` como `Date` y `status: 'PENDING'`.
- `create` sin `orderId`: no consulta `OrderHeader` y crea el recordatorio.
- `create` con `orderId` inexistente → `BadRequestException` y no llama a `create`.
- `findAll` llama a `Reminder.all()` (no a `where`) y devuelve la lista.
- `findOne` existe → devuelve el registro; no existe → `NotFoundException`.
- `update` ok de un `PENDING` (p. ej. solo `message`): no consulta `OrderHeader` y los datos no llevan `remindAt`.
- `update` con `remindAt` → llega como `Date`.
- `update` de un `FAILED` con `{ status: 'PENDING' }` → llama a `unique.update`.
- `update` de un `QUEUED` y de un `SENT` (`it.each`) → `ConflictException` y no llama a `unique.update`.
- `update` con `orderId` inexistente → `BadRequestException` y no llama a `unique.update`.
- `update` con `orderId: null` → no consulta `OrderHeader` y actualiza. (El tipo del DTO no admite `null`: usar `null as unknown as undefined`.)
- `update` de un id inexistente → `NotFoundException` y no llama a `unique.update`.
- `remove` ok (también de un `QUEUED`); de un id inexistente → `NotFoundException` y no llama a `delete`.
- Un error de BD (`reminderModel.all` rechaza con `Error`) → `InternalServerErrorException`.
- `close` nunca se llama (`afterEach`).

`src/reminder/dto/update-reminder.dto.spec.ts` (nuevo): como `null` y los estados los corta la validación y no el service, se prueban con un `ValidationPipe` con las opciones de `src/main.ts`: `await pipe.transform(body, { type: 'body', metatype: UpdateReminderDto })`. Importar `reflect-metadata` primero. Rechaza `{ remindAt: null }`, `{ message: null }`, `{ status: null }`, `{ status: 'SENT' }` y `{ lastError: 'x' }`; acepta `{}`, `{ orderId: null }` y `{ status: 'PENDING' }`.

`src/reminder/reminder.controller.spec.ts` (reemplaza el actual): el service se sustituye por un objeto de `vi.fn()` con `{ provide: ReminderService, useValue: { create: vi.fn(), findAll: vi.fn(), findOne: vi.fn(), update: vi.fn(), remove: vi.fn() } }`. Cada endpoint delega con los argumentos correctos (`id` y DTO).

Los demás specs de `src/reminder/` no cambian y deben seguir pasando.

### 7. Roadmap

Marcar `Reminder` como `Implementado` en [`00-roadmap.md`](./00-roadmap.md).

## Endpoints

| Método | Ruta | Body | Respuesta | Errores |
|---|---|---|---|---|
| `POST` | `/reminder` | `CreateReminderDto` | 201, el registro creado (`PENDING`) | 400 body inválido u `orderId` inexistente |
| `GET` | `/reminder` | — | 200, la lista | 500 |
| `GET` | `/reminder/:id` | — | 200, el registro | 400 id no UUID, 404 |
| `PATCH` | `/reminder/:id` | `UpdateReminderDto` | 200, el registro actualizado | 400 (body, id o FK), 404, 409 si está `QUEUED` o `SENT` |
| `DELETE` | `/reminder/:id` | — | 200 | 400 id no UUID, 404 |

## Criterios de aceptación

- [ ] Los 5 endpoints responden según la tabla.
- [ ] Ningún método llama a `db.close()`.
- [ ] Un `id` inexistente responde 404; un `id` que no es UUID responde 400.
- [ ] Un `orderId` que no existe responde 400, en `POST` y en `PATCH`.
- [ ] `POST` siempre crea en `PENDING`; enviar `status`, `sentAt`, `lastError` o `externalMessageId` responde 400.
- [ ] `PATCH` con `status` distinto de `PENDING`, o con `null` en `remindAt`, `message` o `status`, responde 400.
- [ ] `PATCH` sobre un recordatorio `QUEUED` o `SENT` responde 409.
- [ ] Un recordatorio creado por API y vencido lo recoge el cron (`PENDING → QUEUED`), sin cambios en los archivos de los specs 01–03.
- [ ] `/docs` muestra el tag `reminder` con los 5 endpoints y los esquemas de los dos DTOs.
- [ ] `npm run lint` y `npm test` pasan.
- [ ] El roadmap marca `Reminder` como `Implementado`.

## Verificación

> Al levantar la app corre también el worker. Con credenciales reales en `.env`, un recordatorio vencido **envía un WhatsApp** a la hora de `REMINDER_CRON`. Usar un `remindAt` lejano y borrar los registros al terminar.

```bash
npm run lint
npx vitest run src/reminder
npm test

npm run start:dev
ORDER_ID=<id de una orden existente>   # POST /order-header, ver spec 10
curl -X POST localhost:3000/reminder -H 'Content-Type: application/json' \
  -d "{\"orderId\":\"$ORDER_ID\",\"message\":\"Recuerda despejar el área del equipo.\",\"remindAt\":\"2027-12-01T14:00:00.000Z\"}"
curl -i -X POST localhost:3000/reminder -H 'Content-Type: application/json' \
  -d '{"orderId":"00000000-0000-0000-0000-000000000000","message":"x","remindAt":"2027-12-01"}'    # 400
curl -i -X POST localhost:3000/reminder -H 'Content-Type: application/json' \
  -d '{"message":"x","remindAt":"2027-12-01","status":"SENT"}'                                     # 400
curl -i -X POST localhost:3000/reminder -H 'Content-Type: application/json' -d '{"message":"x","remindAt":"mañana"}'   # 400
curl localhost:3000/reminder
curl localhost:3000/reminder/<id>
curl -X PATCH localhost:3000/reminder/<id> -H 'Content-Type: application/json' -d '{"remindAt":"2027-12-02T14:00:00.000Z"}'
curl -i -X PATCH localhost:3000/reminder/<id> -H 'Content-Type: application/json' -d '{"remindAt":null}'   # 400
curl -i -X PATCH localhost:3000/reminder/<id-SENT> -H 'Content-Type: application/json' -d '{"message":"y"}' # 409
curl -X DELETE localhost:3000/reminder/<id>
curl -i localhost:3000/reminder/00000000-0000-0000-0000-000000000000   # 404
curl -i localhost:3000/reminder/abc                                    # 400
curl -s localhost:3000/docs-json | jq '.paths | keys | map(select(startswith("/reminder")))'   # ["/reminder", "/reminder/{id}"]
```

## Notas

- **Validación:** `src/main.ts` ya tiene un `ValidationPipe` global (`whitelist`, `forbidNonWhitelisted`, `transform`), así que un campo que no esté en el DTO responde 400.
- **`status` en el contract** sigue siendo un string libre; los valores válidos son los de `src/reminder/reminder-status.ts`.
- **Sin `active`:** `findAll` devuelve todos los recordatorios, también los `SENT` y `FAILED`, y `remove` los borra físicamente, con su historial de envío (`sentAt`, `externalMessageId`).
- **Sin dependientes:** ningún modelo tiene un FK hacia `Reminder`. A la inversa, `DELETE /order-header/:id` falla (500) si la orden tiene recordatorios; hay que borrarlos antes.
- **Recordatorio sin orden:** el contract permite `orderId` nulo, y también desasignarlo con `PATCH { "orderId": null }`, pero el envío lo marcará `FAILED` («no tiene orden o cliente asociado»). Lo mismo si la orden no tiene cliente, o si el cliente está inactivo o no tiene un teléfono válido. Exigir `orderId` requiere cambiar el contract (`orderId String`).
- **Órdenes canceladas:** la FK solo comprueba que la orden exista, y el sender no mira `OrderHeader.status`: un recordatorio de una orden `CANCELLED` **se envía igual**. Queda fuera de alcance, pero conviene resolverlo pronto.
- **`remindAt` y el cron:** el cron corre una vez al día y toma todo lo que vence antes del fin del día en `REMINDER_TZ`; la hora de `remindAt` no se respeta. Una fecha pasada es válida y se envía en la siguiente ejecución. Creado después del cron de hoy, uno para hoy sale mañana.
- **Fecha sin hora:** `"2027-12-01"` se interpreta como medianoche UTC, que en `America/Tegucigalpa` es el día anterior. Enviar siempre la hora y la zona.
- **`FAILED` sin `status`:** `PATCH { "message": ... }` sobre un `FAILED` edita el texto, pero no lo reintenta; para eso hay que enviar también `status: "PENDING"`. `lastError` se conserva hasta que el envío tiene éxito.
- **Carrera con el cron:** entre la comprobación del estado y el `update` el cron podría encolar el recordatorio. Con una ejecución diaria el riesgo es bajo; si importa, hacerlo condicional (`where({ id, status })` con `updateAndCount`).
- **Borrar durante el envío:** si el worker ya está enviando, `DELETE` no detiene el mensaje.
- **Fechas ISO poco comunes:** `@IsDateString()` acepta formatos como `2026-W50`, que `new Date(...)` no entiende (`Invalid Date`) y acaban en 500. Afecta igual a `order-header`.
- **Tipo de recordatorio:** `src/common/types.ts` (sin commitear) define `ReminderType` (`CONFIRMATION` / `REMINDER`), pero `Reminder` no tiene ese campo en el contract y nadie lo importa. Cuando se añada el campo, usar `/resource-sync Reminder`.
