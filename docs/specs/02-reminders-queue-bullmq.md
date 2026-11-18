# Spec 02 — Cola de reminders con BullMQ (backend PostgreSQL)

> Etapa 2 de 3 del envío de reminders por WhatsApp.
> Anterior: [01 — Cron diario](./01-reminders-cron.md) · Siguiente: [03 — WhatsApp](./03-reminders-whatsapp.md)

## Contexto

El spec 01 deja un cron diario que encuentra los reminders `PENDING` vencidos y se los pasa a `ReminderDispatcher`, que por ahora solo loguea. Este spec cambia ese dispatcher por una cola **BullMQ** y añade un **worker** que procesa cada reminder con reintentos y backoff exponencial.

Se usa el paquete oficial `@nestjs/bullmq` (https://docs.nestjs.com/application/queues.md) con el **backend PostgreSQL** de BullMQ, para no añadir Redis a la infraestructura. El envío real por WhatsApp llega en el spec 03; aquí el worker usa un `ReminderSender` temporal que solo loguea.

## Objetivo

- Encolar un job por reminder, sin duplicados, y marcar el reminder como `QUEUED`.
- Un worker que procesa los jobs, llama a `ReminderSender` y marca `SENT`.
- Reintentos con backoff exponencial; al agotarlos, marcar `FAILED` con el error.

## Alcance

**Dentro:** instalación y configuración de BullMQ sobre PostgreSQL, cola `reminders`, productor, consumidor, puerto `ReminderSender` con implementación temporal, campos nuevos en `Reminder`, tests.

**Fuera:** integración con WhatsApp (spec 03), dashboard de colas, varias instancias.

## Dependencias

```bash
npm install --save @nestjs/bullmq bullmq pg
npm install --save-dev @types/pg   # solo si TypeScript lo pide
```

No se instala `ioredis`.

## Diseño

### Configuración global (`src/app.module.ts`)

```ts
import { BullModule } from '@nestjs/bullmq';
import { createPostgresBackend } from 'bullmq';

const dbUrl = new URL(process.env.DATABASE_URL!);

BullModule.forRoot({
  backendFactory: createPostgresBackend,
  connection: {
    host: dbUrl.hostname,
    port: Number(dbUrl.port || 5432),
    user: decodeURIComponent(dbUrl.username),
    password: decodeURIComponent(dbUrl.password),
    database: dbUrl.pathname.slice(1),
    migrate: true,
  },
}),
```

- Se parsea `DATABASE_URL` porque la documentación solo muestra campos separados y no dice si acepta una URL. Extraer el parseo a `src/queue/postgres-connection.ts` con su test.
- `migrate: true` crea las tablas de BullMQ al arrancar en un schema propio `bullmq`, separado del schema `public` de Prisma. Sin esa opción la app falla en una base sin esas tablas.
- `backendFactory` se propaga a `Queue`, `Worker`, `QueueEvents` y `FlowProducer`.

### Cola (`src/reminder/reminder-queue.ts` + `ReminderModule`)

```ts
export const REMINDERS_QUEUE = 'reminders';
export const SEND_REMINDER_JOB = 'send-reminder';
export interface SendReminderJobData { reminderId: string }
```

En `ReminderModule`: `imports: [BullModule.registerQueue({ name: REMINDERS_QUEUE })]`.

### Productor: `QueueReminderDispatcher` (`src/reminder/queue-reminder-dispatcher.ts`)

Reemplaza a `LoggingReminderDispatcher` del spec 01 (`{ provide: ReminderDispatcher, useClass: QueueReminderDispatcher }`).

```ts
@Injectable()
export class QueueReminderDispatcher extends ReminderDispatcher {
  constructor(@InjectQueue(REMINDERS_QUEUE) private readonly queue: Queue<SendReminderJobData>) {
    super();
  }

  async dispatch(reminders: Reminder[]): Promise<void> {
    for (const r of reminders) {
      await this.queue.add(SEND_REMINDER_JOB, { reminderId: r.id }, {
        jobId: r.id,                                   // dedup: el mismo reminder no se encola dos veces
        attempts: 5,
        backoff: { type: 'exponential', delay: 60_000 }, // 1m, 2m, 4m, 8m
        removeOnComplete: true,
        removeOnFail: 1000,                            // conservar los últimos 1000 fallidos para diagnóstico
      });
      await db.orm.public.Reminder
        .where({ id: r.id, status: ReminderStatus.PENDING })
        .update({ status: ReminderStatus.QUEUED });
    }
  }
}
```

**Orden: primero encolar, después marcar `QUEUED`.** Si el proceso cae entre ambos pasos, el reminder sigue `PENDING`; el siguiente run lo re-encola con el mismo `jobId` y BullMQ lo descarta si el job aún existe. Si el job ya terminó y se borró (`removeOnComplete`), el worker ya lo marcó `SENT` y el cron no lo vuelve a seleccionar.

Valores de `attempts`/`backoff`: constantes en `reminder-queue.ts`; se pueden pasar a `.env` más adelante.

### Puerto `ReminderSender` (`src/reminder/reminder-sender.ts`)

```ts
export interface ReminderSendResult { externalMessageId?: string }

export abstract class ReminderSender {
  abstract send(reminder: ReminderWithClient): Promise<ReminderSendResult>;
}
```

`ReminderWithClient` = reminder + `order` + `order.client` (lo que necesita el spec 03 para el teléfono y el nombre). Implementación temporal `LoggingReminderSender`: loguea y devuelve `{}`.

### Consumidor: `ReminderProcessor` (`src/reminder/reminder.processor.ts`)

```ts
@Processor(REMINDERS_QUEUE)
export class ReminderProcessor extends WorkerHost {
  private readonly logger = new Logger(ReminderProcessor.name);

  constructor(private readonly sender: ReminderSender) { super(); }

  async process(job: Job<SendReminderJobData>): Promise<void> {
    const reminder = await db.orm.public.Reminder
      .include('order', (o) => o.include('client'))
      .first({ id: job.data.reminderId });

    if (!reminder) throw new UnrecoverableError(`Reminder ${job.data.reminderId} no existe`);
    if (reminder.status === ReminderStatus.SENT) return; // idempotencia

    const result = await this.sender.send(reminder);

    await db.orm.public.Reminder.where({ id: reminder.id }).update({
      status: ReminderStatus.SENT,
      sentAt: new Date(),
      lastError: null,
      externalMessageId: result.externalMessageId ?? null, // campo del spec 03; omitir hasta entonces
    });
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<SendReminderJobData> | undefined, error: Error): Promise<void> {
    if (!job) return;
    const final = error instanceof UnrecoverableError || job.attemptsMade >= (job.opts.attempts ?? 1);
    this.logger.warn(`Reminder ${job.data.reminderId} falló (intento ${job.attemptsMade}): ${error.message}`);
    await db.orm.public.Reminder.where({ id: job.data.reminderId }).update({
      lastError: error.message.slice(0, 1000),
      ...(final ? { status: ReminderStatus.FAILED } : {}),
    });
  }
}
```

- Lanzar un error normal → BullMQ reintenta con backoff. Lanzar `UnrecoverableError` (de `bullmq`) → no reintenta.
- El registro de providers: `ReminderProcessor`, `{ provide: ReminderSender, useClass: LoggingReminderSender }`.
- Concurrencia: por defecto 1 job a la vez; suficiente para el volumen esperado. Si hace falta, configurarla en `@Processor(REMINDERS_QUEUE, { concurrency: N })` (verificar la opción en la doc de `@nestjs/bullmq`).
- `onFailed` es `async`: si el update falla, registrarlo con el logger (lint exige manejar todas las promesas).

## Variables de entorno

Ninguna nueva; se reutiliza `DATABASE_URL`.

## Cambios de contrato

En `src/prisma/contract.prisma`, modelo `Reminder`:

```prisma
  sentAt    DateTime?
  lastError String?
```

Luego: `npm run contract:emit`, generar/aplicar la migración (`migrations/`), y commitear `contract.prisma`, `contract.json` y `contract.d.ts` juntos.

## Plan de pruebas

- `queue-reminder-dispatcher.spec.ts`: `queue.add` como `vi.fn()`; verifica `jobId = reminder.id`, `attempts`, `backoff`; que el update a `QUEUED` va **después** de `add`; que si `add` lanza, no se marca `QUEUED`.
- `reminder.processor.spec.ts`:
  - Éxito → llama a `sender.send` y marca `SENT` con `sentAt`.
  - Reminder ya `SENT` → no llama a `sender.send`.
  - Reminder inexistente → `UnrecoverableError`.
  - `onFailed` con intentos restantes → solo `lastError`; con el último intento o `UnrecoverableError` → `FAILED`.
- `postgres-connection.spec.ts`: parseo de URL con usuario/contraseña codificados y puerto por defecto.
- Prueba manual con Postgres local: insertar un `Reminder` `PENDING` vencido, llamar a `processDueReminders()` y comprobar `PENDING → QUEUED → SENT`; comprobar que existe el schema `bullmq`.

## Criterios de aceptación

- [ ] La app arranca contra la base local y crea el schema `bullmq`.
- [ ] Un reminder vencido pasa a `QUEUED` y luego a `SENT` (con `LoggingReminderSender`).
- [ ] Ejecutar `processDueReminders()` dos veces seguidas no duplica jobs.
- [ ] Un sender que siempre falla deja el reminder en `FAILED` con `lastError` tras 5 intentos.
- [ ] `npm test`, `npm run lint` y `npm run build` pasan.

## Riesgos / puntos a verificar

- **Backend PostgreSQL de BullMQ**: la doc de Nest no detalla limitaciones frente a Redis (eventos, backoff, dedup por `jobId`, delayed jobs). Validar en bullmq.io antes de implementar y cubrirlo con la prueba manual.
- Que `prisma db init` / migraciones de Prisma ignoren el schema `bullmq` y no intenten borrarlo.
- Firma exacta del evento `failed` en `WorkerListener` y el campo `attemptsMade` (en BullMQ v5+ cuenta los intentos ya hechos).
- Pool de conexiones: BullMQ abre conexiones propias a la misma base; revisar `max_connections` de Postgres.
