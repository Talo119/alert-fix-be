# Spec 05 — Documentación OpenAPI / Swagger

> Roadmap: [00 — Roadmap de recursos](./00-roadmap.md)

## Contexto

La API REST (`company`, `client`, `service`, `order-header`, `order-entry`, `user`, `reminder`) no tenía documentación navegable. Se añade `@nestjs/swagger`, el paquete oficial de Nest, para servir Swagger UI y el documento OpenAPI generados a partir de los controladores y DTOs.

## Decisiones

- **Exposición:** solo fuera de producción. Con `NODE_ENV=production` no se monta, salvo que `SWAGGER_ENABLED=true`. La lógica está en `isSwaggerEnabled()` (`src/swagger.ts`).
- **Esquemas:** se generan con el plugin CLI de `@nestjs/swagger` (`nest-cli.json`, `classValidatorShim` + `introspectComments`). Este infiere propiedades, tipos, `required` y formatos (p. ej. `@IsUUID()` → `format: uuid`) desde TypeScript y class-validator, así que no hacen falta `@ApiProperty` manuales.
- **Generación perezosa:** `SwaggerModule.setup` recibe una factory, de modo que el documento se construye en el primer request.

## Rutas

| Ruta | Contenido |
|---|---|
| `/docs` | Swagger UI |
| `/docs-json` | Documento OpenAPI en JSON |
| `/docs-yaml` | Documento OpenAPI en YAML |

## Implementación

- `src/swagger.ts`: `setupSwagger(app)` (`DocumentBuilder` con título `AlertFix API`, tags `company`, `client`, `service`, `order-header`, `order-entry`, `user`, `reminder`) e `isSwaggerEnabled(env)`.
- `src/main.ts`: llama a `setupSwagger(app)` después de los pipes globales y antes de `listen`.
- Controladores: `@ApiTags('<recurso>')`. `AppController` lleva `@ApiExcludeController()`.
- DTOs de update: `PartialType` importado de `@nestjs/swagger`, no de `@nestjs/mapped-types`, para que el esquema herede las propiedades.
- Test: `src/swagger.spec.ts`.

## Reglas para recursos nuevos

1. `@ApiTags('<recurso>')` en el controlador y `.addTag('<recurso>')` en `src/swagger.ts`.
2. `PartialType` / `PickType` / `OmitType` / `IntersectionType` desde `@nestjs/swagger`.
3. Los DTOs deben terminar en `.dto.ts` o `.entity.ts`, y los controladores en `.controller.ts`; si no, el plugin no los procesa.
4. Opcional: un comentario JSDoc sobre cada método del controlador se convierte en el `summary` de la operación.

## Limitaciones

- El plugin actúa en `nest build` / `nest start`, pero no en Vitest. Los tests unitarios ven los DTOs sin metadatos OpenAPI. No afecta a la validación.
- Después de cambiar las opciones del plugin hay que borrar `dist/`.
- Las respuestas aún no están tipadas (`@ApiOkResponse`, etc.), así que la UI muestra los cuerpos de petición, pero no los de respuesta.
