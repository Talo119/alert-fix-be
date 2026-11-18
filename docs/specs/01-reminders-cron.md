# Spec 01 — Cron diario de reminders (Task Scheduling)

> Etapa 1 de 3 del envío de reminders por WhatsApp.
> Siguientes: [02 — Cola BullMQ](./02-reminders-queue-bullmq.md) · [03 — WhatsApp](./03-reminders-whatsapp.md)

## Contexto

AlertFix envía recordatorios a los clientes sobre sus órdenes de mantenimiento. El patrón elegido es:

```
PostgreSQL (tabla Reminder)  ──cron diario──▶  Cola BullMQ  ──worker──▶  WhatsApp (Meta Cloud API)
     fuente de verdad            spec 01          spec 02                  spec 03
```

PostgreSQL es la fuente de verdad. Este spec cubre solo el primer paso: un job programado que corre **una vez al día**, busca los reminders que ya tocan y se los entrega a un "dispatcher". En esta etapa el dispatcher solo registra en el log; en el spec 02 se reemplaza por la cola.

## Objetivo

- Un job `@Cron` diario, con hora y zona horaria configurables por `.env`.
- Selecciona los reminders `PENDING` cuyo `remindAt` es anterior al inicio del día siguiente (en la zona horaria configurada). Incluye los atrasados de días anteriores.
- Entrega esos reminders a `ReminderDispatcher`.
- Unifica el código de reminders en `src/reminder/` (`ReminderModule`).

## Alcance

**Dentro:**
- Estados de reminder como constantes.
- Puerto `ReminderDispatcher` + implementación temporal que solo loguea.
- Servicio con el `@Cron` y la consulta a la base de datos.
- Eliminación del placeholder `src/reminders/`.
- Tests unitarios.

**Fuera:**
- Crear los reminders al crear una orden (se asume que las filas ya existen en `Reminder`).
- El CRUD real de `ReminderService` / `ReminderController` (sigue siendo el scaffold).
- Cola y envío: specs 02 y 03.
- Ejecución en varias instancias. La app corre en **una sola instancia**, así que no se usa `@nestjs/locks`. Si en el futuro hay réplicas, añadir `@OnOneInstance({ key: 'reminders-daily' })` debajo de `@Cron` (ver https://docs.nestjs.com/reliability/locks.md) con un `LockStore` en PostgreSQL.

## Diseño

### Estados (`src/reminder/reminder-status.ts`)

`Reminder.status` es un `String` libre en el contrato. Se fijan los valores en código:

```ts
export const ReminderStatus = {
  PENDING: 'PENDING', // creado, esperando su fecha
  QUEUED: 'QUEUED',   // encolado en BullMQ (spec 02)
  SENT: 'SENT',       // enviado por WhatsApp (spec 03)
  FAILED: 'FAILED',   // agotó reintentos o error no recuperable
} as const;

export type ReminderStatus = (typeof ReminderStatus)[keyof typeof ReminderStatus];
```

Flujo: `PENDING → QUEUED → SENT | FAILED`. En este spec ningún estado cambia; solo se leen los `PENDING`.

### Puerto `ReminderDispatcher` (`src/reminder/reminder-dispatcher.ts`)

Clase abstracta usada como token de inyección, para poder cambiar la implementación en el spec 02 sin tocar el cron:

```ts
import type { Reminder } from './reminder.types.js';

export abstract class ReminderDispatcher {
  abstract dispatch(reminders: Reminder[]): Promise<void>;
}
```

`Reminder` es el tipo de fila del contrato. Tomarlo de `contract.d.ts` (ver § *Naming model and result types* en la skill de Prisma 8, p. ej. `Models.public_Reminder`) y reexportarlo desde `src/reminder/reminder.types.ts`.

### Implementación temporal (`src/reminder/logging-reminder-dispatcher.ts`)

```ts
@Injectable()
export class LoggingReminderDispatcher extends ReminderDispatcher {
  private readonly logger = new Logger(LoggingReminderDispatcher.name);

  async dispatch(reminders: Reminder[]): Promise<void> {
    for (const r of reminders) {
      this.logger.log(`Reminder ${r.id} listo para enviar (remindAt=${r.remindAt.toISOString()})`);
    }
  }
}
```

No modifica estados: si el cron corre dos veces, los mismos reminders vuelven a aparecer. Es lo esperado hasta el spec 02.

### Scheduler (`src/reminder/reminder-scheduler.service.ts`)

```ts
import 'dotenv/config';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { db } from '../prisma/db.js';

export const REMINDERS_CRON_NAME = 'reminders-daily';
const CRON = process.env.REMINDER_CRON ?? '0 0 8 * * *'; // 6 campos: seg min hora día mes díaSemana
const TZ = process.env.REMINDER_TZ ?? 'UTC';

@Injectable()
export class ReminderSchedulerService {
  private readonly logger = new Logger(ReminderSchedulerService.name);

  constructor(private readonly dispatcher: ReminderDispatcher) {}

  @Cron(CRON, { name: REMINDERS_CRON_NAME, timeZone: TZ, waitForCompletion: true })
  async handleCron(): Promise<void> {
    await this.processDueReminders();
  }

  /** Público para tests y para dispararlo a mano. */
  async processDueReminders(now: Date = new Date()): Promise<number> {
    const until = startOfNextDay(now, TZ);
    const due = await db.orm.public.Reminder
      .where({ status: ReminderStatus.PENDING })
      .where((r) => r.remindAt.lt(until))
      .orderBy((r) => r.remindAt.asc())
      .all();

    this.logger.log(`${due.length} reminders pendientes hasta ${until.toISOString()}`);
    if (due.length > 0) await this.dispatcher.dispatch(due);
    return due.length;
  }
}
```

Notas:
- **Los argumentos de `@Cron` se evalúan al importar el archivo.** `nest start` carga `.env`, pero importar `dotenv/config` en el propio archivo lo garantiza también en tests y en `start:prod`.
- `waitForCompletion: true` evita que dos ejecuciones se solapen en el mismo proceso.
- `@nestjs/schedule` envuelve el método en try/catch y loguea los errores; aun así, `processDueReminders` no debe tragarse excepciones, para que Observe las registre.
- Si la lista crece mucho, procesar por lotes (`limit` + bucle). No es necesario en esta etapa.
- Verificar la sintaxis exacta de `.where(...).where(...)` y `.orderBy` en `node_modules/@prisma/orm-postgres/skills/prisma-8/references/queries-postgres.md`.

### Cálculo de `startOfNextDay(now, tz)` (`src/reminder/date-utils.ts`)

"Hoy" depende de la zona horaria del negocio, no de la del servidor. Usar `Intl.DateTimeFormat` con `timeZone: tz` para obtener año/mes/día locales de `now`, sumar un día y convertir la medianoche local de vuelta a `Date` (UTC). Sin dependencias nuevas. Función pura, con tests propios.

### Registro en módulos

`src/reminder/reminder.module.ts`:

```ts
@Module({
  controllers: [ReminderController],
  providers: [
    ReminderService,
    ReminderSchedulerService,
    { provide: ReminderDispatcher, useClass: LoggingReminderDispatcher },
  ],
})
export class ReminderModule {}
```

`src/app.module.ts`: quitar `RemindersService` de `providers` y su import. `ScheduleModule.forRoot()` se queda donde está (importarlo solo una vez).

Eliminar `src/reminders/reminders.service.ts` y `src/reminders/reminders.service.spec.ts`.

## Variables de entorno

Añadir a `.env.example`:

```bash
# Cron del job diario de reminders (6 campos, segundos primero). Por defecto 08:00.
REMINDER_CRON="0 0 8 * * *"
# Zona horaria IANA del negocio. Por defecto UTC.
REMINDER_TZ="America/Tegucigalpa"
```

Un `REMINDER_TZ` inválido hace fallar el arranque (lo valida `cron`), lo cual es deseable.

## Cambios de contrato

Ninguno.

## Plan de pruebas

`src/reminder/reminder-scheduler.service.spec.ts` (Vitest):
- Mock de `../prisma/db.js` con `vi.mock`, que devuelve una cadena `where/orderBy/all` controlada.
- `ReminderDispatcher` como `{ dispatch: vi.fn() }`.
- Casos:
  - Sin pendientes → no llama a `dispatch`, devuelve 0.
  - Con pendientes → llama a `dispatch` una vez con todos.
  - Se pasa `until` = inicio del día siguiente según `REMINDER_TZ`.

`src/reminder/date-utils.spec.ts`:
- `startOfNextDay` con `UTC` y con `America/Tegucigalpa` (UTC-6), incluidos instantes cerca de la medianoche (p. ej. 23:30 local = 05:30 UTC del día siguiente).

Smoke test opcional: obtener el job con `SchedulerRegistry.getCronJob('reminders-daily')` y llamar a `fireOnTick()`.

## Criterios de aceptación

- [ ] `src/reminders/` ya no existe y `AppModule` no registra `RemindersService`.
- [ ] Al arrancar (`npm run start:dev`), `SchedulerRegistry.getCronJob('reminders-daily')` existe y `nextDate()` coincide con `REMINDER_CRON`/`REMINDER_TZ`.
- [ ] Con filas `PENDING` en la base de datos, `processDueReminders()` loguea las vencidas (hoy y anteriores) y no las futuras.
- [ ] `npm test`, `npm run lint` y `npm run build` pasan.

## Riesgos / puntos a verificar

- Sintaxis exacta de comparación de fechas en Prisma 8 (`r.remindAt.lt(date)`) y el tipo de `remindAt` en `contract.d.ts` (`Date` o tipo temporal).
- Si el servidor está caído a la hora del cron, ese día no se ejecuta (no hay catch-up). Al incluir los atrasados, el siguiente run los recoge.
