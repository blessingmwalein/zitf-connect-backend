import { Controller, Get, Post, Put, Delete, Param, Body, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { TicketTypesService } from './ticket-types.service.js';
import { CreateTicketTypeDto } from './dto/create-ticket-type.dto.js';
import { UpdateTicketTypeDto } from './dto/update-ticket-type.dto.js';

@ApiTags('ticket-types')
@Controller('ticket-types')
export class TicketTypesController {
  constructor(private readonly ticketTypesService: TicketTypesService) {}

  @Get()
  findAll(@Query('active_only') activeOnly?: string) {
    return this.ticketTypesService.findAll(activeOnly === 'true');
  }

  @Get('available')
  getAvailable() {
    return this.ticketTypesService.getAvailable();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.ticketTypesService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateTicketTypeDto) {
    return this.ticketTypesService.create(dto);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTicketTypeDto) {
    return this.ticketTypesService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.ticketTypesService.remove(id);
  }
}
