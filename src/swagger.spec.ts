import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { isSwaggerEnabled, setupSwagger } from './swagger.js';

@Controller('ping')
class PingController {
  @Get()
  ping() {
    return 'pong';
  }
}

async function createApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [PingController],
  }).compile();
  const app = moduleRef.createNestApplication();
  setupSwagger(app);
  await app.init();
  return app;
}

describe('swagger', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    vi.unstubAllEnvs();
    await app?.close();
    app = undefined;
  });

  describe('isSwaggerEnabled', () => {
    it('is enabled outside production', () => {
      expect(isSwaggerEnabled({ NODE_ENV: 'development' })).toBe(true);
      expect(isSwaggerEnabled({})).toBe(true);
    });

    it('is disabled in production unless SWAGGER_ENABLED=true', () => {
      expect(isSwaggerEnabled({ NODE_ENV: 'production' })).toBe(false);
      expect(
        isSwaggerEnabled({ NODE_ENV: 'production', SWAGGER_ENABLED: 'true' }),
      ).toBe(true);
    });
  });

  it('serves the OpenAPI document at /docs-json outside production', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    app = await createApp();

    const res = await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200);

    expect(res.body.info.title).toBe('AlertFix API');
    expect(res.body.paths).toHaveProperty('/ping');
  });

  it('does not mount /docs-json in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SWAGGER_ENABLED', '');
    app = await createApp();

    await request(app.getHttpServer()).get('/docs-json').expect(404);
  });
});
