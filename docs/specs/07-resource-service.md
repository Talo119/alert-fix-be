# Spec 07 — Recurso Service (CRUD)

> Roadmap: [00 — Roadmap de recursos](./00-roadmap.md) · Referencia: `src/client/`, `src/company/`, `src/user/`

## Contexto

`Service` es el catálogo de servicios de mantenimiento que ofrece cada empresa de AlertFix (p. ej. "Cambio de filtro", "Revisión anual"). Cuelga de `Company` (tenant) mediante un `companyId` opcional, y cada línea de una orden (`OrderEntry.serviceId`) apunta a uno de estos servicios junto con una cantidad.

Hoy no existe `src/service/` ni un endpoint para dar de alta servicios; para crear líneas de orden habría que insertar los servicios directamente en la base de datos. Este spec crea el recurso desde cero con `nest g resource`, siguiendo la estructura de `src/client/` (spec 06).

## Objetivo

- Un recurso REST `service` con CRUD completo sobre `db.orm.public.Service`.
- DTOs validados con class-validator a partir del contract.
- Errores HTTP correctos: 400 / 404 / 500 (no hay campos `@unique`, así que no hay 409).
- `findAll` devuelve solo los servicios con `active = true`.
- El recurso documentado en Swagger (`/docs`) con su propio tag.
- Tests unitarios del service y del controller.

## Alcance

**Dentro:** module, controller, service, DTOs, documentación Swagger (`@ApiTags`, tag en `src/swagger.ts`), tests y el registro en `AppModule`.

**Fuera (futuro):** paginación y filtros en `findAll` (p. ej. por `companyId`), filtrado por tenant (`companyId` del usuario autenticado), autenticación/autorización, borrado lógico en `remove`, unicidad del nombre por empresa, y precio o duración del servicio (no están en el contract).

## Modelo

Tomado de `src/prisma/contract.prisma`:

| Campo | Tipo | Requerido | En DTO | Validación |
|---|---|---|---|---|
| `id` | `String` (uuid) | generado | no | — |
| `name` | `String` | sí | sí | `@IsString() @IsNotEmpty()` |
| `description` | `String?` | no | sí | `@IsOptional() @IsString()` |
| `companyId` | `String?` (FK) | no | sí | `@IsOptional() @IsUUID()` |
| `active` | `Boolean @default(true)` | no | sí | `@IsOptional() @IsBoolean()` |
| `createdAt` | `DateTime` | generado | no | — |
| `updatedAt` | `temporal.UpdatedAt` | generado | no | — |

Relaciones: `company` → `Company` vía `companyId` (el objeto de relación no entra en el DTO).

## Dependencias

| Modelo | FK | Estado en roadmap |
|---|---|---|
| Company | `companyId` | Implementado |

**Modelos que dependen de este:** `OrderEntry` (`serviceId`). Ver *Notas*, sobre el borrado.

## Pasos de implementación

### 1. Generar el recurso

```bash
npx nest g resource service
# ? What transport layer do you use? → REST API
# ? Would you like to generate CRUD entry points? → Yes
```

Comprobar:
- se crearon `src/service/service.module.ts`, `service.controller.ts`, `service.service.ts`, `dto/` y `entities/service.entity.ts`;
- las clases se llaman `ServiceModule`, `ServiceController` y `ServiceService` (ver *Notas*: es intencional);
- `src/app.module.ts` importa `ServiceModule` desde `./service/service.module.js` y lo añade a `imports`;
- todos los imports relativos generados terminan en `.js` (el proyecto es ESM);
- `src/service/entities/service.entity.ts` queda como la clase vacía del scaffold (`export class Service {}`).

### 2. DTOs

`src/service/dto/create-service.dto.ts`:

```ts
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateServiceDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsUUID()
  companyId?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
```

`src/service/dto/update-service.dto.ts`:

`PartialType` se importa de `@nestjs/swagger` (no de `@nestjs/mapped-types`) para que el esquema OpenAPI herede las propiedades.

```ts
import { PartialType } from '@nestjs/swagger';
import { CreateServiceDto } from './create-service.dto.js';

export class UpdateServiceDto extends PartialType(CreateServiceDto) {}
```

No se crean más DTOs.

### 3. Service

`src/service/service.service.ts`. Toma de base `src/client/client.service.ts` (que ya aplica las correcciones al patrón de `src/user/`):

- **Sin `db.close()`.** `db` es compartido.
- `findOne` lanza `NotFoundException` si `whereUnique({ id }).first()` devuelve `null`.
- `update` y `remove` llaman primero a `this.findOne(id)`, así el 404 sale de un solo lugar.
- En el `catch`, las `HttpException` se relanzan; el resto se loguea y lanza `InternalServerErrorException`.
- **FK `companyId`:** en `create`, y en `update` cuando el DTO trae `companyId`, se verifica con `db.orm.public.Company.whereUnique({ id }).first()`. Si no existe, `BadRequestException(\`Company ${companyId} does not exist\`)`.
- **Sin `@unique`:** no hay comprobación de duplicados ni `ConflictException`.
- **`findAll`** filtra con `where({ active: true }).all()`. `findOne`, `update` y `remove` no filtran por `active`.
- Sin fechas que convertir.

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
import { CreateServiceDto } from './dto/create-service.dto.js';
import { UpdateServiceDto } from './dto/update-service.dto.js';

@Injectable()
export class ServiceService {
  private readonly logger = new Logger(ServiceService.name);

  async create(createServiceDto: CreateServiceDto) {
    try {
      if (createServiceDto.companyId) {
        await this.assertCompanyExists(createServiceDto.companyId);
      }
      const service = await db.orm.public.Service.create(createServiceDto);
      this.logger.log(`Created service ${service.id}`);
      return service;
    } catch (error) {
      this.handleError('Failed to create service', error);
    }
  }

  async findAll() {
    try {
      return await db.orm.public.Service.where({ active: true }).all();
    } catch (error) {
      this.handleError('Failed to fetch services', error);
    }
  }

  async findOne(id: string) {
    try {
      const service = await db.orm.public.Service.whereUnique({ id }).first();
      if (!service) throw new NotFoundException(`Service ${id} not found`);
      return service;
    } catch (error) {
      this.handleError(`Failed to fetch service ${id}`, error);
    }
  }

  async update(id: string, updateServiceDto: UpdateServiceDto) {
    try {
      await this.findOne(id);
      if (updateServiceDto.companyId) {
        await this.assertCompanyExists(updateServiceDto.companyId);
      }
      const service = await db.orm.public.Service.whereUnique({ id }).update(
        updateServiceDto,
      );
      this.logger.log(`Updated service ${id}`);
      return service;
    } catch (error) {
      this.handleError(`Failed to update service ${id}`, error);
    }
  }

  async remove(id: string) {
    try {
      await this.findOne(id);
      const service = await db.orm.public.Service.where({ id }).delete();
      this.logger.log(`Removed service ${id}`);
      return service;
    } catch (error) {
      this.handleError(`Failed to remove service ${id}`, error);
    }
  }

  private async assertCompanyExists(companyId: string) {
    const company = await db.orm.public.Company.whereUnique({
      id: companyId,
    }).first();
    if (!company) {
      throw new BadRequestException(`Company ${companyId} does not exist`);
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

Si el tipo que devuelve `where({ id }).delete()` no es el registro borrado, `remove` devuelve el que obtuvo `findOne`.

### 4. Controller

`src/service/service.controller.ts`: el del scaffold, con `@Param('id', ParseUUIDPipe) id: string` en `findOne`, `update` y `remove`, `@ApiTags('service')` y un JSDoc de una línea por método (se convierte en el `summary` de Swagger). Nunca `+id`. Referencia: `src/client/client.controller.ts`.

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
import { ServiceService } from './service.service.js';
import { CreateServiceDto } from './dto/create-service.dto.js';
import { UpdateServiceDto } from './dto/update-service.dto.js';

@ApiTags('service')
@Controller('service')
export class ServiceController {
  constructor(private readonly serviceService: ServiceService) {}

  /** Crea un servicio. */
  @Post()
  create(@Body() createServiceDto: CreateServiceDto) {
    return this.serviceService.create(createServiceDto);
  }

  /** Lista los servicios activos. */
  @Get()
  findAll() {
    return this.serviceService.findAll();
  }

  /** Obtiene un servicio por id (incluidos los inactivos). */
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.serviceService.findOne(id);
  }

  /** Actualiza un servicio. */
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateServiceDto: UpdateServiceDto,
  ) {
    return this.serviceService.update(id, updateServiceDto);
  }

  /** Elimina un servicio. */
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.serviceService.remove(id);
  }
}
```

### 5. Swagger

- `src/swagger.ts`: añadir `.addTag('service')` al `DocumentBuilder` de `setupSwagger`, junto a `company`, `client`, `user` y `reminder`.
- `docs/specs/05-openapi-swagger.md`: añadir `service` a la lista de recursos documentados (*Contexto*) y a los tags (*Implementación*).
- No hacen falta `@ApiProperty`: el plugin CLI (`nest-cli.json`) genera el esquema desde los DTOs y class-validator (`@IsUUID()` → `format: uuid`), siempre que los archivos terminen en `.dto.ts` / `.controller.ts`.

### 6. Tests

`src/service/service.service.spec.ts`: mock de `../prisma/db.js` con `vi.hoisted` y `vi.fn()` encadenables, como en `src/client/client.service.spec.ts`. `where(...)` devuelve un objeto con `all` y `delete` (filtro de `active` y borrado); hace falta también el modelo `Company` para la verificación del FK:

```ts
const { unique, filtered, serviceModel, companyUnique, companyModel, close } =
  vi.hoisted(() => {
    const unique = { first: vi.fn(), update: vi.fn() };
    const filtered = { all: vi.fn(), delete: vi.fn() };
    const serviceModel = {
      create: vi.fn(),
      whereUnique: vi.fn(() => unique),
      where: vi.fn(() => filtered),
    };
    const companyUnique = { first: vi.fn() };
    const companyModel = { whereUnique: vi.fn(() => companyUnique) };
    return {
      unique,
      filtered,
      serviceModel,
      companyUnique,
      companyModel,
      close: vi.fn(),
    };
  });

vi.mock('../prisma/db.js', () => ({
  db: {
    orm: { public: { Service: serviceModel, Company: companyModel } },
    close,
  },
}));
```

Casos:
- `create` ok: empresa existe (`companyUnique.first` → empresa) y llama a `Service.create` con el DTO.
- `create` sin `companyId`: no consulta `Company` y crea el servicio.
- `create` con `companyId` inexistente → `BadRequestException` y no llama a `create`.
- `findAll` llama a `where({ active: true })` y luego a `all()`, y devuelve la lista.
- `findOne` existe → devuelve el registro; no existe → `NotFoundException`.
- `update` ok.
- `update` con `companyId` inexistente → `BadRequestException` y no llama a `unique.update`.
- `update` de un id inexistente → `NotFoundException` y no llama a `unique.update`.
- `remove` ok; `remove` de un id inexistente → `NotFoundException` y no llama a `delete`.
- Un error de BD (p. ej. `filtered.all` rechaza con `Error`) → `InternalServerErrorException`.
- `close` nunca se llama.

`src/service/service.controller.spec.ts`: el service se sustituye por un objeto de `vi.fn()` con `{ provide: ServiceService, useValue: { create: vi.fn(), findAll: vi.fn(), findOne: vi.fn(), update: vi.fn(), remove: vi.fn() } }`. Cada endpoint delega con los argumentos correctos (`id` y DTO).

### 7. Roadmap

Marcar `Service` como `Implementado` en [`00-roadmap.md`](./00-roadmap.md).

## Endpoints

| Método | Ruta | Body | Respuesta | Errores |
|---|---|---|---|---|
| `POST` | `/service` | `CreateServiceDto` | 201, el registro creado | 400 body inválido o `companyId` inexistente |
| `GET` | `/service` | — | 200, la lista (solo `active = true`) | 500 |
| `GET` | `/service/:id` | — | 200, el registro | 400 id no UUID, 404 |
| `PATCH` | `/service/:id` | `UpdateServiceDto` | 200, el registro actualizado | 400 (body, id o `companyId`), 404 |
| `DELETE` | `/service/:id` | — | 200 | 400 id no UUID, 404, 500 si está en líneas de orden (ver *Notas*) |

## Criterios de aceptación

- [ ] Los 5 endpoints responden según la tabla.
- [ ] Ningún método llama a `db.close()`.
- [ ] Un `id` inexistente responde 404; un `id` que no es UUID responde 400.
- [ ] Un `companyId` que no existe responde 400, en `POST` y en `PATCH`.
- [ ] `GET /service` no devuelve servicios con `active = false`; `GET /service/:id` sí los devuelve.
- [ ] Campos desconocidos en el body (`id`, `createdAt`, `company`…) responden 400.
- [ ] `/docs` muestra el tag `service` con los 5 endpoints y el esquema de `CreateServiceDto` / `UpdateServiceDto`.
- [ ] `npm run lint` y `npm test` pasan.
- [ ] El roadmap marca `Service` como `Implementado`.

## Verificación

```bash
npm run lint
npx vitest run src/service
npm test

npm run start:dev
COMPANY_ID=$(curl -s -X POST localhost:3000/company -H 'Content-Type: application/json' -d '{"name":"Acme"}' | jq -r .id)
curl -X POST localhost:3000/service -H 'Content-Type: application/json' \
  -d "{\"name\":\"Cambio de filtro\",\"description\":\"Filtro de agua, incluye repuesto\",\"companyId\":\"$COMPANY_ID\"}"
curl -i -X POST localhost:3000/service -H 'Content-Type: application/json' \
  -d '{"name":"X","companyId":"00000000-0000-0000-0000-000000000000"}'   # 400
curl -i -X POST localhost:3000/service -H 'Content-Type: application/json' -d '{"description":"sin nombre"}'   # 400
curl localhost:3000/service
curl localhost:3000/service/<id>
curl -X PATCH localhost:3000/service/<id> -H 'Content-Type: application/json' -d '{"active":false}'
curl localhost:3000/service                                           # ya no aparece
curl localhost:3000/service/<id>                                      # sigue accesible
curl -X DELETE localhost:3000/service/<id>
curl -i localhost:3000/service/00000000-0000-0000-0000-000000000000   # 404
curl -i localhost:3000/service/abc                                    # 400
curl -s localhost:3000/docs-json | jq '.paths | keys | map(select(startswith("/service")))'   # ["/service", "/service/{id}"]
```

## Notas

- **`ServiceService` / `ServiceController`:** el modelo se llama `Service`, así que el scaffold genera `ServiceService`, `ServiceController`, `ServiceModule` y la propiedad `serviceService`. Es válido e intencional; no renombrarlo a mano.
- **Validación:** `src/main.ts` ya tiene un `ValidationPipe` global (`whitelist`, `forbidNonWhitelisted`, `transform`), así que un campo que no esté en el DTO responde 400.
- **`active`:** `findAll` solo lista los servicios activos, pero `findOne` / `update` / `remove` siguen accediendo a los inactivos por id. Así se puede reactivar un servicio con `PATCH /service/:id` y `{ "active": true }`.
- **Borrado y modelos dependientes:** `OrderEntry` tiene un FK (`serviceId`) hacia `Service`. Si el servicio aparece en alguna línea de orden, `remove` falla por la restricción de FK y, con el `handleError` de este spec, responde 500. Mapear ese error a 409 o borrar en cascada queda fuera de alcance. Como `Service` ya tiene `active`, la alternativa futura es el borrado lógico: `PATCH { "active": false }` ya lo permite hoy (el servicio deja de ofrecerse sin romper las órdenes históricas), y más adelante `remove` podría hacer eso en lugar de `delete()`.
- **`companyId` y empresas inactivas:** la verificación del FK solo comprueba que la empresa exista, no que esté activa. Restringirlo a empresas activas, o al tenant del usuario autenticado, queda para cuando haya autenticación.
- **Desasignar la empresa:** `@IsOptional()` deja pasar `null`, así que `PATCH { "companyId": null }` quita la empresa sin consultar `Company` (la verificación solo corre si el valor es truthy).
- **`name` no es único:** el contract no declara `@unique` en `name`, así que dos servicios (incluso de la misma empresa) pueden llamarse igual. Exigir unicidad por empresa (`companyId` + `name`) requeriría modificar el contract y queda fuera de alcance.
