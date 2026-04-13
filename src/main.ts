import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { AppModule } from './app.module.js';

const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'https://zitf-connect-admin.vercel.app',
];

function getAllowedOrigins(): string[] {
  const fromEnv = process.env.CORS_ALLOWED_ORIGINS
    ?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_ALLOWED_ORIGINS;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const allowedOrigins = getAllowedOrigins();

  app.enableCors({
    origin: allowedOrigins,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  // Socket.IO adapter for WebSocket support
  app.useWebSocketAdapter(new IoAdapter(app));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.setGlobalPrefix('api');

  // Swagger
  const config = new DocumentBuilder()
    .setTitle('ZITF Connect API')
    .setDescription('Backend API for the Zimbabwe International Trade Fair — billing, ticketing, and real-time tracking')
    .setVersion('1.1')
    .addBearerAuth()
    .addTag('ticket-types', 'Manage ticket types and pricing')
    .addTag('orders', 'Order creation, ticket generation, and validation')
    .addTag('payments', 'Paynow payment integration (web + mobile money)')
    .addTag('tracking', 'Real-time location tracking, heatmaps, and zone analytics')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`ZITF Backend running on port ${port}`);
  console.log(`CORS allowed origins: ${allowedOrigins.join(', ')}`);
  console.log(`Swagger docs available at http://localhost:${port}/docs`);
  console.log(`WebSocket tracking available at ws://localhost:${port}/tracking`);
}
bootstrap();
