# Spec 08 — Recurso OrderHeader (CRUD)

> Roadmap: [00 — Roadmap de recursos](./00-roadmap.md) · Referencia: `src/service/`, `src/client/`, `src/user/`

## Contexto

`OrderHeader` es la cabecera de una orden de mantenimiento en AlertFix: une a un cliente (`clientId`) con la empresa que presta el servicio (`companyId`), y guarda la fecha en que se presta el servicio (`serviceDate`) y su estado (`status`). Las líneas de la orden (servicio + cantidad) viven en `OrderEntry`, y los recordatorios por WhatsApp (`Reminder`) cuelgan de la orden: `src/reminder/whatsapp-reminder-sender.ts` ya lee `order.serviceDate` y `order.client` para componer el mensaje.

Hoy no existe `src/order-header/` ni un endpoint para crear órdenes; para tener órdenes (y por tanto recordatorios) hay que insertarlas directamente en la base de datos. Este spec crea el recurso desde cero con `nest g resource`, siguiendo la estructura de `src/service/` (spec 07) y `src/client/` (spec 06).

## Objetivo

- Un recurso REST `order-header` con CRUD completo sobre `db.orm.public.OrderHeader`.
- DTOs validados con class-validator a partir del contract.
- Errores HTTP correctos: 400 / 404 / 500 (no hay campos `@unique`, así que no hay 409).
- `serviceDate` se recibe como string ISO 8601 y se guarda como `Date`.
- El recurso documentado en Swagger (`/docs`) con su propio tag.
- Tests unitarios del service y del controller.

## Alcance

**Dentro:** module, controller, service, DTOs, documentación Swagger (`@ApiTags`, tag en `src/swagger.ts`), tests y el registro en `AppModule`.

**Fuera (futuro):** paginación y filtros en `findAll` (por `clientId`, `companyId`, `status` o rango de `serviceDate`), filtrado por tenant (`companyId` del usuario autenticado), autenticación/autorización, borrado lógico (el modelo no tiene `active`), enum o máquina de estados para `status`, crear la orden junto con sus líneas (`OrderEntry`) en una sola petición e incluir las líneas en `findOne` (**cubierto por [10 — maestro-detalle](./10-order-header-master-detail.md)**), incluir el cliente en las respuestas, y generar o reprogramar los `Reminder` de la orden cuando cambia `serviceDate`.

## Modelo

Tomado de `src/prisma/contract.prisma`:

| Campo | Tipo | Requerido | En DTO | Validación |
|---|---|---|---|---|
| `id` | `String` (uuid) | generado | no | — |
| `clientId` | `String?` (FK) | no | sí | `@IsOptional() @IsUUID()` |
| `companyId` | `String?` (FK) | no | sí | `@IsOptional() @IsUUID()` |
| `serviceDate` | `DateTime` | sí | sí | `@IsDateString()` |
| `status` | `String` | sí | sí | `@IsString() @IsNotEmpty()` (valores libres, sin enum) |
| `createdAt` | `DateTime` | generado | no | — |
| `updatedAt` | `temporal.UpdatedAt` | generado | no | — |

Relaciones: `client` → `Client` vía `clientId` y `company` → `Company` vía `companyId` (los objetos de relación no entran en el DTO).

El modelo **no** tiene campo `active`: `findAll` usa `all()` sin filtro.

## Dependencias

| Modelo | FK | Estado en roadmap |
|---|---|---|
| Client | `clientId` | Implementado |
| Company | `companyId` | Implementado |

**Modelos que dependen de este:** `OrderEntry` (`orderId`) y `Reminder` (`orderId`). Ver *Notas*, sobre el borrado.

## Pasos de implementación

### 1. Generar el recurso

```bash
npx nest g resource order-header
# ? What transport layer do you use? → REST API
# ? Would you like to generate CRUD entry points? → Yes
```

Comprobar:
- se crearon `src/order-header/order-header.module.ts`, `order-header.controller.ts`, `order-header.service.ts`, `dto/` y `entities/order-header.entity.ts`;
- las clases se llaman `OrderHeaderModule`, `OrderHeaderController`, `OrderHeaderService`, `CreateOrderHeaderDto` y `UpdateOrderHeaderDto`;
- `src/app.module.ts` importa `OrderHeaderModule` desde `./order-header/order-header.module.js` y lo añade a `imports`;
- todos los imports relativos generados terminan en `.js` (el proyecto es ESM);
- `src/order-header/entities/order-header.entity.ts` queda como la clase vacía del scaffold (`export class OrderHeader {}`).

### 2. DTOs

`src/order-header/dto/create-order-header.dto.ts`:

```ts
import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateOrderHeaderDto {
  @IsOptional()
  @IsUUID()
  clientId?: string;

  @IsOptional()
  @IsUUID()
  companyId?: string;

  /** Fecha y hora del servicio, en ISO 8601 (p. ej. `2026-12-01T14:00:00.000Z`). */
  @IsDateString()
  serviceDate: string;

  /** Estado de la orden. Valor libre por ahora (sin enum). */
  @IsString()
  @IsNotEmpty()
  status: string;
}
```

`src/order-header/dto/update-order-header.dto.ts`:

`PartialType` se importa de `@nestjs/swagger` (no de `@nestjs/mapped-types`) para que el esquema OpenAPI herede las propiedades.

```ts
import { PartialType } from '@nestjs/swagger';
import { CreateOrderHeaderDto } from './create-order-header.dto.js';

export class UpdateOrderHeaderDto extends PartialType(CreateOrderHeaderDto) {}
```

No se crean más DTOs.

### 3. Service

`src/order-header/order-header.service.ts`. Toma de base `src/service/service.service.ts` (que ya aplica las correcciones al patrón de `src/user/`):

- **Sin `db.close()`.** `db` es compartido.
- `findOne` lanza `NotFoundException` si `whereUnique({ id }).first()` devuelve `null`.
- `update` y `remove` llaman primero a `this.findOne(id)`, así el 404 sale de un solo lugar.
- En el `catch`, las `HttpException` se relanzan; el resto se loguea y lanza `InternalServerErrorException`.
- **FKs `clientId` y `companyId`:** como hay dos, la verificación va en un helper privado `assertReferencesExist(dto)`, llamado en `create` y en `update`. Para cada FK presente (truthy) consulta `db.orm.public.Client` / `db.orm.public.Company` con `whereUnique({ id }).first()`; si no existe, `BadRequestException(\`Client ${clientId} does not exist\`)` o `BadRequestException(\`Company ${companyId} does not exist\`)`.
- **Sin `@unique`:** no hay comprobación de duplicados ni `ConflictException`.
- **Fechas:** `serviceDate` llega como string; se convierte con `new Date(...)` antes de `create` y, en `update`, solo si el DTO lo trae (para no pisar la fecha con `Invalid Date`).
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
import { CreateOrderHeaderDto } from './dto/create-order-header.dto.js';
import { UpdateOrderHeaderDto } from './dto/update-order-header.dto.js';

@Injectable()
export class OrderHeaderService {
  private readonly logger = new Logger(OrderHeaderService.name);

  async create(createOrderHeaderDto: CreateOrderHeaderDto) {
    try {
      await this.assertReferencesExist(createOrderHeaderDto);
      const order = await db.orm.public.OrderHeader.create({
        ...createOrderHeaderDto,
        serviceDate: new Date(createOrderHeaderDto.serviceDate),
      });
      this.logger.log(`Created order ${order.id}`);
      return order;
    } catch (error) {
      this.handleError('Failed to create order', error);
    }
  }

  async findAll() {
    try {
      return await db.orm.public.OrderHeader.all();
    } catch (error) {
      this.handleError('Failed to fetch orders', error);
    }
  }

  async findOne(id: string) {
    try {
      const order = await db.orm.public.OrderHeader.whereUnique({ id }).first();
      if (!order) throw new NotFoundException(`OrderHeader ${id} not found`);
      return order;
    } catch (error) {
      this.handleError(`Failed to fetch order ${id}`, error);
    }
  }

  async update(id: string, updateOrderHeaderDto: UpdateOrderHeaderDto) {
    try {
      await this.findOne(id);
      await this.assertReferencesExist(updateOrderHeaderDto);
      const { serviceDate, ...rest } = updateOrderHeaderDto;
      const order = await db.orm.public.OrderHeader.whereUnique({ id }).update({
        ...rest,
        ...(serviceDate !== undefined && { serviceDate: new Date(serviceDate) }),
      });
      this.logger.log(`Updated order ${id}`);
      return order;
    } catch (error) {
      this.handleError(`Failed to update order ${id}`, error);
    }
  }

  async remove(id: string) {
    try {
      await this.findOne(id);
      const order = await db.orm.public.OrderHeader.where({ id }).delete();
      this.logger.log(`Removed order ${id}`);
      return order;
    } catch (error) {
      this.handleError(`Failed to remove order ${id}`, error);
    }
  }

  private async assertReferencesExist({
    clientId,
    companyId,
  }: UpdateOrderHeaderDto) {
    if (clientId) {
      const client = await db.orm.public.Client.whereUnique({
        id: clientId,
      }).first();
      if (!client) {
        throw new BadRequestException(`Client ${clientId} does not exist`);
      }
    }
    if (companyId) {
      const company = await db.orm.public.Company.whereUnique({
        id: companyId,
      }).first();
      if (!company) {
        throw new BadRequestException(`Company ${companyId} does not exist`);
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

`assertReferencesExist` recibe `UpdateOrderHeaderDto` (todos los campos opcionales) para servir tanto a `create` como a `update`; `CreateOrderHeaderDto` es asignable a ese tipo.

Si el tipo que devuelve `where({ id }).delete()` no es el registro borrado, `remove` devuelve el que obtuvo `findOne`. Si el ORM no acepta el spread condicional en `update`, construir el objeto de datos en una variable antes de llamarlo.

### 4. Controller

`src/order-header/order-header.controller.ts`: el del scaffold, con `@Param('id', ParseUUIDPipe) id: string` en `findOne`, `update` y `remove`, `@ApiTags('order-header')` y un JSDoc de una línea por método (se convierte en el `summary` de Swagger). Nunca `+id`. Referencia: `src/service/service.controller.ts`.

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
import { OrderHeaderService } from './order-header.service.js';
import { CreateOrderHeaderDto } from './dto/create-order-header.dto.js';
import { UpdateOrderHeaderDto } from './dto/update-order-header.dto.js';

@ApiTags('order-header')
@Controller('order-header')
export class OrderHeaderController {
  constructor(private readonly orderHeaderService: OrderHeaderService) {}

  /** Crea una orden de mantenimiento. */
  @Post()
  create(@Body() createOrderHeaderDto: CreateOrderHeaderDto) {
    return this.orderHeaderService.create(createOrderHeaderDto);
  }

  /** Lista las órdenes de mantenimiento. */
  @Get()
  findAll() {
    return this.orderHeaderService.findAll();
  }

  /** Obtiene una orden por id. */
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.orderHeaderService.findOne(id);
  }

  /** Actualiza una orden. */
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateOrderHeaderDto: UpdateOrderHeaderDto,
  ) {
    return this.orderHeaderService.update(id, updateOrderHeaderDto);
  }

  /** Elimina una orden. */
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.orderHeaderService.remove(id);
  }
}
```

### 5. Swagger

- `src/swagger.ts`: añadir `.addTag('order-header')` al `DocumentBuilder` de `setupSwagger`, junto a `company`, `client`, `service`, `user` y `reminder` (después de `service`).
- `docs/specs/05-openapi-swagger.md`: añadir `order-header` a la lista de recursos documentados (*Contexto*) y a los tags (*Implementación*).
- No hacen falta `@ApiProperty`: el plugin CLI (`nest-cli.json`) genera el esquema desde los DTOs y class-validator (`@IsUUID()` → `format: uuid`, `@IsDateString()` → `format: date-time`), siempre que los archivos terminen en `.dto.ts` / `.controller.ts`. Los JSDoc de las propiedades del DTO pasan a la `description` del esquema.

### 6. Tests

`src/order-header/order-header.service.spec.ts`: mock de `../prisma/db.js` con `vi.hoisted` y `vi.fn()` encadenables, como en `src/service/service.service.spec.ts`. `OrderHeader` necesita `all` directo en el modelo (sin `where` para `findAll`) y `where(...)` con `delete`; hacen falta también los modelos `Client` y `Company` para la verificación de los FK:

```ts
const {
  unique,
  filtered,
  orderModel,
  clientUnique,
  clientModel,
  companyUnique,
  companyModel,
  close,
} = vi.hoisted(() => {
  const unique = { first: vi.fn(), update: vi.fn() };
  const filtered = { delete: vi.fn() };
  const orderModel = {
    create: vi.fn(),
    all: vi.fn(),
    whereUnique: vi.fn(() => unique),
    where: vi.fn(() => filtered),
  };
  const clientUnique = { first: vi.fn() };
  const clientModel = { whereUnique: vi.fn(() => clientUnique) };
  const companyUnique = { first: vi.fn() };
  const companyModel = { whereUnique: vi.fn(() => companyUnique) };
  return {
    unique,
    filtered,
    orderModel,
    clientUnique,
    clientModel,
    companyUnique,
    companyModel,
    close: vi.fn(),
  };
});

vi.mock('../prisma/db.js', () => ({
  db: {
    orm: {
      public: {
        OrderHeader: orderModel,
        Client: clientModel,
        Company: companyModel,
      },
    },
    close,
  },
}));
```

Casos:
- `create` ok: cliente y empresa existen; llama a `OrderHeader.create` con el DTO y `serviceDate` convertido a `Date` (`expect.any(Date)` y mismo `toISOString()` que el string de entrada).
- `create` sin `clientId` ni `companyId`: no consulta `Client` ni `Company` y crea la orden.
- `create` con `clientId` inexistente → `BadRequestException` y no llama a `create`.
- `create` con `companyId` inexistente → `BadRequestException` y no llama a `create`.
- `findAll` llama a `OrderHeader.all()` (no a `where`) y devuelve la lista.
- `findOne` existe → devuelve el registro; no existe → `NotFoundException`.
- `update` ok con `serviceDate`: lo convierte a `Date`.
- `update` sin `serviceDate` (p. ej. solo `status`): el objeto que recibe `unique.update` no tiene la clave `serviceDate`.
- `update` con `clientId` o `companyId` inexistente → `BadRequestException` y no llama a `unique.update`.
- `update` de un id inexistente → `NotFoundException` y no llama a `unique.update`.
- `remove` ok; `remove` de un id inexistente → `NotFoundException` y no llama a `delete`.
- Un error de BD (p. ej. `orderModel.all` rechaza con `Error`) → `InternalServerErrorException`.
- `close` nunca se llama.

`src/order-header/order-header.controller.spec.ts`: el service se sustituye por un objeto de `vi.fn()` con `{ provide: OrderHeaderService, useValue: { create: vi.fn(), findAll: vi.fn(), findOne: vi.fn(), update: vi.fn(), remove: vi.fn() } }`. Cada endpoint delega con los argumentos correctos (`id` y DTO).

### 7. Roadmap

Marcar `OrderHeader` como `Implementado` en [`00-roadmap.md`](./00-roadmap.md).

## Endpoints

| Método | Ruta | Body | Respuesta | Errores |
|---|---|---|---|---|
| `POST` | `/order-header` | `CreateOrderHeaderDto` | 201, el registro creado | 400 body inválido, `clientId` o `companyId` inexistente |
| `GET` | `/order-header` | — | 200, la lista | 500 |
| `GET` | `/order-header/:id` | — | 200, el registro | 400 id no UUID, 404 |
| `PATCH` | `/order-header/:id` | `UpdateOrderHeaderDto` | 200, el registro actualizado | 400 (body, id o FK), 404 |
| `DELETE` | `/order-header/:id` | — | 200 | 400 id no UUID, 404, 500 si tiene líneas o recordatorios (ver *Notas*) |

## Criterios de aceptación

- [ ] Los 5 endpoints responden según la tabla.
- [ ] Ningún método llama a `db.close()`.
- [ ] Un `id` inexistente responde 404; un `id` que no es UUID responde 400.
- [ ] Un `clientId` o `companyId` que no existe responde 400, en `POST` y en `PATCH`.
- [ ] `serviceDate` que no es fecha ISO 8601 responde 400; uno válido se guarda como `DateTime`.
- [ ] `PATCH` sin `serviceDate` no modifica la fecha de la orden.
- [ ] Falta `serviceDate` o `status` en `POST` → 400.
- [ ] Campos desconocidos en el body (`id`, `createdAt`, `client`…) responden 400.
- [ ] `/docs` muestra el tag `order-header` con los 5 endpoints y el esquema de `CreateOrderHeaderDto` / `UpdateOrderHeaderDto`.
- [ ] `npm run lint` y `npm test` pasan.
- [ ] El roadmap marca `OrderHeader` como `Implementado`.

## Verificación

```bash
npm run lint
npx vitest run src/order-header
npm test

npm run start:dev
COMPANY_ID=$(curl -s -X POST localhost:3000/company -H 'Content-Type: application/json' -d '{"name":"Acme"}' | jq -r .id)
CLIENT_ID=$(curl -s -X POST localhost:3000/client -H 'Content-Type: application/json' \
  -d "{\"name\":\"Ana Pérez\",\"email\":\"ana@example.com\",\"companyId\":\"$COMPANY_ID\"}" | jq -r .id)
curl -X POST localhost:3000/order-header -H 'Content-Type: application/json' \
  -d "{\"clientId\":\"$CLIENT_ID\",\"companyId\":\"$COMPANY_ID\",\"serviceDate\":\"2026-12-01T14:00:00.000Z\",\"status\":\"SCHEDULED\"}"
curl -i -X POST localhost:3000/order-header -H 'Content-Type: application/json' \
  -d '{"clientId":"00000000-0000-0000-0000-000000000000","serviceDate":"2026-12-01T14:00:00.000Z","status":"SCHEDULED"}'   # 400
curl -i -X POST localhost:3000/order-header -H 'Content-Type: application/json' \
  -d '{"serviceDate":"mañana","status":"SCHEDULED"}'   # 400
curl -i -X POST localhost:3000/order-header -H 'Content-Type: application/json' -d '{"status":"SCHEDULED"}'   # 400
curl localhost:3000/order-header
curl localhost:3000/order-header/<id>
curl -X PATCH localhost:3000/order-header/<id> -H 'Content-Type: application/json' -d '{"status":"DONE"}'   # serviceDate no cambia
curl -X PATCH localhost:3000/order-header/<id> -H 'Content-Type: application/json' -d '{"serviceDate":"2026-12-03T09:30:00.000Z"}'
curl -X DELETE localhost:3000/order-header/<id>
curl -i localhost:3000/order-header/00000000-0000-0000-0000-000000000000   # 404
curl -i localhost:3000/order-header/abc                                    # 400
curl -s localhost:3000/docs-json | jq '.paths | keys | map(select(startswith("/order-header")))'   # ["/order-header", "/order-header/{id}"]
```

## Notas

- **Validación:** `src/main.ts` ya tiene un `ValidationPipe` global (`whitelist`, `forbidNonWhitelisted`, `transform`), así que un campo que no esté en el DTO responde 400.
- **`status` es un string libre:** no hay enum todavía, así que `SCHEDULED`, `DONE` o cualquier otro valor no vacío se acepta. `src/reminder/reminder-status.ts` muestra el patrón (`as const`) que podría seguirse cuando se definan los estados de la orden; añadir `@IsIn(...)` en el DTO entonces.
- **Sin `active`:** el modelo no tiene borrado lógico, así que `findAll` devuelve todas las órdenes. Cancelar una orden sin borrarla se puede expresar hoy con `status` (p. ej. `PATCH { "status": "CANCELLED" }`).
- **Borrado y modelos dependientes:** `OrderEntry` (`orderId`) y `Reminder` (`orderId`) tienen un FK hacia `OrderHeader`. Si la orden tiene líneas o recordatorios, `remove` falla por la restricción de FK y, con el `handleError` de este spec, responde 500. Mapear ese error a 409, borrar en cascada o añadir borrado lógico (`active`, que requiere cambiar el contract) queda fuera de alcance.
- **Recordatorios y `serviceDate`:** cambiar `serviceDate` con `PATCH` no reprograma los `Reminder` ya creados para la orden (su `remindAt` y su `message` quedan como estaban). Sincronizarlos queda para un spec posterior del flujo de recordatorios.
- **Zona horaria:** `@IsDateString()` acepta cualquier ISO 8601, con o sin offset. Sin offset, `new Date(...)` lo interpreta en la zona del servidor; conviene enviar siempre `Z` o un offset explícito. `src/reminder/date-utils.ts` formatea la fecha para el cliente en la zona configurada.
- **FKs y registros inactivos:** la verificación solo comprueba que el cliente y la empresa existan, no que estén activos, ni que el cliente pertenezca a la misma empresa que la orden. Ambas reglas quedan para cuando haya autenticación y filtrado por tenant.
- **Desasignar cliente o empresa:** `@IsOptional()` deja pasar `null`, así que `PATCH { "clientId": null }` quita el cliente sin consultar `Client` (la verificación solo corre si el valor es truthy). Una orden sin cliente no podrá generar recordatorios por WhatsApp.
