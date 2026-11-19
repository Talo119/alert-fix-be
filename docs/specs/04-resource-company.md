# Spec 04 — Recurso Company (CRUD)

> Roadmap: [00 — Roadmap de recursos](./00-roadmap.md) · Referencia: `src/user/`

## Contexto

`Company` es el tenant de AlertFix: `User`, `Client`, `Service` y `OrderHeader` cuelgan de ella mediante un `companyId` opcional. Es el primer modelo del roadmap y no depende de ningún otro.

Hoy no existe `src/company/`, ni un endpoint para crear empresas. Para asignar un `companyId` a un usuario hay que insertar la empresa directamente en la base de datos. Este spec crea el recurso desde cero con `nest g resource`.

## Objetivo

- Un recurso REST `company` con CRUD completo sobre `db.orm.public.Company`.
- DTOs validados con class-validator a partir del contract.
- Errores HTTP correctos: 400 / 404 / 409 / 500.
- Tests unitarios del service y del controller.

## Alcance

**Dentro:** module, controller, service, DTOs, tests y el registro en `AppModule`.

**Fuera (futuro):** paginación y filtros en `findAll` (p. ej. solo `active = true`), filtrado por tenant (`companyId` del usuario autenticado), autenticación/autorización, borrado lógico o en cascada, y listar las entidades hijas (`GET /company/:id/users`, etc.).

## Modelo

Tomado de `src/prisma/contract.prisma`:

| Campo | Tipo | Requerido | En DTO | Validación |
|---|---|---|---|---|
| `id` | `String` (uuid) | generado | no | — |
| `name` | `String @unique` | sí | sí | `@IsString() @IsNotEmpty()` |
| `active` | `Boolean @default(true)` | no | sí | `@IsOptional() @IsBoolean()` |
| `createdAt` | `DateTime` | generado | no | — |
| `updatedAt` | `temporal.UpdatedAt` | generado | no | — |

Relaciones: `users` → `User[]` (lista inversa, no entra en el DTO). `Client`, `Service` y `OrderHeader` también tienen un `companyId` hacia `Company`, aunque el contract no declara su lista inversa.

## Dependencias

Ninguna: `Company` no tiene FK hacia otros modelos.

**Modelos que dependen de este:** `User`, `Client`, `Service` y `OrderHeader` (ver *Notas*, sobre el borrado).

## Pasos de implementación

### 1. Generar el recurso

```bash
npx nest g resource company
# ? What transport layer do you use? → REST API
# ? Would you like to generate CRUD entry points? → Yes
```

Comprobar:
- `src/app.module.ts` importa `CompanyModule` desde `./company/company.module.js` y lo añade a `imports`;
- todos los imports relativos generados terminan en `.js` (el proyecto es ESM);
- `src/company/entities/company.entity.ts` queda como la clase vacía del scaffold (`export class Company {}`).

### 2. DTOs

`src/company/dto/create-company.dto.ts`:

```ts
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateCompanyDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
```

`src/company/dto/update-company.dto.ts`:

```ts
import { PartialType } from '@nestjs/mapped-types';
import { CreateCompanyDto } from './create-company.dto.js';

export class UpdateCompanyDto extends PartialType(CreateCompanyDto) {}
```

No se crean más DTOs.

### 3. Service

`src/company/company.service.ts`. Toma de base `src/user/user.service.ts`, con estas diferencias:

- **Sin `db.close()`.** `db` es compartido.
- `findOne` lanza `NotFoundException` si `whereUnique({ id }).first()` devuelve `null`.
- `update` y `remove` llaman primero a `this.findOne(id)`, así el 404 sale de un solo lugar.
- En el `catch`, las `HttpException` se relanzan; el resto se loguea y lanza `InternalServerErrorException`.
- **`name` es `@unique`:** antes de `create`, y de `update` cuando el DTO trae `name`, se busca con `where({ name }).first()`. Si existe otra empresa con ese nombre (en `update`, con un `id` distinto), `ConflictException`.
- Sin FK que verificar ni fechas que convertir.

```ts
import {
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { db } from '../prisma/db.js';
import { CreateCompanyDto } from './dto/create-company.dto.js';
import { UpdateCompanyDto } from './dto/update-company.dto.js';

@Injectable()
export class CompanyService {
  private readonly logger = new Logger(CompanyService.name);

  async create(createCompanyDto: CreateCompanyDto) {
    try {
      await this.assertNameAvailable(createCompanyDto.name);
      const company = await db.orm.public.Company.create(createCompanyDto);
      this.logger.log(`Created company ${company.id}`);
      return company;
    } catch (error) {
      this.handleError('Failed to create company', error);
    }
  }

  async findAll() {
    try {
      return await db.orm.public.Company.all();
    } catch (error) {
      this.handleError('Failed to fetch companies', error);
    }
  }

  async findOne(id: string) {
    try {
      const company = await db.orm.public.Company.whereUnique({ id }).first();
      if (!company) throw new NotFoundException(`Company ${id} not found`);
      return company;
    } catch (error) {
      this.handleError(`Failed to fetch company ${id}`, error);
    }
  }

  async update(id: string, updateCompanyDto: UpdateCompanyDto) {
    try {
      await this.findOne(id);
      if (updateCompanyDto.name !== undefined) {
        await this.assertNameAvailable(updateCompanyDto.name, id);
      }
      const company = await db.orm.public.Company.whereUnique({ id }).update(
        updateCompanyDto,
      );
      this.logger.log(`Updated company ${id}`);
      return company;
    } catch (error) {
      this.handleError(`Failed to update company ${id}`, error);
    }
  }

  async remove(id: string) {
    try {
      await this.findOne(id);
      const company = await db.orm.public.Company.where({ id }).delete();
      this.logger.log(`Removed company ${id}`);
      return company;
    } catch (error) {
      this.handleError(`Failed to remove company ${id}`, error);
    }
  }

  private async assertNameAvailable(name: string, exceptId?: string) {
    const existing = await db.orm.public.Company.where({ name }).first();
    if (existing && existing.id !== exceptId) {
      throw new ConflictException(`Company name "${name}" already exists`);
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

`src/company/company.controller.ts`: el del scaffold, con `@Param('id', ParseUUIDPipe) id: string` en `findOne`, `update` y `remove` (igual que `src/user/user.controller.ts`). Nunca `+id`.

### 5. Tests

`src/company/company.service.spec.ts`: mock de `../prisma/db.js` con `vi.hoisted` y `vi.fn()` encadenables, como en `src/user/user.service.spec.ts`:

```ts
const { unique, filtered, companyModel, close } = vi.hoisted(() => {
  const unique = { first: vi.fn(), update: vi.fn() };
  const filtered = { first: vi.fn(), delete: vi.fn() };
  const companyModel = {
    create: vi.fn(),
    all: vi.fn(),
    whereUnique: vi.fn(() => unique),
    where: vi.fn(() => filtered),
  };
  return { unique, filtered, companyModel, close: vi.fn() };
});

vi.mock('../prisma/db.js', () => ({
  db: { orm: { public: { Company: companyModel } }, close },
}));
```

Casos:
- `create` ok: el nombre está libre (`filtered.first` → `null`) y llama a `Company.create` con el DTO.
- `create` con `name` duplicado → `ConflictException` y no llama a `create`.
- `findAll` devuelve la lista.
- `findOne` existe → devuelve el registro; no existe → `NotFoundException`.
- `update` ok, incluido renombrar a su propio nombre actual (misma `id`, sin 409).
- `update` con un `name` de otra empresa → `ConflictException`.
- `update` de un id inexistente → `NotFoundException` y no llama a `unique.update`.
- `remove` ok; `remove` de un id inexistente → `NotFoundException` y no llama a `delete`.
- Un error de BD (p. ej. `all` rechaza con `Error`) → `InternalServerErrorException`.
- `close` nunca se llama.

`src/company/company.controller.spec.ts`: el service se sustituye por un objeto de `vi.fn()` con `{ provide: CompanyService, useValue: { create: vi.fn(), findAll: vi.fn(), findOne: vi.fn(), update: vi.fn(), remove: vi.fn() } }`. Cada endpoint delega con los argumentos correctos (`id` y DTO).

### 6. Roadmap

Marcar `Company` como `Implementado` en [`00-roadmap.md`](./00-roadmap.md).

## Endpoints

| Método | Ruta | Body | Respuesta | Errores |
|---|---|---|---|---|
| `POST` | `/company` | `CreateCompanyDto` | 201, el registro creado | 400 body inválido, 409 `name` duplicado |
| `GET` | `/company` | — | 200, la lista | 500 |
| `GET` | `/company/:id` | — | 200, el registro | 400 id no UUID, 404 |
| `PATCH` | `/company/:id` | `UpdateCompanyDto` | 200, el registro actualizado | 400, 404, 409 `name` duplicado |
| `DELETE` | `/company/:id` | — | 200 | 400 id no UUID, 404, 500 si tiene registros hijos (ver *Notas*) |

## Criterios de aceptación

- [ ] Los 5 endpoints responden según la tabla.
- [ ] Ningún método llama a `db.close()`.
- [ ] Un `id` inexistente responde 404; un `id` que no es UUID responde 400.
- [ ] Un `name` duplicado responde 409, en `POST` y en `PATCH`.
- [ ] Campos desconocidos en el body (`id`, `createdAt`, `users`…) responden 400.
- [ ] `npm run lint` y `npm test` pasan.
- [ ] El roadmap marca `Company` como `Implementado`.

## Verificación

```bash
npm run lint
npx vitest run src/company
npm test

npm run start:dev
curl -X POST localhost:3000/company -H 'Content-Type: application/json' -d '{"name":"Acme"}'
curl -i -X POST localhost:3000/company -H 'Content-Type: application/json' -d '{"name":"Acme"}'   # 409
curl localhost:3000/company
curl localhost:3000/company/<id>
curl -X PATCH localhost:3000/company/<id> -H 'Content-Type: application/json' -d '{"active":false}'
curl -X DELETE localhost:3000/company/<id>
curl -i localhost:3000/company/00000000-0000-0000-0000-000000000000   # 404
curl -i localhost:3000/company/abc                                    # 400
```

## Notas

- **Validación:** `src/main.ts` ya tiene un `ValidationPipe` global (`whitelist`, `forbidNonWhitelisted`, `transform`), así que los decoradores de los DTOs se aplican en runtime y los campos que no están en el DTO responden 400.
- **Borrado y modelos dependientes:** `User`, `Client`, `Service` y `OrderHeader` tienen un FK hacia `Company`. Si la empresa tiene registros asociados, `remove` falla por la restricción de FK y, con el `handleError` de este spec, responde 500. Mapear ese error a 409 o borrar en cascada queda fuera de alcance. Como `Company` ya tiene `active`, la alternativa futura es el borrado lógico: `PATCH /company/:id` con `{ "active": false }` ya lo permite, y más adelante `remove` podría hacer eso en lugar de `delete()`.
- **Carrera en `name`:** la comprobación previa con `where({ name }).first()` no evita que dos peticiones simultáneas pasen la verificación. En ese caso la restricción `@unique` de la base de datos rechaza la segunda inserción, que acaba en 500. Es aceptable por ahora.
- **Diferencia con `src/user/`:** `UserService` deja propagar los errores de BD (Nest los convierte en 500) y `update`/`remove` detectan el 404 por el `null` de la query. Este spec sigue las reglas de la skill: `findOne` previo y `InternalServerErrorException` explícito.
