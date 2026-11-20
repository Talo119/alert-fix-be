---
name: resource-sync
description: Sincroniza el recurso CRUD de un modelo (DTO, service, controller y sus tests en src/<kebab>/) cuando se le agregan propiedades nuevas en src/prisma/contract.prisma. Úsala cuando digan "agregué un campo a X", "nuevas propiedades en el contract", "actualiza el service/controller de X con los campos nuevos" o después de editar un modelo del contract.
argument-hint: [Modelo]
---

# resource-sync

Lleva al recurso de un modelo las propiedades que se le agregaron en `src/prisma/contract.prisma`: DTO, service, controller y tests. **No** crea recursos nuevos (para eso está `/resource-spec`) ni escribe migraciones.

Argumento: `$ARGUMENTS` (nombre del modelo, opcional).

## Flujo

### 1. Resolver los modelos

- **Con argumento:** normaliza `$ARGUMENTS` (sin guiones, guiones bajos ni espacios; minúsculas) y compáralo con los `model <Nombre>` del contract. `order-header`, `orderheader` y `OrderHeader` resuelven a `OrderHeader`. Si no existe, lista los modelos válidos y detente.
- **Sin argumento:** usa `git diff HEAD -- src/prisma/contract.prisma` y toma los modelos con líneas de campo añadidas. Si no hay cambios sin commitear, compara el contract con el commit anterior (`git diff HEAD~1 -- src/prisma/contract.prisma`). Si aun así no hay nada, pregunta qué modelo sincronizar.

Procesa cada modelo por separado (pasos 2 a 7).

### 2. Comprobar que el recurso existe

Recurso = el modelo en kebab-case singular (`OrderHeader` → `src/order-header/`). Lee completos `dto/create-<kebab>.dto.ts`, `dto/update-<kebab>.dto.ts`, `<kebab>.service.ts`, `<kebab>.controller.ts` y sus `.spec.ts`.

Detente y sugiere `/resource-spec <Modelo>` si:
- no existe `src/<kebab>/`, o
- el service es un stub (devuelve strings como `'This action adds a new ...'`) o el `Create<Model>Dto` está vacío, como hoy en `src/reminder/`. Sincronizar campos sobre un CRUD que no existe no tiene sentido; consulta el estado en `docs/specs/00-roadmap.md`.

### 3. Detectar las propiedades nuevas

La fuente de verdad es la diferencia entre el modelo y `Create<Model>Dto`, no solo el diff de git (así también se recuperan campos que se agregaron antes y nunca se llevaron al recurso).

- **Campos candidatos del modelo:** todos, excepto `id`, `createdAt`, `updatedAt`, los campos de relación (`company Company? @relation(...)`) y las listas inversas (`users User[]`). El FK escalar (`companyId`) sí cuenta.
- **Nuevos** = candidatos que no son propiedad de `Create<Model>Dto`.
- Para cada nuevo anota: tipo, `?`, `@unique`, `@default`, y si es FK (aparece en `fields: [...]` de un `@relation`) a qué modelo apunta.
- **Listas inversas nuevas** (p. ej. `reminders Reminder[]` agregado a `OrderHeader`): no cambian este recurso. Anótalas para el reporte (ver *Modelos que dependen*).

Si **no hay** propiedades nuevas, dilo y detente.

Si encuentras **otras discrepancias** (un campo del DTO que ya no está en el modelo, o un tipo/opcionalidad que no coincide, como `username` requerido en `CreateUserDto` siendo `String?` en el contract), **no las corrijas**: lístalas en el reporte final. Esta skill solo agrega.

### 4. DTO

Agrega cada propiedad nueva a `Create<Model>Dto` con los decoradores de la tabla *Mapeo contract → decoradores* de `.claude/skills/resource-spec/SKILL.md` (sección *DTO de creación*). Léela de ahí para no duplicarla. Recordatorios:

- importa los decoradores nuevos de `class-validator` en el import existente, en orden alfabético;
- los opcionales llevan `?` en la propiedad (`notes?: string`);
- `DateTime` se recibe como `string` (`@IsDateString()`), con un JSDoc de una línea con el formato ISO, como `serviceDate` en `src/order-header/dto/create-order-header.dto.ts`;
- `status` o cualquier `String` de valores libres: JSDoc `/** ... Valor libre por ahora (sin enum). */`.

`Update<Model>Dto` usa `PartialType(Create<Model>Dto)` de `@nestjs/swagger` y hereda solo; no lo toques salvo que no siga ese patrón (en ese caso, repórtalo).

### 5. Service

Según el tipo de cada propiedad nueva. Toma de referencia `src/client/client.service.ts` (único + un FK) y `src/order-header/order-header.service.ts` (fechas + varios FK).

| Propiedad nueva | Cambio en el service |
|---|---|
| Escalar simple (`String`, `Int`, `Boolean`, opcional o no) | **Ninguno.** El DTO se pasa tal cual a `create`/`update`. No agregues código. |
| `@unique` | Helper privado `assert<Campo>Available(valor, exceptId?)` con `where({ campo }).first()` → `ConflictException(\`<Model> <campo> "${valor}" already exists\`)` si existe otro registro (`existing.id !== exceptId`). Llamarlo en `create`, y en `update` solo si `dto.<campo> !== undefined`, pasando `id`. Si ya hay un helper de unicidad para otro campo, crea uno aparte por campo. |
| FK `xxxId` | Verificar que el referenciado exista: `db.orm.public.<Ref>.whereUnique({ id }).first()` → `BadRequestException(\`<Ref> ${id} does not exist\`)`, solo si el DTO trae el FK. En `create` y en `update` (después de `await this.findOne(id)`). Si el service ya tenía un helper para **un** FK y ahora hay dos o más, reemplázalo por un único `assertReferencesExist(dto: Update<Model>Dto)` como en order-header. |
| `DateTime` / `DateTime?` | Desestructurar el campo y convertir con `new Date(...)`. En `create`: `{ ...rest, campo: new Date(campo) }` (si es opcional, usa el spread condicional). En `update`, siempre condicional: `...(campo !== undefined && { campo: new Date(campo) })`. Si ya hay otro campo fecha desestructurado, agrégalo a la misma desestructuración. |
| `active Boolean` (el modelo no lo tenía) | `findAll` pasa de `.all()` a `.where({ active: true }).all()`. `findOne`, `update` y `remove` no filtran. |

Mantén las reglas del resto del service: todo dentro del `try`, errores por `handleError`, `await` en cada promesa (lint trata `no-floating-promises` como error), nunca `db.close()`. Si el service no tiene `handleError` ni `try/catch` (patrón viejo, como `src/user/user.service.ts`), sigue el estilo que ya tiene para el cambio mínimo y menciónalo en el reporte; no lo refactorices.

### 6. Controller

Los tipos del DTO fluyen solos, así que **casi nunca cambia**. Solo:

- si se agregó `active`: el JSDoc de `findAll` pasa a `/** Lista los <modelos> activos. */` y el de `findOne` a `/** Obtiene un <modelo> por id (incluidos los inactivos). */` (el plugin de Swagger los usa como `summary`);
- si una propiedad nueva cambia lo que hace un endpoint (p. ej. un filtro nuevo que pidió el usuario), ajusta su JSDoc.

No agregues endpoints, query params ni `@ApiProperty`: el plugin CLI de `@nestjs/swagger` genera el esquema desde el DTO.

### 7. Tests

En `<kebab>.service.spec.ts`:
- agrega la propiedad nueva a los fixtures (el objeto del modelo y los DTOs de `create`/`update`) cuando sea requerida, o cuando el caso la ejercite;
- `@unique`: casos `create` con duplicado → `ConflictException` y `update` con el valor de otro registro → `ConflictException`; `update` con su propio valor no falla;
- FK: mock del modelo referenciado en `vi.hoisted` y en `vi.mock('../prisma/db.js', ...)` si no estaba; casos `create`/`update` con FK inexistente → `BadRequestException`;
- `DateTime`: verifica que `create`/`update` reciben un `Date` (`expect.any(Date)` o la fecha exacta);
- `active` nuevo: `findAll` llama a `where({ active: true })` antes de `all()`.

En `<kebab>.controller.spec.ts` solo cambia algo si un fixture deja de compilar con el DTO nuevo.

### 8. Verificar

En este orden:

1. Si `src/prisma/contract.json` / `contract.d.ts` no reflejan el campo (búscalo con `grep`), ejecuta `npm run contract:emit`. Sin esto los tipos de `db.orm.public.<Model>` no conocen la propiedad.
2. `npx vitest run src/<kebab>/`
3. `npm run lint`
4. `npm run build` (comprueba tipos)
5. `npm run format` y revisa que solo haya tocado los archivos de esta tarea.

Si algo falla, corrígelo antes de reportar; si no puedes, repórtalo con la salida.

### 9. Documentación

Si el recurso tiene spec (columna `Spec` de `docs/specs/00-roadmap.md`, p. ej. `docs/specs/06-resource-client.md`), actualiza en ese spec la sección del DTO y, si cambió, la del service, para que el spec no quede desactualizado. No cambies el estado del roadmap.

### 10. Reportar

En pocas líneas, por modelo:
- propiedades agregadas y los archivos tocados;
- qué se hizo en el service por cada una (o "sin cambios" si era escalar simple);
- resultado de tests, lint y build;
- discrepancias encontradas y no corregidas (paso 3);
- **Modelos que dependen**: si la propiedad nueva es un FK hacia otro modelo, o se agregó una lista inversa, recuerda que `remove` del modelo referenciado puede fallar por la restricción de FK;
- **Pendiente:** la migración de base de datos (`migrations/app/`) no la genera esta skill; recuérdalo si el contract cambió y no hay una migración nueva para esos campos (`npx prisma migration status`). Commitear `contract.prisma`, `contract.json` y `contract.d.ts` juntos.
