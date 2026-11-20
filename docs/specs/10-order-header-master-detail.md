# Spec 10 — OrderHeader maestro-detalle (orden + líneas en una transacción)

> Roadmap: [00 — Roadmap de recursos](./00-roadmap.md) · Base: [08 — OrderHeader](./08-resource-order-header.md), [09 — OrderEntry](./09-resource-order-entry.md)

## Contexto

`OrderHeader` (spec 08) y `OrderEntry` (spec 09) tienen hoy CRUDs independientes: para crear una orden con sus líneas hay que llamar a `POST /order-header` y luego a `POST /order-entry` por cada línea. Si una de esas llamadas falla, la orden queda sin líneas o con líneas a medias, y `GET /order-header/:id` no devuelve las líneas. Ambos specs dejaron este punto en *Fuera (futuro)*.

Este spec convierte `order-header` en un recurso **maestro-detalle**: la cabecera y sus líneas se guardan juntas, en una sola transacción de base de datos.

## Objetivo

- `POST /order-header` recibe la cabecera y un arreglo `entries` (mínimo 1) y guarda todo de forma atómica.
- `PATCH /order-header/:id` actualiza la cabecera y, si el body trae `entries`, **reemplaza** todas las líneas de la orden, también de forma atómica.
- Cualquier error en cualquier punto (FK inexistente, fallo de BD) hace **rollback**: no queda nada guardado.
- `GET /order-header/:id` devuelve la cabecera con su arreglo `entries`.

## Alcance

**Dentro:** relación inversa `entries` en el contract, DTO anidado de línea, transacciones en `create`/`update`, `include` en `findOne`, tests, y actualizar las skills `resource-spec` / `resource-sync` y el roadmap.

**Fuera (futuro):** borrar la orden con sus líneas (cascada) en `remove`; incluir `entries` en `findAll`; sincronizar líneas por `id` (en vez de reemplazo); incluir `client` en las respuestas, y `service` en `create`/`update`; precios y totales.

## Transacciones en Prisma 8

`db.transaction(async (tx) => { ... })` abre una transacción y le pasa `tx`, que tiene la misma API que `db` (`tx.orm.public.<Model>`). Hace **commit** si el callback termina bien y **rollback** si lanza. Dentro del callback, todas las consultas van por `tx`, nunca por `db` (irían fuera de la transacción). El valor que retorna el callback es el que retorna `db.transaction(...)`.

## Pasos de implementación

### 1. Contract

`src/prisma/contract.prisma`, en `model OrderHeader`:

```prisma
entries   OrderEntry[]
```

Es una relación solo de dominio: la FK `orderId` ya está en `OrderEntry`, así que no cambia ninguna tabla. Ejecutar `npm run contract:emit` y comprobar que `storageHash` en `src/prisma/contract.json` sigue igual al de `migrations/app/refs/db.json` (no hace falta migración). Commitear `contract.prisma`, `contract.json` y `contract.d.ts` juntos. Esto habilita `.include('entries')`.

### 2. DTOs

Nuevo `src/order-header/dto/order-header-entry.dto.ts` (una línea de la orden; sin `orderId`, lo asigna el service):

```ts
import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';

export class OrderHeaderEntryDto {
  /** Servicio del catálogo (`Service`) que se presta. */
  @IsOptional()
  @IsUUID()
  serviceId?: string;

  /** Cantidad del servicio. Entero, mínimo 1. */
  @IsInt()
  @Min(1)
  quantity: number;
}
```

`src/order-header/dto/create-order-header.dto.ts`, nueva propiedad:

```ts
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, ValidateNested } from 'class-validator';
import { OrderHeaderEntryDto } from './order-header-entry.dto.js';

  /** Líneas de la orden (servicio + cantidad). Al menos una. */
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderHeaderEntryDto)
  entries: OrderHeaderEntryDto[];
```

`UpdateOrderHeaderDto` no cambia: `PartialType` vuelve `entries` opcional y conserva `@ArrayMinSize(1)` si se envía. `@Type` es necesario para que el `ValidationPipe` global (`transform: true`, `whitelist`, `forbidNonWhitelisted`) valide cada línea y rechace campos extra (p. ej. `orderId`) con 400.

### 3. Service

`src/order-header/order-header.service.ts`. Se mantiene el `try/catch` + `handleError` (relanza `HttpException`, el resto → 500); la transacción va dentro del `try`. Una excepción lanzada dentro del callback provoca el rollback y luego llega al `catch`.

```ts
type Orm = typeof db.orm.public;
```

**`assertReferencesExist(orm: Orm, dto: UpdateOrderHeaderDto)`**: recibe `tx.orm.public`. Valida `clientId` y `companyId` (como hoy) y cada `serviceId` distinto de `dto.entries` contra `Service` → `BadRequestException(\`Service ${id} does not exist\`)`.

**`create(dto)`**:

```ts
const { serviceDate, entries, ...rest } = dto;
const order = await db.transaction(async (tx) => {
  const orm = tx.orm.public;
  await this.assertReferencesExist(orm, dto);
  const header = await orm.OrderHeader.create({
    ...rest,
    serviceDate: new Date(serviceDate),
  });
  const created = await this.createEntries(orm, header.id, entries);
  return { ...header, entries: created };
});
this.logger.log(`Created order ${order.id} with ${order.entries.length} entries`);
return order;
```

**`createEntries(orm, orderId, entries)`** (privado, compartido por `create` y `update`): crea las líneas en secuencia (no `Promise.all`): una transacción usa una sola conexión y el primer fallo corta el resto. Pasa los campos explícitos, `{ serviceId: serviceId ?? null, quantity, orderId }`, en vez de `{ ...entry }`: el lint avisa del spread de instancias de clase (`no-misused-spread`).

**`update(id, dto)`**: todo dentro de `db.transaction`:

1. `orm.OrderHeader.whereUnique({ id }).first()` → `NotFoundException` si `null` (dentro de la transacción, no vía `this.findOne`, que usa `db`).
2. `assertReferencesExist(orm, dto)`.
3. Si el DTO trae campos de cabecera, `orm.OrderHeader.whereUnique({ id }).update({...})` con la conversión condicional de `serviceDate` de hoy; si no, se usa la cabecera leída en el punto 1.
4. Si `entries !== undefined`: `orm.OrderEntry.where({ orderId: id }).deleteAll()` y crear las nuevas con `orderId: id`.
5. Retornar `{ ...header, entries: await orm.OrderEntry.where({ orderId: id }).all() }`.

**`findOne(id)`**: include anidado; cada línea trae su servicio, limitado a `id`, `name` y `description` → `NotFoundException` si `null`.

```ts
db.orm.public.OrderHeader.where({ id })
  .include('entries', (entries) =>
    entries.include('service', (service) =>
      service.select('id', 'name', 'description'),
    ),
  )
  .first();
```

Las líneas sin `serviceId` traen `service: null`.

`findAll` y `remove` no cambian.

### 4. Controller

Sin cambios de código. Actualizar los JSDoc (se usan como `summary` en Swagger):
- `create`: `/** Crea una orden con sus líneas, en una sola transacción. */`
- `findOne`: `/** Obtiene una orden por id, con sus líneas. */`
- `update`: `/** Actualiza una orden; si se envía \`entries\`, reemplaza todas sus líneas. */`

### 5. Tests

`order-header.service.spec.ts`:
- Mock: añadir a `db.orm.public` `OrderEntry` (`create`, `where → { deleteAll, all }`) y `Service` (`whereUnique → { first }`); `OrderHeader.where` también devuelve `include → { first }`; y `db.transaction: vi.fn(async (fn) => fn({ orm: db.orm }))`.
- `create`: crea la cabecera y N líneas con el `orderId` de la cabecera, dentro de `db.transaction`, y devuelve `{ ...header, entries }`; `serviceId` inexistente → 400 sin llamar a `OrderHeader.create`; si `OrderEntry.create` falla en la 2.ª línea → `InternalServerErrorException` lanzada desde el callback (lo que hace rollback en la BD real).
- `update`: sin `entries` no toca `OrderEntry`; con `entries` llama `where({ orderId: id }).deleteAll()` y luego crea las nuevas; id inexistente → 404 sin escribir nada; client/company/service inexistente → 400.
- `findOne`: llama a `include('entries')` y devuelve las líneas; 404.
- Ajustar los tests de create/update que ya existen al DTO nuevo (`entries`) y al uso de `tx`.

`order-header.controller.spec.ts`: añadir `entries` al DTO del test de `create`.

### 6. Documentación y skills

- Specs 08 y 09: en *Fuera (futuro)*, marcar como cubierto por este spec.
- `00-roadmap.md`: spec de OrderHeader → `[08](./08-resource-order-header.md) · [10](./10-order-header-master-detail.md)`; nueva sección *Relaciones maestro-detalle* con `OrderHeader | entries | OrderEntry | [10](./10-order-header-master-detail.md)`.
- `.claude/skills/resource-spec` y `.claude/skills/resource-sync`: aprender el patrón maestro-detalle (DTO anidado, transacción, `include`, sincronizar los campos nuevos del detalle hacia el DTO anidado del maestro).

## Endpoints

| Método | Ruta | Body | Respuesta | Errores |
|---|---|---|---|---|
| `POST` | `/order-header` | `CreateOrderHeaderDto` con `entries` (≥ 1) | 201, cabecera + `entries` | 400 validación / FK inexistente (client, company, service), 500 → rollback |
| `GET` | `/order-header/:id` | — | 200, cabecera + `entries` (cada una con `service`) | 400 id no UUID, 404 |
| `PATCH` | `/order-header/:id` | `UpdateOrderHeaderDto` (`entries` opcional, reemplaza) | 200, cabecera + `entries` | 400, 404, 500 → rollback |
| `GET` / `DELETE` | sin cambios | | | `DELETE` de una orden con líneas falla por FK (fuera de alcance) |

Ejemplo de body:

```json
{
  "clientId": "a1b2c3d4-1234-4abc-8def-0123456789ab",
  "companyId": "c0ffee00-1234-4abc-8def-0123456789ab",
  "serviceDate": "2026-12-01T14:00:00.000Z",
  "status": "SCHEDULED",
  "entries": [
    { "serviceId": "5e7f0000-1234-4abc-8def-0123456789ab", "quantity": 2 },
    { "serviceId": "5e7f0001-1234-4abc-8def-0123456789ab", "quantity": 1 }
  ]
}
```

## Criterios de aceptación

- [ ] `POST` sin `entries` o con `entries: []` → 400.
- [ ] `POST` con un `serviceId` inexistente → 400 y no se crea ninguna cabecera ni línea.
- [ ] Un fallo de BD al crear una línea deja la BD como estaba (rollback).
- [ ] `PATCH` con `entries` deja solo las líneas nuevas; sin `entries` no toca las líneas.
- [ ] `GET /order-header/:id` incluye `entries`, cada una con `service { id, name, description }`.
- [ ] Ninguna consulta dentro de la transacción usa `db` en lugar de `tx`.
- [ ] `storageHash` del contract sin cambios; `npm run lint`, `npm run build` y `npm test` pasan.

## Verificación

```bash
npm run contract:emit && git diff --stat src/prisma/
npm run lint && npm run build
npx vitest run src/order-header
npm test

npm run start:dev
curl -X POST localhost:3000/order-header -H 'Content-Type: application/json' -d @order.json      # 201 con entries
curl -i -X POST localhost:3000/order-header -H 'Content-Type: application/json' \
  -d '{"serviceDate":"2026-12-01T14:00:00.000Z","status":"SCHEDULED","entries":[{"serviceId":"00000000-0000-4000-8000-000000000000","quantity":1}]}'   # 400
curl localhost:3000/order-header      # la orden del 400 no aparece
curl -X PATCH localhost:3000/order-header/<id> -H 'Content-Type: application/json' -d '{"entries":[{"quantity":3}]}'
curl localhost:3000/order-header/<id>  # cabecera + 1 sola línea
```

## Notas

- `entries` usa reemplazo total: los `id` de las líneas cambian en cada `PATCH` con `entries`. Si algo externo llegara a referenciar `OrderEntry.id`, habría que pasar a sincronizar por `id`.
- `/order-entry` sigue existiendo para editar líneas sueltas; esas operaciones no son parte de la transacción del maestro.
- `remove` de una orden con líneas (o recordatorios) falla por la FK; borrar en cascada dentro de una transacción es el siguiente paso natural.
