import { Controller, Post, Get, Param, Body, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { OrdersService } from './orders.service.js';
import { CreateOrderDto } from './dto/create-order.dto.js';

@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  createOrder(@Body() dto: CreateOrderDto) {
    return this.ordersService.createOrder(dto);
  }

  @Get()
  getAllOrders(
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '20',
    @Query('status') status?: string,
  ) {
    return this.ordersService.getAllOrders(
      parseInt(page) || 1,
      parseInt(pageSize) || 20,
      status,
    );
  }

  @Get(':id')
  getOrder(@Param('id') id: string) {
    return this.ordersService.getOrder(id);
  }

  @Get('user/:userId')
  getByUser(@Param('userId') userId: string) {
    return this.ordersService.getOrdersByUser(userId);
  }

  @Get('email/:email')
  getByEmail(@Param('email') email: string) {
    return this.ordersService.getOrdersByEmail(email);
  }

  @Post(':id/generate-tickets')
  generateTickets(@Param('id') id: string) {
    return this.ordersService.generateTickets(id);
  }

  @Get('tickets/:ticketId')
  getTicket(@Param('ticketId') ticketId: string) {
    return this.ordersService.getTicketPdf(ticketId);
  }

  @Get('tickets/:ticketId/download')
  async downloadTicketPdf(
    @Param('ticketId') ticketId: string,
    @Res() res: any,
  ) {
    const pdfBuffer = await this.ordersService.generateTicketPdfBuffer(ticketId);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="zitf-ticket-${ticketId.substring(0, 8)}.pdf"`,
      'Content-Length': pdfBuffer.length,
    });
    res.end(pdfBuffer);
  }

  @Post('tickets/:ticketId/validate')
  validateTicket(@Param('ticketId') ticketId: string) {
    return this.ordersService.validateTicket(ticketId);
  }
}
