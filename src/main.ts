import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

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
    .setDescription('Backend API for the Zimbabwe International Trade Fair billing and ticketing system')
    .setVersion('1.0')
    .addTag('ticket-types', 'Manage ticket types and pricing')
    .addTag('orders', 'Order creation, ticket generation, and validation')
    .addTag('payments', 'Paynow payment integration (web + mobile money)')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  await app.listen(process.env.PORT ?? 3000);
  console.log(`ZITF Backend running on port ${process.env.PORT ?? 3000}`);
  console.log(`Swagger docs available at http://localhost:${process.env.PORT ?? 3000}/docs`);
}
bootstrap();
