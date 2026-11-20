# Spec 06 — Recurso Client (CRUD)

> Roadmap: [00 — Roadmap de recursos](./00-roadmap.md) · Referencia: `src/company/`, `src/user/`

## Contexto

`Client` es el cliente final de una empresa de AlertFix: la persona a la que se le hacen las órdenes de mantenimiento (`OrderHeader.clientId`) y la que recibe los recordatorios por WhatsApp. Cuelga de `Company` (tenant) mediante un `companyId` opcional.

Hoy no existe `src/client/` ni un endpoint para dar de alta clientes; para crear una orden habría que insertar el cliente directamente en la base de datos. Este spec crea el recurso desde cero con `nest g resource`, siguiendo la estructura de `src/company/`.

## Objetivo

- Un recurso REST `client` con CRUD completo sobre `db.orm.public.Client`.
- DTOs validados con class-validator a partir del contract.
- Errores HTTP correctos: 400 / 404 / 409 / 500.
- `findAll` devuelve solo los clientes con `active = true`.
- El recurso documentado en Swagger (`/docs`) con su propio tag.
- Tests unitarios del service y del controller.

## Alcance

**Dentro:** module, controller, service, DTOs, documentación Swagger (`@ApiTags`, tag en `src/swagger.ts`), tests y el registro en `AppModule`.

**Fuera (futuro):** paginación y filtros en `findAll` (p. ej. por `companyId`), filtrado por tenant (`companyId` del usuario autenticado), autenticación/autorización, borrado lógico en `remove`, normalización/validación del teléfono a formato E.164 para WhatsApp, y listar las órdenes del cliente (`GET /client/:id/orders`).

## Modelo

Tomado de `src/prisma/contract.prisma`:

| Campo | Tipo | Requerido | En DTO | Validación |
|---|---|---|---|---|
| `id` | `String` (uuid) | generado | no | — |
| `name` | `String` | sí | sí | `@IsString() @IsNotEmpty()` |
| `email` | `String @unique` | sí | sí | `@IsEmail() @IsNotEmpty()` |
| `phoneNumber` | `String?` | no | sí | `@IsOptional() @IsString()` |
| `companyId` | `String?` (FK) | no | sí | `@IsOptional() @IsUUID()` |
| `active` | `Boolean @default(true)` | no | sí | `@IsOptional() @IsBoolean()` |
| `createdAt` | `DateTime` | generado | no | — |
| `updatedAt` | `temporal.UpdatedAt` | generado | no | — |

Relaciones: `company` → `Company` vía `companyId` (el objeto de relación no entra en el DTO).

## Dependencias

| Modelo | FK | Estado en roadmap |
|---|---|---|
| Company | `companyId` | Implementado |

**Modelos que dependen de este:** `OrderHeader` (`clientId`). Ver *Notas*, sobre el borrado.

## Pasos de implementación

### 1. Generar el recurso

```bash
npx nest g resource client
# ? What transport layer do you use? → REST API
# ? Would you like to generate CRUD entry points? → Yes
```

Comprobar:
- `src/app.module.ts` importa `ClientModule` desde `./client/client.module.js` y lo añade a `imports`;
- todos los imports relativos generados terminan en `.js` (el proyecto es ESM);
- `src/client/entities/client.entity.ts` queda como la clase vacía del scaffold (`export class Client {}`).

### 2. DTOs

`src/client/dto/create-client.dto.ts`:

```ts
import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateClientDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @IsOptional()
  @IsUUID()
  companyId?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
```

`src/client/dto/update-client.dto.ts`:

`PartialType` se importa de `@nestjs/swagger` (no de `@nestjs/mapped-types`) para que el esquema OpenAPI herede las propiedades.

```ts
import { PartialType } from '@nestjs/swagger';
import { CreateClientDto } from './create-client.dto.js';

export class UpdateClientDto extends PartialType(CreateClientDto) {}
```

No se crean más DTOs.

### 3. Service

`src/client/client.service.ts`. Toma de base `src/company/company.service.ts` (que ya aplica las correcciones al patrón de `src/user/`):

- **Sin `db.close()`.** `db` es compartido.
- `findOne` lanza `NotFoundException` si `whereUnique({ id }).first()` devuelve `null`.
- `update` y `remove` llaman primero a `this.findOne(id)`, así el 404 sale de un solo lugar.
- En el `catch`, las `HttpException` se relanzan; el resto se loguea y lanza `InternalServerErrorException`.
- **FK `companyId`:** en `create`, y en `update` cuando el DTO trae `companyId`, se verifica con `db.orm.public.Company.whereUnique({ id }).first()`. Si no existe, `BadRequestException(\`Company ${companyId} does not exist\`)`.
- **`email` es `@unique`:** antes de `create`, y de `update` cuando el DTO trae `email`, se busca con `where({ email }).first()`. Si existe otro cliente con ese email (en `update`, con un `id` distinto), `ConflictException`.
- **`findAll`** filtra con `where({ active: true }).all()`. `findOne`, `update` y `remove` no filtran por `active`.
- Sin fechas que convertir.

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
import { CreateClientDto } from './dto/create-client.dto.js';
import { UpdateClientDto } from './dto/update-client.dto.js';

@Injectable()
export class ClientService {
  private readonly logger = new Logger(ClientService.name);

  async create(createClientDto: CreateClientDto) {
    try {
      await this.assertEmailAvailable(createClientDto.email);
      if (createClientDto.companyId) {
        await this.assertCompanyExists(createClientDto.companyId);
      }
      const client = await db.orm.public.Client.create(createClientDto);
      this.logger.log(`Created client ${client.id}`);
      return client;
    } catch (error) {
      this.handleError('Failed to create client', error);
    }
  }

  async findAll() {
    try {
      return await db.orm.public.Client.where({ active: true }).all();
    } catch (error) {
      this.handleError('Failed to fetch clients', error);
    }
  }

  async findOne(id: string) {
    try {
      const client = await db.orm.public.Client.whereUnique({ id }).first();
      if (!client) throw new NotFoundException(`Client ${id} not found`);
      return client;
    } catch (error) {
      this.handleError(`Failed to fetch client ${id}`, error);
    }
  }

  async update(id: string, updateClientDto: UpdateClientDto) {
    try {
      await this.findOne(id);
      if (updateClientDto.email !== undefined) {
        await this.assertEmailAvailable(updateClientDto.email, id);
      }
      if (updateClientDto.companyId) {
        await this.assertCompanyExists(updateClientDto.companyId);
      }
      const client = await db.orm.public.Client.whereUnique({ id }).update(
        updateClientDto,
      );
      this.logger.log(`Updated client ${id}`);
      return client;
    } catch (error) {
      this.handleError(`Failed to update client ${id}`, error);
    }
  }

  async remove(id: string) {
    try {
      await this.findOne(id);
      const client = await db.orm.public.Client.where({ id }).delete();
      this.logger.log(`Removed client ${id}`);
      return client;
    } catch (error) {
      this.handleError(`Failed to remove client ${id}`, error);
    }
  }

  private async assertEmailAvailable(email: string, exceptId?: string) {
    const existing = await db.orm.public.Client.where({ email }).first();
    if (existing && existing.id !== exceptId) {
      throw new ConflictException(`Client email "${email}" already exists`);
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

`src/client/client.controller.ts`: el del scaffold, con `@Param('id', ParseUUIDPipe) id: string` en `findOne`, `update` y `remove`, `@ApiTags('client')` y un JSDoc de una línea por método (se convierte en el `summary` de Swagger). Nunca `+id`. Referencia: `src/company/company.controller.ts`.

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
import { ClientService } from './client.service.js';
import { CreateClientDto } from './dto/create-client.dto.js';
import { UpdateClientDto } from './dto/update-client.dto.js';

@ApiTags('client')
@Controller('client')
export class ClientController {
  constructor(private readonly clientService: ClientService) {}

  /** Crea un cliente. */
  @Post()
  create(@Body() createClientDto: CreateClientDto) {
    return this.clientService.create(createClientDto);
  }

  /** Lista los clientes activos. */
  @Get()
  findAll() {
    return this.clientService.findAll();
  }

  /** Obtiene un cliente por id (incluidos los inactivos). */
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.clientService.findOne(id);
  }

  /** Actualiza un cliente. */
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateClientDto: UpdateClientDto,
  ) {
    return this.clientService.update(id, updateClientDto);
  }

  /** Elimina un cliente. */
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.clientService.remove(id);
  }
}
```

### 5. Swagger

- `src/swagger.ts`: añadir `.addTag('client')` al `DocumentBuilder` de `setupSwagger`, junto a `company`, `user` y `reminder`.
- `docs/specs/05-openapi-swagger.md`: añadir `client` a la lista de recursos documentados (*Contexto*) y a los tags (*Implementación*).
- No hacen falta `@ApiProperty`: el plugin CLI (`nest-cli.json`) genera el esquema desde los DTOs y class-validator (`@IsEmail()` → `format: email`, `@IsUUID()` → `format: uuid`), siempre que los archivos terminen en `.dto.ts` / `.controller.ts`.

### 6. Tests

`src/client/client.service.spec.ts`: mock de `../prisma/db.js` con `vi.hoisted` y `vi.fn()` encadenables, como en `src/company/company.service.spec.ts`. `where(...)` devuelve un objeto con `first`, `all` y `delete`, porque se usa para el filtro de `active`, la búsqueda por `email` y el borrado; y hace falta también el modelo `Company` para la verificación del FK:

```ts
const { unique, filtered, clientModel, companyUnique, companyModel, close } =
  vi.hoisted(() => {
    const unique = { first: vi.fn(), update: vi.fn() };
    const filtered = { first: vi.fn(), all: vi.fn(), delete: vi.fn() };
    const clientModel = {
      create: vi.fn(),
      whereUnique: vi.fn(() => unique),
      where: vi.fn(() => filtered),
    };
    const companyUnique = { first: vi.fn() };
    const companyModel = { whereUnique: vi.fn(() => companyUnique) };
    return {
      unique,
      filtered,
      clientModel,
      companyUnique,
      companyModel,
      close: vi.fn(),
    };
  });

vi.mock('../prisma/db.js', () => ({
  db: { orm: { public: { Client: clientModel, Company: companyModel } }, close },
}));
```

Casos:
- `create` ok: email libre (`filtered.first` → `null`), empresa existe (`companyUnique.first` → empresa) y llama a `Client.create` con el DTO.
- `create` sin `companyId`: no consulta `Company` y crea el cliente.
- `create` con `companyId` inexistente → `BadRequestException` y no llama a `create`.
- `create` con `email` duplicado → `ConflictException` y no llama a `create`.
- `findAll` llama a `where({ active: true })` y luego a `all()`, y devuelve la lista.
- `findOne` existe → devuelve el registro; no existe → `NotFoundException`.
- `update` ok, incluido mantener su propio email (misma `id`, sin 409).
- `update` con el `email` de otro cliente → `ConflictException`.
- `update` con `companyId` inexistente → `BadRequestException` y no llama a `unique.update`.
- `update` de un id inexistente → `NotFoundException` y no llama a `unique.update`.
- `remove` ok; `remove` de un id inexistente → `NotFoundException` y no llama a `delete`.
- Un error de BD (p. ej. `filtered.all` rechaza con `Error`) → `InternalServerErrorException`.
- `close` nunca se llama.

`src/client/client.controller.spec.ts`: el service se sustituye por un objeto de `vi.fn()` con `{ provide: ClientService, useValue: { create: vi.fn(), findAll: vi.fn(), findOne: vi.fn(), update: vi.fn(), remove: vi.fn() } }`. Cada endpoint delega con los argumentos correctos (`id` y DTO).

### 7. Roadmap

Marcar `Client` como `Implementado` en [`00-roadmap.md`](./00-roadmap.md).

## Endpoints

| Método | Ruta | Body | Respuesta | Errores |
|---|---|---|---|---|
| `POST` | `/client` | `CreateClientDto` | 201, el registro creado | 400 body inválido o `companyId` inexistente, 409 `email` duplicado |
| `GET` | `/client` | — | 200, la lista (solo `active = true`) | 500 |
| `GET` | `/client/:id` | — | 200, el registro | 400 id no UUID, 404 |
| `PATCH` | `/client/:id` | `UpdateClientDto` | 200, el registro actualizado | 400 (body, id o `companyId`), 404, 409 `email` duplicado |
| `DELETE` | `/client/:id` | — | 200 | 400 id no UUID, 404, 500 si tiene órdenes (ver *Notas*) |

## Criterios de aceptación

- [ ] Los 5 endpoints responden según la tabla.
- [ ] Ningún método llama a `db.close()`.
- [ ] Un `id` inexistente responde 404; un `id` que no es UUID responde 400.
- [ ] Un `companyId` que no existe responde 400, en `POST` y en `PATCH`.
- [ ] Un `email` duplicado responde 409, en `POST` y en `PATCH`; un email mal formado responde 400.
- [ ] `GET /client` no devuelve clientes con `active = false`; `GET /client/:id` sí los devuelve.
- [ ] Campos desconocidos en el body (`id`, `createdAt`, `company`…) responden 400.
- [ ] `/docs` muestra el tag `client` con los 5 endpoints y el esquema de `CreateClientDto` / `UpdateClientDto`.
- [ ] `npm run lint` y `npm test` pasan.
- [ ] El roadmap marca `Client` como `Implementado`.

## Verificación

```bash
npm run lint
npx vitest run src/client
npm test

npm run start:dev
COMPANY_ID=$(curl -s -X POST localhost:3000/company -H 'Content-Type: application/json' -d '{"name":"Acme"}' | jq -r .id)
curl -X POST localhost:3000/client -H 'Content-Type: application/json' \
  -d "{\"name\":\"Ana Pérez\",\"email\":\"ana@example.com\",\"phoneNumber\":\"+50688887777\",\"companyId\":\"$COMPANY_ID\"}"
curl -i -X POST localhost:3000/client -H 'Content-Type: application/json' -d '{"name":"Otra","email":"ana@example.com"}'   # 409
curl -i -X POST localhost:3000/client -H 'Content-Type: application/json' \
  -d '{"name":"X","email":"x@example.com","companyId":"00000000-0000-0000-0000-000000000000"}'                         # 400
curl localhost:3000/client
curl localhost:3000/client/<id>
curl -X PATCH localhost:3000/client/<id> -H 'Content-Type: application/json' -d '{"active":false}'
curl localhost:3000/client                                           # ya no aparece
curl localhost:3000/client/<id>                                      # sigue accesible
curl -X DELETE localhost:3000/client/<id>
curl -i localhost:3000/client/00000000-0000-0000-0000-000000000000   # 404
curl -i localhost:3000/client/abc                                    # 400
curl -s localhost:3000/docs-json | jq '.paths | keys | map(select(startswith("/client")))'   # ["/client", "/client/{id}"]
```

## Notas

- **Validación:** `src/main.ts` ya tiene un `ValidationPipe` global (`whitelist`, `forbidNonWhitelisted`, `transform`), así que un campo que no esté en el DTO responde 400.
- **`active`:** `findAll` solo lista los clientes activos, pero `findOne` / `update` / `remove` siguen accediendo a los inactivos por id. Así se puede reactivar un cliente con `PATCH /client/:id` y `{ "active": true }`.
- **Borrado y modelos dependientes:** `OrderHeader` tiene un FK (`clientId`) hacia `Client`. Si el cliente tiene órdenes, `remove` falla por la restricción de FK y, con el `handleError` de este spec, responde 500. Mapear ese error a 409 o borrar en cascada queda fuera de alcance. Como `Client` ya tiene `active`, la alternativa futura es el borrado lógico: `PATCH { "active": false }` ya lo permite hoy, y más adelante `remove` podría hacer eso en lugar de `delete()`.
- **`companyId` y empresas inactivas:** la verificación del FK solo comprueba que la empresa exista, no que esté activa. Restringirlo a empresas activas, o al tenant del usuario autenticado, queda para cuando haya autenticación.
- **Desasignar la empresa:** `@IsOptional()` deja pasar `null`, así que `PATCH { "companyId": null }` quita la empresa sin consultar `Company` (la verificación solo corre si el valor es truthy).
- **`email` único global:** el contract declara `email @unique` en toda la tabla, no por empresa. Dos empresas no pueden registrar el mismo cliente con el mismo email. Cambiarlo a una unicidad compuesta (`companyId` + `email`) requeriría modificar el contract y queda fuera de alcance.
- **Carrera en `email`:** la comprobación previa con `where({ email }).first()` no evita que dos peticiones simultáneas pasen la verificación. En ese caso la restricción `@unique` rechaza la segunda inserción, que acaba en 500. Es aceptable por ahora.
- **`phoneNumber`:** es el destino de los recordatorios por WhatsApp (spec 03), pero aquí solo se valida como string. Validarlo como E.164 (`@IsPhoneNumber()`) queda fuera de alcance.
