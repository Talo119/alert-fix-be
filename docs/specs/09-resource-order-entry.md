# Spec 09 — Recurso OrderEntry (CRUD)

> Roadmap: [00 — Roadmap de recursos](./00-roadmap.md) · Referencia: `src/order-header/`, `src/service/`, `src/user/`

## Contexto

`OrderEntry` es una línea de una orden de mantenimiento en AlertFix: une una orden (`orderId` → `OrderHeader`) con un servicio del catálogo de la empresa (`serviceId` → `Service`) y la cantidad contratada (`quantity`). La cabecera de la orden (cliente, empresa, `serviceDate`, `status`) ya tiene su recurso `order-header` (spec 08), y el catálogo de servicios el recurso `service` (spec 07).

Hoy no existe `src/order-entry/` ni un endpoint para añadir líneas a una orden; hay que insertarlas directamente en la base de datos. Este spec crea el recurso desde cero con `nest g resource`, siguiendo la estructura de `src/order-header/`, que ya resuelve el caso de dos FKs con un helper privado.

## Objetivo

- Un recurso REST `order-entry` con CRUD completo sobre `db.orm.public.OrderEntry`.
- DTOs validados con class-validator a partir del contract.
- Errores HTTP correctos: 400 / 404 / 500 (no hay campos `@unique`, así que no hay 409).
- `quantity` es un entero mayor o igual que 1.
- El recurso documentado en Swagger (`/docs`) con su propio tag.
- Tests unitarios del service y del controller.

## Alcance

**Dentro:** module, controller, service, DTOs, documentación Swagger (`@ApiTags`, tag en `src/swagger.ts`), tests y el registro en `AppModule`.

**Fuera (futuro):** paginación y filtros en `findAll` (p. ej. `GET /order-entry?orderId=...` o una ruta anidada `GET /order-header/:id/entries`), filtrado por tenant (`companyId` del usuario autenticado), autenticación/autorización, borrado lógico (el modelo no tiene `active`), crear la orden junto con sus líneas en una sola petición (**cubierto por [10 — maestro-detalle](./10-order-header-master-detail.md)**), incluir el servicio o la orden en las respuestas, precios o totales por línea, y evitar líneas duplicadas (mismo `orderId` + `serviceId`).

## Modelo

Tomado de `src/prisma/contract.prisma`:

| Campo | Tipo | Requerido | En DTO | Validación |
|---|---|---|---|---|
| `id` | `String` (uuid) | generado | no | — |
| `orderId` | `String?` (FK) | no | sí | `@IsOptional() @IsUUID()` |
| `serviceId` | `String?` (FK) | no | sí | `@IsOptional() @IsUUID()` |
| `quantity` | `Int` | sí | sí | `@IsInt() @Min(1)` |
| `createdAt` | `DateTime` | generado | no | — |
| `updatedAt` | `temporal.UpdatedAt` | generado | no | — |

Relaciones: `order` → `OrderHeader` vía `orderId` y `service` → `Service` vía `serviceId` (los objetos de relación no entran en el DTO).

El modelo **no** tiene campo `active`: `findAll` usa `all()` sin filtro.

## Dependencias

| Modelo | FK | Estado en roadmap |
|---|---|---|
| OrderHeader | `orderId` | Implementado |
| Service | `serviceId` | Implementado |

**Modelos que dependen de este:** ninguno. `remove` no choca con restricciones de FK.

## Pasos de implementación

### 1. Generar el recurso

```bash
npx nest g resource order-entry
# ? What transport layer do you use? → REST API
# ? Would you like to generate CRUD entry points? → Yes
```

Comprobar:
- se crearon `src/order-entry/order-entry.module.ts`, `order-entry.controller.ts`, `order-entry.service.ts`, `dto/` y `entities/order-entry.entity.ts`;
- las clases se llaman `OrderEntryModule`, `OrderEntryController`, `OrderEntryService`, `CreateOrderEntryDto` y `UpdateOrderEntryDto`;
- `src/app.module.ts` importa `OrderEntryModule` desde `./order-entry/order-entry.module.js` y lo añade a `imports`;
- todos los imports relativos generados terminan en `.js` (el proyecto es ESM);
- `src/order-entry/entities/order-entry.entity.ts` queda como la clase vacía del scaffold (`export class OrderEntry {}`).

### 2. DTOs

`src/order-entry/dto/create-order-entry.dto.ts`:

```ts
import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';

export class CreateOrderEntryDto {
  /** Orden (`OrderHeader`) a la que pertenece la línea. */
  @IsOptional()
  @IsUUID()
  orderId?: string;

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

`src/order-entry/dto/update-order-entry.dto.ts`:

`PartialType` se importa de `@nestjs/swagger` (no de `@nestjs/mapped-types`) para que el esquema OpenAPI herede las propiedades.

```ts
import { PartialType } from '@nestjs/swagger';
import { CreateOrderEntryDto } from './create-order-entry.dto.js';

export class UpdateOrderEntryDto extends PartialType(CreateOrderEntryDto) {}
```

No se crean más DTOs.

### 3. Service

`src/order-entry/order-entry.service.ts`. Toma de base `src/order-header/order-header.service.ts` (que ya aplica las correcciones al patrón de `src/user/`):

- **Sin `db.close()`.** `db` es compartido.
- `findOne` lanza `NotFoundException` si `whereUnique({ id }).first()` devuelve `null`.
- `update` y `remove` llaman primero a `this.findOne(id)`, así el 404 sale de un solo lugar.
- En el `catch`, las `HttpException` se relanzan; el resto se loguea y lanza `InternalServerErrorException`.
- **FKs `orderId` y `serviceId`:** como hay dos, la verificación va en un helper privado `assertReferencesExist(dto)`, llamado en `create` y en `update`. Para cada FK presente (truthy) consulta `db.orm.public.OrderHeader` / `db.orm.public.Service` con `whereUnique({ id }).first()`; si no existe, `BadRequestException(\`OrderHeader ${orderId} does not exist\`)` o `BadRequestException(\`Service ${serviceId} does not exist\`)`.
- **Sin `@unique`:** no hay comprobación de duplicados ni `ConflictException`.
- **Sin fechas en el DTO:** no hay conversión con `new Date(...)`; el DTO se pasa tal cual a `create` / `update`.
- **`findAll`** usa `all()`: el modelo no tiene `active`.

```ts
import {
  BadRequestException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { db } from '../prisma/db.js';
import { CreateOrderEntryDto } from './dto/create-order-entry.dto.js';
import { UpdateOrderEntryDto } from './dto/update-order-entry.dto.js';

@Injectable()
export class OrderEntryService {
  private readonly logger = new Logger(OrderEntryService.name);

  async create(createOrderEntryDto: CreateOrderEntryDto) {
    try {
      await this.assertReferencesExist(createOrderEntryDto);
      const entry = await db.orm.public.OrderEntry.create(createOrderEntryDto);
      this.logger.log(`Created order entry ${entry.id}`);
      return entry;
    } catch (error) {
      this.handleError('Failed to create order entry', error);
    }
  }

  async findAll() {
    try {
      return await db.orm.public.OrderEntry.all();
    } catch (error) {
      this.handleError('Failed to fetch order entries', error);
    }
  }

  async findOne(id: string) {
    try {
      const entry = await db.orm.public.OrderEntry.whereUnique({ id }).first();
      if (!entry) throw new NotFoundException(`OrderEntry ${id} not found`);
      return entry;
    } catch (error) {
      this.handleError(`Failed to fetch order entry ${id}`, error);
    }
  }

  async update(id: string, updateOrderEntryDto: UpdateOrderEntryDto) {
    try {
      await this.findOne(id);
      await this.assertReferencesExist(updateOrderEntryDto);
      const entry = await db.orm.public.OrderEntry.whereUnique({ id }).update(
        updateOrderEntryDto,
      );
      this.logger.log(`Updated order entry ${id}`);
      return entry;
    } catch (error) {
      this.handleError(`Failed to update order entry ${id}`, error);
    }
  }

  async remove(id: string) {
    try {
      await this.findOne(id);
      const entry = await db.orm.public.OrderEntry.where({ id }).delete();
      this.logger.log(`Removed order entry ${id}`);
      return entry;
    } catch (error) {
      this.handleError(`Failed to remove order entry ${id}`, error);
    }
  }

  private async assertReferencesExist({
    orderId,
    serviceId,
  }: UpdateOrderEntryDto) {
    if (orderId) {
      const order = await db.orm.public.OrderHeader.whereUnique({
        id: orderId,
      }).first();
      if (!order) {
        throw new BadRequestException(`OrderHeader ${orderId} does not exist`);
      }
    }
    if (serviceId) {
      const service = await db.orm.public.Service.whereUnique({
        id: serviceId,
      }).first();
      if (!service) {
        throw new BadRequestException(`Service ${serviceId} does not exist`);
      }
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

`assertReferencesExist` recibe `UpdateOrderEntryDto` (todos los campos opcionales) para servir tanto a `create` como a `update`; `CreateOrderEntryDto` es asignable a ese tipo.

Si el tipo que devuelve `where({ id }).delete()` no es el registro borrado, `remove` devuelve el que obtuvo `findOne`. Si el ORM no acepta la instancia del DTO directamente en `create` / `update`, pasar un objeto plano con spread (`{ ...dto }`).

### 4. Controller

`src/order-entry/order-entry.controller.ts`: el del scaffold, con `@Param('id', ParseUUIDPipe) id: string` en `findOne`, `update` y `remove`, `@ApiTags('order-entry')` y un JSDoc de una línea por método (se convierte en el `summary` de Swagger). Nunca `+id`. Referencia: `src/order-header/order-header.controller.ts`.

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
import { OrderEntryService } from './order-entry.service.js';
import { CreateOrderEntryDto } from './dto/create-order-entry.dto.js';
import { UpdateOrderEntryDto } from './dto/update-order-entry.dto.js';

@ApiTags('order-entry')
@Controller('order-entry')
export class OrderEntryController {
  constructor(private readonly orderEntryService: OrderEntryService) {}

  /** Añade una línea (servicio + cantidad) a una orden. */
  @Post()
  create(@Body() createOrderEntryDto: CreateOrderEntryDto) {
    return this.orderEntryService.create(createOrderEntryDto);
  }

  /** Lista las líneas de orden. */
  @Get()
  findAll() {
    return this.orderEntryService.findAll();
  }

  /** Obtiene una línea de orden por id. */
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.orderEntryService.findOne(id);
  }

  /** Actualiza una línea de orden. */
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateOrderEntryDto: UpdateOrderEntryDto,
  ) {
    return this.orderEntryService.update(id, updateOrderEntryDto);
  }

  /** Elimina una línea de orden. */
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.orderEntryService.remove(id);
  }
}
```

### 5. Swagger

- `src/swagger.ts`: añadir `.addTag('order-entry')` al `DocumentBuilder` de `setupSwagger`, junto a los tags existentes (después de `order-header`).
- `docs/specs/05-openapi-swagger.md`: añadir `order-entry` a la lista de recursos documentados (*Contexto*) y a los tags (*Implementación*).
- No hacen falta `@ApiProperty`: el plugin CLI (`nest-cli.json`) genera el esquema desde los DTOs y class-validator (`@IsUUID()` → `format: uuid`, `@IsInt()` → `type: integer`, `@Min(1)` → `minimum: 1`), siempre que los archivos terminen en `.dto.ts` / `.controller.ts`. Los JSDoc de las propiedades del DTO pasan a la `description` del esquema.

### 6. Tests

`src/order-entry/order-entry.service.spec.ts`: mock de `../prisma/db.js` con `vi.hoisted` y `vi.fn()` encadenables, como en `src/order-header/order-header.service.spec.ts`. `OrderEntry` necesita `all` directo en el modelo (sin `where` para `findAll`) y `where(...)` con `delete`; hacen falta también los modelos `OrderHeader` y `Service` para la verificación de los FK:

```ts
const {
  unique,
  filtered,
  entryModel,
  orderUnique,
  orderModel,
  serviceUnique,
  serviceModel,
  close,
} = vi.hoisted(() => {
  const unique = { first: vi.fn(), update: vi.fn() };
  const filtered = { delete: vi.fn() };
  const entryModel = {
    create: vi.fn(),
    all: vi.fn(),
    whereUnique: vi.fn(() => unique),
    where: vi.fn(() => filtered),
  };
  const orderUnique = { first: vi.fn() };
  const orderModel = { whereUnique: vi.fn(() => orderUnique) };
  const serviceUnique = { first: vi.fn() };
  const serviceModel = { whereUnique: vi.fn(() => serviceUnique) };
  return {
    unique,
    filtered,
    entryModel,
    orderUnique,
    orderModel,
    serviceUnique,
    serviceModel,
    close: vi.fn(),
  };
});

vi.mock('../prisma/db.js', () => ({
  db: {
    orm: {
      public: {
        OrderEntry: entryModel,
        OrderHeader: orderModel,
        Service: serviceModel,
      },
    },
    close,
  },
}));
```

Casos:
- `create` ok: la orden y el servicio existen; llama a `OrderEntry.create` con el DTO y devuelve el registro.
- `create` sin `orderId` ni `serviceId`: no consulta `OrderHeader` ni `Service` y crea la línea.
- `create` con `orderId` inexistente → `BadRequestException` y no llama a `create`.
- `create` con `serviceId` inexistente → `BadRequestException` y no llama a `create`.
- `findAll` llama a `OrderEntry.all()` (no a `where`) y devuelve la lista.
- `findOne` existe → devuelve el registro; no existe → `NotFoundException`.
- `update` ok (p. ej. solo `quantity`): llama a `unique.update` con el DTO y no consulta `OrderHeader` ni `Service`.
- `update` con `orderId` o `serviceId` inexistente → `BadRequestException` y no llama a `unique.update`.
- `update` de un id inexistente → `NotFoundException` y no llama a `unique.update`.
- `remove` ok; `remove` de un id inexistente → `NotFoundException` y no llama a `delete`.
- Un error de BD (p. ej. `entryModel.all` rechaza con `Error`) → `InternalServerErrorException`.
- `close` nunca se llama.

La validación de `quantity` (entero, `>= 1`) la hace el `ValidationPipe`, no el service; se comprueba en la *Verificación* con `curl`.

`src/order-entry/order-entry.controller.spec.ts`: el service se sustituye por un objeto de `vi.fn()` con `{ provide: OrderEntryService, useValue: { create: vi.fn(), findAll: vi.fn(), findOne: vi.fn(), update: vi.fn(), remove: vi.fn() } }`. Cada endpoint delega con los argumentos correctos (`id` y DTO).

### 7. Roadmap

Marcar `OrderEntry` como `Implementado` en [`00-roadmap.md`](./00-roadmap.md).

## Endpoints

| Método | Ruta | Body | Respuesta | Errores |
|---|---|---|---|---|
| `POST` | `/order-entry` | `CreateOrderEntryDto` | 201, el registro creado | 400 body inválido (`quantity` ausente, no entero o `< 1`), `orderId` o `serviceId` inexistente |
| `GET` | `/order-entry` | — | 200, la lista | 500 |
| `GET` | `/order-entry/:id` | — | 200, el registro | 400 id no UUID, 404 |
| `PATCH` | `/order-entry/:id` | `UpdateOrderEntryDto` | 200, el registro actualizado | 400 (body, id o FK), 404 |
| `DELETE` | `/order-entry/:id` | — | 200 | 400 id no UUID, 404 |

## Criterios de aceptación

- [ ] Los 5 endpoints responden según la tabla.
- [ ] Ningún método llama a `db.close()`.
- [ ] Un `id` inexistente responde 404; un `id` que no es UUID responde 400.
- [ ] Un `orderId` o `serviceId` que no existe responde 400, en `POST` y en `PATCH`.
- [ ] `quantity` ausente en `POST`, no entera (`1.5`, `"2"`) o menor que 1 (`0`, `-3`) responde 400.
- [ ] Campos desconocidos en el body (`id`, `createdAt`, `order`, `service`…) responden 400.
- [ ] `/docs` muestra el tag `order-entry` con los 5 endpoints y el esquema de `CreateOrderEntryDto` / `UpdateOrderEntryDto`.
- [ ] `npm run lint` y `npm test` pasan.
- [ ] El roadmap marca `OrderEntry` como `Implementado`.

## Verificación

```bash
npm run lint
npx vitest run src/order-entry
npm test

npm run start:dev
COMPANY_ID=$(curl -s -X POST localhost:3000/company -H 'Content-Type: application/json' -d '{"name":"Acme"}' | jq -r .id)
SERVICE_ID=$(curl -s -X POST localhost:3000/service -H 'Content-Type: application/json' \
  -d "{\"name\":\"Mantenimiento de aire acondicionado\",\"companyId\":\"$COMPANY_ID\"}" | jq -r .id)
ORDER_ID=$(curl -s -X POST localhost:3000/order-header -H 'Content-Type: application/json' \
  -d "{\"companyId\":\"$COMPANY_ID\",\"serviceDate\":\"2026-12-01T14:00:00.000Z\",\"status\":\"SCHEDULED\"}" | jq -r .id)
curl -X POST localhost:3000/order-entry -H 'Content-Type: application/json' \
  -d "{\"orderId\":\"$ORDER_ID\",\"serviceId\":\"$SERVICE_ID\",\"quantity\":2}"
curl -i -X POST localhost:3000/order-entry -H 'Content-Type: application/json' \
  -d '{"orderId":"00000000-0000-0000-0000-000000000000","quantity":1}'   # 400
curl -i -X POST localhost:3000/order-entry -H 'Content-Type: application/json' -d '{"quantity":0}'     # 400
curl -i -X POST localhost:3000/order-entry -H 'Content-Type: application/json' -d '{"quantity":1.5}'   # 400
curl -i -X POST localhost:3000/order-entry -H 'Content-Type: application/json' -d '{}'                 # 400
curl localhost:3000/order-entry
curl localhost:3000/order-entry/<id>
curl -X PATCH localhost:3000/order-entry/<id> -H 'Content-Type: application/json' -d '{"quantity":3}'
curl -X DELETE localhost:3000/order-entry/<id>
curl -i localhost:3000/order-entry/00000000-0000-0000-0000-000000000000   # 404
curl -i localhost:3000/order-entry/abc                                    # 400
curl -s localhost:3000/docs-json | jq '.paths | keys | map(select(startswith("/order-entry")))'   # ["/order-entry", "/order-entry/{id}"]
```

## Notas

- **Validación:** `src/main.ts` ya tiene un `ValidationPipe` global (`whitelist`, `forbidNonWhitelisted`, `transform`), así que un campo que no esté en el DTO responde 400. `transform` no convierte tipos implícitamente: un `"quantity": "2"` (string) responde 400 por `@IsInt()`.
- **Sin `active`:** el modelo no tiene borrado lógico, así que `findAll` devuelve todas las líneas y `remove` las borra físicamente.
- **Sin dependientes:** ningún modelo tiene un FK hacia `OrderEntry`, así que `remove` no falla por restricciones de FK.
- **Borrar la orden:** el spec 08 avisa que `DELETE /order-header/:id` responde 500 si la orden tiene líneas. Con este recurso, el flujo es borrar antes sus líneas con `DELETE /order-entry/:id`. Borrado en cascada queda fuera de alcance.
- **Listar las líneas de una orden:** `findAll` no filtra por `orderId`; hoy devuelve las líneas de todas las órdenes. Un filtro (`?orderId=`) o una ruta anidada en `order-header` queda para un spec posterior.
- **FKs y registros inactivos:** la verificación solo comprueba que la orden y el servicio existan, no que el servicio esté activo (`Service.active`), ni que el servicio pertenezca a la misma empresa que la orden (`Service.companyId` = `OrderHeader.companyId`). Ambas reglas quedan para cuando haya autenticación y filtrado por tenant.
- **Desasignar orden o servicio:** `@IsOptional()` deja pasar `null`, así que `PATCH { "serviceId": null }` quita el servicio sin consultar `Service` (la verificación solo corre si el valor es truthy). Una línea sin orden queda huérfana; exigir `orderId` requeriría cambiar el contract (`orderId String`).
- **Líneas duplicadas:** nada impide dos líneas con el mismo `orderId` + `serviceId`; no hay `@@unique` en el contract. Si se quiere sumar la cantidad en vez de duplicar, es un cambio de contract y de reglas de negocio.
