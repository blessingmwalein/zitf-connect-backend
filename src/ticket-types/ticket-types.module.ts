import { Module } from '@nestjs/common';
import { TicketTypesController } from './ticket-types.controller.js';
import { TicketTypesService } from './ticket-types.service.js';

@Module({
  controllers: [TicketTypesController],
  providers: [TicketTypesService],
  exports: [TicketTypesService],
})
export class TicketTypesModule {}
