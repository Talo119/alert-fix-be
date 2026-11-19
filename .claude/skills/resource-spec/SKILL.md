---
name: resource-spec
description: Genera el spec de implementación del CRUD de un modelo de src/prisma/contract.prisma (docs/specs/NN-resource-<kebab>.md) y actualiza el roadmap de modelos en docs/specs/00-roadmap.md. Úsala cuando pidan "spec para el recurso X", "nuevo recurso de un modelo", "siguiente modelo del roadmap" o ver qué modelos faltan por implementar.
argument-hint: <Modelo>
---

# resource-spec

Escribe el spec para implementar el recurso CRUD de **un** modelo del contract y lleva el control en el roadmap.

**Esta skill solo escribe documentación.** Crea o edita únicamente `docs/specs/NN-resource-<kebab>.md` y `docs/specs/00-roadmap.md`. No ejecuta `nest g resource` ni toca `src/`: eso lo hace quien implementa el spec. Todo spec de recurso debe incluir el paso de **actualizar la documentación Swagger** (ver *Swagger (OpenAPI)*), para que cada recurso nuevo quede documentado en `/docs` al implementarse.

Argumento: `$ARGUMENTS` (nombre del modelo).

## Flujo

### 1. Resolver el modelo

- Lee `src/prisma/contract.prisma` y extrae todos los bloques `model <Nombre> { ... }`.
- Normaliza `$ARGUMENTS` (quita guiones, guiones bajos y espacios; minúsculas) y compáralo igual con cada nombre de modelo. `order-header`, `orderheader` y `OrderHeader` resuelven a `OrderHeader`.
- **Sin argumento:** muestra la tabla del roadmap y sugiere el primer modelo `Pendiente` cuyas dependencias estén en `Implementado`. Detente.
- **No existe:** lista los modelos válidos y detente sin crear archivos.

### 2. Sincronizar el roadmap

- Si falta `docs/specs/00-roadmap.md`, créalo con todos los modelos del contract en `Pendiente`, en orden de dependencias (primero los que no tienen FK). Usa el formato de la sección *Formato del roadmap*.
- Si el contract tiene modelos que no están en el roadmap, añádelos como `Pendiente`, después de sus dependencias.
- Si el modelo pedido ya está en `Spec lista` o `Implementado`, pregunta antes de seguir: sobrescribir el spec existente o cancelar.

### 3. Reunir el contexto

- **El modelo en el contract:** cada campo con su tipo, `?`, `@unique`, `@default`, `@onCreate`, `temporal.UpdatedAt`, las relaciones (`@relation(fields: [xId], references: [id])`) y las listas inversas (`users User[]`).
- **Dependencias:** cada modelo al que apunta un FK, con su estado en el roadmap.
- **Modelos que dependen de este:** los que tienen un FK hacia él. Sirve para la nota sobre borrado en *Notas*.
- **¿Tiene campo `active`?** Si el modelo declara `active Boolean`, `findAll` debe filtrar por `active: true` (ver *Service*).
- **Referencia:** `src/company/` y `src/user/` (module, controller, service, dto). Son la base de estructura, con las correcciones de *Reglas del spec*.
- **Swagger:** lee `src/swagger.ts` (los `.addTag(...)` actuales) y `docs/specs/05-openapi-swagger.md` (*Reglas para recursos nuevos*).
- **¿Ya existe `src/<kebab>/`?** Léelo completo. Si existe (p. ej. `src/reminder/`), el spec **no** debe pedir `nest g resource`: debe pedir completar los métodos stub y conservar el resto (cron, cola, sender, etc.). Indícalo en *Contexto* y en el paso 1.

### 4. Numerar

`NN` = el mayor prefijo numérico de `docs/specs/*.md` + 1, con dos dígitos. `00-roadmap.md` cuenta, pero nunca es el máximo si hay otros. El archivo se llama `docs/specs/NN-resource-<kebab>.md`. Si sobrescribes un spec existente, conserva su número.

### 5. Escribir el spec

Rellena `spec-template.md` (en este directorio) en español, con el estilo de los specs existentes (`docs/specs/03-reminders-whatsapp.md`). Sustituye todos los `<...>` y borra los bloques que no apliquen. Sigue las *Reglas del spec*.

### 6. Actualizar el roadmap

En la fila del modelo: `Estado` → `Spec lista` y `Spec` → `[NN](./NN-resource-<kebab>.md)`. Actualiza la línea `Última actualización` con la fecha de hoy.

### 7. Reportar

En pocas líneas:
- la ruta del spec;
- las dependencias que aún no están `Implementado` (como advertencia: implementar antes, o asumir que los FK pueden ser `null`);
- el siguiente modelo sugerido del roadmap.

## Nombres

- **Recurso:** el nombre del modelo en kebab-case singular: `Company` → `company`, `OrderHeader` → `order-header`, `OrderEntry` → `order-entry`.
- **Clases:** `<Model>Module`, `<Model>Controller`, `<Model>Service`, `Create<Model>Dto`, `Update<Model>Dto`.
- **Ruta:** `@Controller('<kebab>')`, el valor por defecto del scaffold.
- **Acceso a datos:** `db.orm.public.<Model>`, con `db` importado desde `../prisma/db.js`.
- **El modelo `Service`** genera `ServiceService` y `ServiceController`. Es válido; menciónalo en *Notas* para que nadie lo "corrija" a mano.

## Reglas del spec

### DTO de creación (class-validator)

**Se excluyen** del DTO:
- `id`, porque `@onCreate(uuid())` lo genera;
- `createdAt` y `updatedAt`, porque los generan `@onCreate(now())` y `temporal.UpdatedAt`;
- los campos de relación: el objeto (`company Company?`) y las listas (`users User[]`). Solo entra el FK escalar (`companyId`).

**Mapeo** contract → decoradores:

| Contract | Decoradores |
|---|---|
| `String` | `@IsString() @IsNotEmpty()` |
| `String?` | `@IsOptional() @IsString()` |
| campo llamado `email` | `@IsEmail()` (más `@IsNotEmpty()` o `@IsOptional()` según `?`) |
| FK `xxxId String?` | `@IsOptional() @IsUUID()` |
| FK `xxxId String` | `@IsUUID() @IsNotEmpty()` |
| `DateTime` / `DateTime?` | `@IsDateString()` (y `@IsOptional()` si `?`); el service lo convierte con `new Date(...)` |
| `Int` | `@IsInt()`; añade `@Min(1)` en cantidades (`quantity`) |
| `Boolean @default(...)` | `@IsOptional() @IsBoolean()` |
| `status String` | `@IsString() @IsNotEmpty()`, con la nota de que aún no hay enum (valores libres) |

Las propiedades opcionales se declaran con `?` (`phoneNumber?: string`).

**`Update<Model>Dto`:** `PartialType(Create<Model>Dto)` importado de **`@nestjs/swagger`** (no de `@nestjs/mapped-types`), para que el esquema OpenAPI herede las propiedades.

No se crean DTOs adicionales: `src/user/dto/user-item.dto.ts` es un duplicado y no se replica.

### Service

Toma de base `src/user/user.service.ts`:
- un `Logger` con el nombre de la clase;
- los métodos `create`, `findAll`, `findOne`, `update` y `remove`;
- las queries `create(...)`, `all()`, `whereUnique({ id }).first()`, `whereUnique({ id }).update(...)` y `where({ id }).delete()`.

El spec **debe** pedir estas correcciones al patrón de user:

1. **Nunca llamar a `db.close()`.** `db` es una instancia compartida del módulo: cerrarla rompe las peticiones siguientes.
2. **404 solo cuando no existe:**
   - `findOne` lanza `NotFoundException(\`<Model> <id> not found\`)` si `first()` devuelve `null`;
   - `update` y `remove` llaman primero a `this.findOne(id)`, así el 404 sale de un solo lugar.
3. **No envolver las `HttpException`.** En el `catch`, si `error instanceof HttpException`, se relanza tal cual.
4. **Otros errores:** se loguean (`error instanceof Error ? error.message : String(error)`) y se lanza `InternalServerErrorException`.
5. **FK inexistente:** si el DTO trae un FK, verificar en `create`/`update` que el registro exista (`db.orm.public.<Ref>.whereUnique({ id }).first()`). Si no existe, `BadRequestException(\`<Ref> <id> does not exist\`)`. Si el modelo tiene más de un FK, sácalo a un helper privado.
6. **`@unique`** (p. ej. `email`, `name`): un duplicado responde `409 ConflictException`. Comprueba antes con `where({ campo }).first()`.
7. **Fechas:** convertir los strings de `DateTime` con `new Date(...)` antes de `create`/`update`.
8. **`await` en todas las promesas.** Lint trata `typescript/no-floating-promises` como error.
9. **`findAll` y el campo `active`:** si el modelo tiene `active Boolean`, `findAll` devuelve solo los registros activos: `db.orm.public.<Model>.where({ active: true }).all()`. Si no lo tiene, `db.orm.public.<Model>.all()`. `findOne`, `update` y `remove` no filtran por `active` (un registro inactivo sigue siendo accesible por id, p. ej. para reactivarlo con `PATCH { "active": true }`); el spec lo indica en *Notas*.

### Swagger (OpenAPI)

Swagger ya está configurado (`src/swagger.ts`, spec 05) y el plugin CLI de `@nestjs/swagger` genera los esquemas desde los DTOs y class-validator, sin `@ApiProperty` manuales. Cada spec de recurso **debe** pedir:

1. `@ApiTags('<kebab>')` (de `@nestjs/swagger`) en el controller, encima de `@Controller('<kebab>')`.
2. Añadir `.addTag('<kebab>')` al `DocumentBuilder` de `setupSwagger` en `src/swagger.ts`, junto a los tags existentes.
3. `PartialType` (y `PickType` / `OmitType` / `IntersectionType` si se usan) desde `@nestjs/swagger`.
4. Mantener los sufijos `.dto.ts` y `.controller.ts`; el plugin no procesa otros nombres.
5. Un comentario JSDoc de una línea sobre cada método del controller (p. ej. `/** Lista los <modelos> activos. */`), que el plugin convierte en el `summary` de la operación.
6. Añadir el recurso a la lista de recursos documentados en `docs/specs/05-openapi-swagger.md` (*Contexto* e *Implementación*: tags).
7. Verificar con `npm run start:dev` que `/docs` muestra el tag y que `curl localhost:3000/docs-json` incluye las rutas `/<kebab>` y `/<kebab>/{id}`.

### Controller

Usa el controller del scaffold, con `@Param('id', ParseUUIDPipe) id: string` en `findOne`, `update` y `remove`. El `id` es un UUID string: nunca `+id`. Lleva `@ApiTags('<kebab>')` y JSDoc por método (ver *Swagger (OpenAPI)*); `src/company/company.controller.ts` es la referencia.

### Entity

Deja la clase vacía que genera el scaffold (`export class <Model> {}`), como en `src/user/entities/user.entity.ts`.

### Module

Usa el del scaffold. `nest g resource` lo registra en `AppModule`; el spec pide comprobarlo.

### Tests (Vitest)

**Service:**
- mock del módulo de base de datos con `vi.mock('../prisma/db.js', () => ({ db: { orm: { public: { <Model>: { ... } } } } }))`, con `vi.fn()` encadenables;
- casos: `create` ok, `create` con FK inexistente → 400, `create` con duplicado `@unique` → 409 (si aplica), `findAll` (si el modelo tiene `active`: verificar que llama a `where({ active: true })` antes de `all()`), `findOne` existe, `findOne` no existe → 404, `update` ok, `update` de un id inexistente → 404, `remove` ok, `remove` de un id inexistente → 404.

**Controller:** el service se sustituye por un objeto de `vi.fn()` con `{ provide: <Model>Service, useValue: ... }`. Se verifica que cada endpoint delega con los argumentos correctos.

### Otras notas que el spec debe incluir

- **Validación:** `src/main.ts` ya tiene un `ValidationPipe` global con `whitelist` y `forbidNonWhitelisted`, así que un campo que no esté en el DTO responde 400.
- **`active`:** si el modelo lo tiene, `findAll` solo lista los activos; `findOne`/`update`/`remove` siguen viendo los inactivos.
- **Modelos que dependen de este** (tienen un FK hacia él): avisar que `remove` puede fallar por la restricción de FK, y que borrado lógico (`active = false`) o cascada queda fuera de alcance, salvo que el modelo ya tenga `active`. En ese caso, mencionarlo como alternativa futura.

## Formato del roadmap

`docs/specs/00-roadmap.md`:

```md
# Roadmap de recursos

> Control de los modelos de `src/prisma/contract.prisma` y su recurso CRUD.
> Generar el spec de un modelo: `/resource-spec <Modelo>`.
> Última actualización: YYYY-MM-DD

| # | Modelo | Recurso | Depende de | Estado | Spec |
|---|---|---|---|---|---|
| 1 | Company | `company` | — | Pendiente | — |

## Estados

- **Pendiente**: sin spec.
- **Spec lista**: spec escrito (lo marca `/resource-spec`), falta implementar.
- **Parcial**: existe código, pero el CRUD no está completo.
- **Implementado**: CRUD completo con tests. Lo marca quien implementa el spec, en el último paso.

## Pendientes transversales

- ...
```

Al actualizar el roadmap, no borres las notas que haya entre paréntesis en `Estado`, ni las entradas de *Pendientes transversales*.
