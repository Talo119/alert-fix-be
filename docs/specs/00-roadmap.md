# Roadmap de recursos

> Control de los modelos de `src/prisma/contract.prisma` y su recurso CRUD.
> Generar el spec de un modelo: `/resource-spec <Modelo>`.
> Última actualización: 2026-11-19

| # | Modelo | Recurso | Depende de | Estado | Spec |
|---|---|---|---|---|---|
| 1 | Company | `company` | — | Implementado | [04](./04-resource-company.md) |
| 2 | User | `user` | Company | Implementado | — |
| 3 | Client | `client` | Company | Pendiente | — |
| 4 | Service | `service` | Company | Pendiente | — |
| 5 | OrderHeader | `order-header` | Client, Company | Pendiente | — |
| 6 | OrderEntry | `order-entry` | OrderHeader, Service | Pendiente | — |
| 7 | Reminder | `reminder` | OrderHeader | Parcial (solo `findOne`; el cron, la cola y WhatsApp vienen de los specs 01–03) | [01](./01-reminders-cron.md) · [02](./02-reminders-queue-bullmq.md) · [03](./03-reminders-whatsapp.md) |

## Estados

- **Pendiente**: sin spec.
- **Spec lista**: spec escrito (lo marca `/resource-spec`), falta implementar.
- **Parcial**: existe código, pero el CRUD no está completo.
- **Implementado**: CRUD completo con tests. Lo marca quien implementa el spec, en el último paso.

## Pendientes transversales

Ninguno. Resueltos el 2026-11-19:

- `ValidationPipe` global en `src/main.ts` (`whitelist`, `forbidNonWhitelisted`, `transform`), con `class-transformer` como dependencia.
- Correcciones en `src/user/`: sin `db.close()`, `NotFoundException` solo cuando el registro no existe (los errores de BD se propagan), sin `id` en `CreateUserDto`, sin `dto/user-item.dto.ts` y con `ParseUUIDPipe` en `:id`.
