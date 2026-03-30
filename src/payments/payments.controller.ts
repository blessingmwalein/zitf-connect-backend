import { Controller, Post, Get, Param, Body, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PaymentsService } from './payments.service.js';
import { InitiatePaymentDto, InitiateStandPaymentDto } from './dto/initiate-payment.dto.js';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('initiate')
  initiateTicketPayment(@Body() dto: InitiatePaymentDto) {
    return this.paymentsService.initiateTicketPayment(dto);
  }

  @Post('initiate-stand')
  initiateStandPayment(@Body() dto: InitiateStandPaymentDto) {
    return this.paymentsService.initiateStandPayment(dto);
  }

  @Get('poll/:paymentId')
  pollStatus(@Param('paymentId') paymentId: string) {
    return this.paymentsService.pollPaymentStatus(paymentId);
  }

  @Post('webhook')
  handleWebhook(@Body() body: any) {
    return this.paymentsService.handleWebhook(body);
  }

  @Get('order/:orderId')
  getByOrder(@Param('orderId') orderId: string) {
    return this.paymentsService.getPaymentsByOrder(orderId);
  }

  @Get()
  getAll(
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '20',
    @Query('status') status?: string,
  ) {
    return this.paymentsService.getAllPayments(
      parseInt(page) || 1,
      parseInt(pageSize) || 20,
      status,
    );
  }

  @Get('return')
  paymentReturn(@Query() query: any) {
    return {
      message: 'Payment processing complete',
      reference: query.merchantReference || null,
      gateway: query.gateway || 'paynow',
    };
  }
}
