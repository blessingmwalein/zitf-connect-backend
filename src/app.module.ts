import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { SupabaseModule } from './supabase/supabase.module.js';
import { TicketTypesModule } from './ticket-types/ticket-types.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { TrackingModule } from './tracking/tracking.module.js';
import configuration from './config/configuration.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    SupabaseModule,
    TicketTypesModule,
    PaymentsModule,
    OrdersModule,
    TrackingModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
