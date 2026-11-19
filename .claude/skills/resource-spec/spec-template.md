# Spec <NN> — Recurso <Model> (CRUD)

> Roadmap: [00 — Roadmap de recursos](./00-roadmap.md) · Referencia: `src/user/`

## Contexto

<Para qué sirve <Model> en AlertFix (ver *Domain model* en CLAUDE.md) y qué existe hoy. Si `src/<kebab>/` ya existe, describir qué hay implementado y qué es stub.>

## Objetivo

- Un recurso REST `<kebab>` con CRUD completo sobre `db.orm.public.<Model>`.
- DTOs validados con class-validator a partir del contract.
- Errores HTTP correctos: 400 / 404 / 409 / 500.
- Tests unitarios del service y del controller.

## Alcance

**Dentro:** module, controller, service, DTOs, tests y el registro en `AppModule`.

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

```ts
import { PartialType } from '@nestjs/mapped-types';
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

  async findOne(id: string) {
    try {
      const <var> = await db.orm.public.<Model>.whereUnique({ id }).first();
      if (!<var>) throw new NotFoundException(`<Model> ${id} not found`);
      return <var>;
    } catch (error) {
      this.handleError(`Failed to fetch <model> ${id}`, error);
    }
  }

  // create, findAll, update, remove: mismo patrón

  private handleError(message: string, error: unknown): never {
    if (error instanceof HttpException) throw error;
    this.logger.error(message, error instanceof Error ? error.message : String(error));
    throw new InternalServerErrorException(message);
  }
}
```

### 4. Controller

`src/<kebab>/<kebab>.controller.ts`: el del scaffold, con `@Param('id', ParseUUIDPipe) id: string` en `findOne`, `update` y `remove`.

### 5. Tests

- `<kebab>.service.spec.ts`: `vi.mock('../prisma/db.js', ...)` con `vi.fn()` encadenables. Casos: <lista según las *Reglas del spec* de la skill: create ok / FK inexistente 400 / duplicado 409, findAll, findOne ok / 404, update ok / 404, remove ok / 404>.
- `<kebab>.controller.spec.ts`: el service se sustituye por un objeto de `vi.fn()` (`useValue`). Cada endpoint delega con los argumentos correctos.

### 6. Roadmap

Marcar `<Model>` como `Implementado` en [`00-roadmap.md`](./00-roadmap.md).

## Endpoints

| Método | Ruta | Body | Respuesta | Errores |
|---|---|---|---|---|
| `POST` | `/<kebab>` | `Create<Model>Dto` | 201, el registro creado | 400 FK inexistente<, 409 duplicado> |
| `GET` | `/<kebab>` | — | 200, la lista | 500 |
| `GET` | `/<kebab>/:id` | — | 200, el registro | 400 id no UUID, 404 |
| `PATCH` | `/<kebab>/:id` | `Update<Model>Dto` | 200, el registro actualizado | 400, 404<, 409> |
| `DELETE` | `/<kebab>/:id` | — | 200 | 400 id no UUID, 404 |

## Criterios de aceptación

- [ ] Los 5 endpoints responden según la tabla.
- [ ] Ningún método llama a `db.close()`.
- [ ] Un `id` inexistente responde 404; un `id` que no es UUID responde 400.
- [ ] <FK inexistente → 400.> <Duplicado en `<campo>` → 409.>
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
```

## Notas

- Aún no hay un `ValidationPipe` global (ver *Pendientes transversales* en el roadmap). Hasta que se añada, los decoradores de los DTOs no se aplican en runtime.
- <Modelos que dependen de este: `remove` puede fallar por la restricción de FK.>
- <`status` es un string libre; no hay enum todavía.>
- <Solo para `Service`: las clases quedan `ServiceService` / `ServiceController`, y es intencional.>
