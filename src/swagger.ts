import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export const SWAGGER_PATH = 'docs';

/**
 * Swagger UI se sirve fuera de producción. En producción solo se monta si
 * SWAGGER_ENABLED=true.
 */
export function isSwaggerEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.NODE_ENV !== 'production' || env.SWAGGER_ENABLED === 'true';
}

/**
 * Monta Swagger UI en /docs, el JSON en /docs-json y el YAML en /docs-yaml.
 */
export function setupSwagger(app: INestApplication): void {
  if (!isSwaggerEnabled()) return;

  const config = new DocumentBuilder()
    .setTitle('AlertFix API')
    .setDescription(
      'Clientes, órdenes de mantenimiento y recordatorios por WhatsApp.',
    )
    .setVersion(process.env.npm_package_version ?? '1.0')
    .addTag('company')
    .addTag('client')
    .addTag('user')
    .addTag('reminder')
    .build();

  // Factory: el documento se genera en el primer request, no al arrancar.
  SwaggerModule.setup(SWAGGER_PATH, app, () =>
    SwaggerModule.createDocument(app, config),
  );
}
