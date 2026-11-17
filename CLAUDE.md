# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run start:dev        # watch mode (nest start loads .env)
npm run build            # nest build -> dist/
npm run lint             # oxlint --type-aware over src/ and test/
npm run format           # prettier (single quotes, trailing commas)
npm test                 # unit tests: all **/*.spec.ts via Vitest
npm run test:e2e         # **/*.e2e-spec.ts via vitest.config.e2e.ts
npx vitest run src/reminder/reminder.service.spec.ts   # one file
npx vitest run -t "should be defined"                   # by test name

npm run contract:emit    # regenerate src/prisma/contract.{json,d.ts} after editing contract.prisma
npx prisma db init       # create tables in the database
npx prisma migration status
```

Lint treats `typescript/no-floating-promises` as an error: await or explicitly handle every promise.

## Stack specifics

- **NestJS 12, ESM-only** (`"type": "module"`, tsconfig `module: preserve` / `moduleResolution: bundler`). Relative imports must end in `.js`; `main.ts` uses top-level `await bootstrap()`.
- **Prisma ORM 8 (contract-based, not the classic `@prisma/client`).** There is no `schema.prisma` or generated client:
  - Models live in `src/prisma/contract.prisma` (Prisma 8 syntax: `@onCreate(uuid())`, `temporal.UpdatedAt`).
  - `npm run contract:emit` compiles it to `contract.json` + `contract.d.ts`; commit all three together.
  - `src/prisma/db.ts` exports a ready `db` instance built from `contract.json` and `DATABASE_URL`. Queries look like `db.orm.public.User.where({ email }).first()`.
  - `migrations/snapshots/<hash>/` holds contract snapshots; `migrations/app/refs/db.json` records which contract hash the database is at.
  - `prisma.config.ts` points the CLI at the contract and reads `DATABASE_URL` from `.env` (PostgreSQL >= 15; see `.env.example`). `prisma-8.md` has more Prisma 8 reference.
  - `db` is currently a plain module export, not wrapped in a Nest provider.
- **NestJS Observe** is wired in `src/app.module.ts` via `createObserveModule()`; `main.ts` must pass `ObserveInstrument` to `NestFactory.create`, and the same instrument must be kept if bootstrapping changes.
- **`@nestjs/schedule`** is enabled globally (`ScheduleModule.forRoot()`), so any provider can use `@Cron`.

## Project goal

AlertFix manages clients and their maintenance orders, and sends WhatsApp notification reminders to clients about those orders.

## Domain model

Everything hangs off `Company` (tenant): `User`, `Client` and `Service` each have an optional `companyId`. An order is `OrderHeader` (client, company, `serviceDate`, `status`) with line items in `OrderEntry` (service + quantity). `Reminder` belongs to an `OrderHeader` and has `message`, `remindAt`, `status`. All IDs are UUID strings and `status` fields are free-form strings (no enums yet).

## Current state of the code

- `src/reminders/reminders.service.ts`: a placeholder `@Cron` job, registered directly as a provider in `AppModule`.
- `src/reminder/`: a `nest g resource` CRUD scaffold (`ReminderModule`, imported in `AppModule`). The service returns stub strings, DTOs and the entity are empty, and the controller parses `:id` with `+id` even though model IDs are UUID strings.
- The two reminder directories overlap; check which one a task means before adding to either.
- The e2e test expects `GET /` to return `Hello World!` from `AppController`.

## Conventions

- Specs and design docs go in `docs/specs/*.md` in this repo.
