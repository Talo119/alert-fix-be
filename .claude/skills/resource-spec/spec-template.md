# Spec <NN> — Recurso <Model> (CRUD)

> Roadmap: [00 — Roadmap de recursos](./00-roadmap.md) · Referencia: `src/user/`

## Contexto

<Para qué sirve <Model> en AlertFix (ver *Domain model* en CLAUDE.md) y qué existe hoy. Si `src/<kebab>/` ya existe, describir qué hay implementado y qué es stub.>

## Objetivo

- Un recurso REST `<kebab>` con CRUD completo sobre `db.orm.public.<Model>`.
- DTOs validados con class-validator a partir del contract.
- Errores HTTP correctos: 400 / 404 / 409 / 500.
- <Si el modelo tiene `active`: `findAll` devuelve solo los registros con `active = true`.>
- El recurso documentado en Swagger (`/docs`) con su propio tag.
- Tests unitarios del service y del controller.

## Alcance

**Dentro:** module, controller, service, DTOs, documentación Swagger (`@ApiTags`, tag en `src/swagger.ts`), tests y el registro en `AppModule`.

**Fuera (futuro):** paginación y filtros en `findAll`, filtrado por tenant (`companyId` del usuario autenticado), autenticación/autorización, borrado lógico<, y lo que aplique al modelo>.

## Modelo

Tomado de `src/prisma/contract.prisma`:

| Campo | Tipo | Requerido | En DTO | Validación |
|---|---|---|---|---|
| `id` | `String` (uuid) | generado | no | — |
| `<campo>` | `<Tipo>` | <sí/no> | <sí/no> | `<decoradores>` |
| `createdAt` | `DateTime` | generado | no | — |
| `updatedAt` | `temporal.UpdatedAt` | generado | no | — |

Relaciones: <`company` → `Company` vía `companyId`, ...>.

## Dependencias

| Modelo | FK | Estado en roadmap |
|---|---|---|
| <Ref> | `<refId>` | <Pendiente / Spec lista / Parcial / Implementado> |

<Si alguna dependencia no está `Implementado`: los endpoints de <Ref> no existen todavía, así que para probar habrá que insertar los registros directamente en la base de datos o dejar el FK en `null`.>

## Pasos de implementación

### 1. Generar el recurso

```bash
npx nest g resource <kebab>
# ? What transport layer do you use? → REST API
# ? Would you like to generate CRUD entry points? → Yes
```

Comprobar:
- `src/app.module.ts` importa `<Model>Module` desde `./<kebab>/<kebab>.module.js`;
- todos los imports relativos generados terminan en `.js` (el proyecto es ESM).

<Si `src/<kebab>/` ya existe, reemplazar este paso por: "No regenerar. Completar los métodos stub de `<kebab>.service.ts` y conservar <archivos existentes que no se tocan>.">

### 2. DTOs

`src/<kebab>/dto/create-<kebab>.dto.ts`:

```ts
import { <decoradores usados> } from 'class-validator';

export class Create<Model>Dto {
  <campo con decoradores, según la tabla de Modelo>
}
```

`src/<kebab>/dto/update-<kebab>.dto.ts`:

`PartialType` se importa de `@nestjs/swagger` (no de `@nestjs/mapped-types`) para que el esquema OpenAPI herede las propiedades.

```ts
import { PartialType } from '@nestjs/swagger';
import { Create<Model>Dto } from './create-<kebab>.dto.js';

export class Update<Model>Dto extends PartialType(Create<Model>Dto) {}
```

### 3. Service

`src/<kebab>/<kebab>.service.ts`. Toma de base `src/user/user.service.ts`, con estas diferencias:

- **Sin `db.close()`.** `db` es compartido.
- `findOne` lanza `NotFoundException` si `whereUnique({ id }).first()` devuelve `null`.
- `update` y `remove` llaman primero a `this.findOne(id)`.
- En el `catch`, las `HttpException` se relanzan; el resto se loguea y lanza `InternalServerErrorException`.
- <Verificación de FK: `<refId>` → `BadRequestException` si `<Ref>` no existe.>
- <`@unique` `<campo>` → `ConflictException` si ya existe.>
- <Conversión de `<campoFecha>` con `new Date(...)`.>
- <Si el modelo tiene `active`: `findAll` filtra con `where({ active: true }).all()`. Si no: `all()`.>

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
import { Create<Model>Dto } from './dto/create-<kebab>.dto.js';
import { Update<Model>Dto } from './dto/update-<kebab>.dto.js';

@Injectable()
export class <Model>Service {
  private readonly logger = new Logger(<Model>Service.name);

  async findAll() {
    try {
      // Con campo `active`: solo los activos. Sin él: db.orm.public.<Model>.all()
      return await db.orm.public.<Model>.where({ active: true }).all();
    } catch (error) {
      this.handleError('Failed to fetch <models>', error);
    }
  }

  async findOne(id: string) {
    try {
      const <var> = await db.orm.public.<Model>.whereUnique({ id }).first();
      if (!<var>) throw new NotFoundException(`<Model> ${id} not found`);
      return <var>;
    } catch (error) {
      this.handleError(`Failed to fetch <model> ${id}`, error);
    }
  }

  // create, update, remove: mismo patrón

  private handleError(message: string, error: unknown): never {
    if (error instanceof HttpException) throw error;
    this.logger.error(message, error instanceof Error ? error.message : String(error));
    throw new InternalServerErrorException(message);
  }
}
```

### 4. Controller

`src/<kebab>/<kebab>.controller.ts`: el del scaffold, con `@Param('id', ParseUUIDPipe) id: string` en `findOne`, `update` y `remove`, `@ApiTags('<kebab>')` y un JSDoc de una línea por método (se convierte en el `summary` de Swagger). Referencia: `src/company/company.controller.ts`.

```ts
import { ApiTags } from '@nestjs/swagger';

@ApiTags('<kebab>')
@Controller('<kebab>')
export class <Model>Controller {
  constructor(private readonly <var>Service: <Model>Service) {}

  /** Lista los <modelos><, solo los activos>. */
  @Get()
  findAll() {
    return this.<var>Service.findAll();
  }

  // create, findOne, update, remove: mismo patrón, cada uno con su JSDoc
}
```

### 5. Swagger

- `src/swagger.ts`: añadir `.addTag('<kebab>')` al `DocumentBuilder` de `setupSwagger`, junto a los tags existentes.
- `docs/specs/05-openapi-swagger.md`: añadir `<kebab>` a la lista de recursos documentados (*Contexto*) y a los tags (*Implementación*).
- No hacen falta `@ApiProperty`: el plugin CLI (`nest-cli.json`) genera el esquema desde los DTOs y class-validator, siempre que los archivos terminen en `.dto.ts` / `.controller.ts`.

### 6. Tests

- `<kebab>.service.spec.ts`: `vi.mock('../prisma/db.js', ...)` con `vi.fn()` encadenables. Casos: <lista según las *Reglas del spec* de la skill: create ok / FK inexistente 400 / duplicado 409, findAll (con `active`: llama a `where({ active: true })`), findOne ok / 404, update ok / 404, remove ok / 404>.
- `<kebab>.controller.spec.ts`: el service se sustituye por un objeto de `vi.fn()` (`useValue`). Cada endpoint delega con los argumentos correctos.

### 7. Roadmap

Marcar `<Model>` como `Implementado` en [`00-roadmap.md`](./00-roadmap.md).

## Endpoints

| Método | Ruta | Body | Respuesta | Errores |
|---|---|---|---|---|
| `POST` | `/<kebab>` | `Create<Model>Dto` | 201, el registro creado | 400 FK inexistente<, 409 duplicado> |
| `GET` | `/<kebab>` | — | 200, la lista<, solo `active = true`> | 500 |
| `GET` | `/<kebab>/:id` | — | 200, el registro | 400 id no UUID, 404 |
| `PATCH` | `/<kebab>/:id` | `Update<Model>Dto` | 200, el registro actualizado | 400, 404<, 409> |
| `DELETE` | `/<kebab>/:id` | — | 200 | 400 id no UUID, 404 |

## Criterios de aceptación

- [ ] Los 5 endpoints responden según la tabla.
- [ ] Ningún método llama a `db.close()`.
- [ ] Un `id` inexistente responde 404; un `id` que no es UUID responde 400.
- [ ] <FK inexistente → 400.> <Duplicado en `<campo>` → 409.>
- [ ] <`GET /<kebab>` no devuelve registros con `active = false`.>
- [ ] `/docs` muestra el tag `<kebab>` con los 5 endpoints y el esquema de `Create<Model>Dto` / `Update<Model>Dto`.
- [ ] `npm run lint` y `npm test` pasan.
- [ ] El roadmap marca `<Model>` como `Implementado`.

## Verificación

```bash
npm run lint
npx vitest run src/<kebab>
npm test

npm run start:dev
curl -X POST localhost:3000/<kebab> -H 'Content-Type: application/json' -d '<json de ejemplo>'
curl localhost:3000/<kebab>
curl localhost:3000/<kebab>/<id>
curl -X PATCH localhost:3000/<kebab>/<id> -H 'Content-Type: application/json' -d '<json parcial>'
curl -X DELETE localhost:3000/<kebab>/<id>
curl -i localhost:3000/<kebab>/00000000-0000-0000-0000-000000000000   # 404
curl -i localhost:3000/<kebab>/abc                                    # 400
curl -s localhost:3000/docs-json | jq '.paths | keys | map(select(startswith("/<kebab>")))'   # ["/<kebab>", "/<kebab>/{id}"]
```

## Notas

- El `ValidationPipe` global de `src/main.ts` (`whitelist`, `forbidNonWhitelisted`) rechaza con 400 los campos que no estén en el DTO.
- <Con `active`: `findAll` solo lista los activos, pero `findOne` / `update` / `remove` siguen accediendo a los inactivos por id (permite reactivar con `PATCH { "active": true }`).>
- <Modelos que dependen de este: `remove` puede fallar por la restricción de FK.>
- <`status` es un string libre; no hay enum todavía.>
- <Solo para `Service`: las clases quedan `ServiceService` / `ServiceController`, y es intencional.>
