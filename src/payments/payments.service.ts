import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service.js';
import { InitiatePaymentDto, InitiateStandPaymentDto, PaymentMethod } from './dto/initiate-payment.dto.js';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private paynow: any;

  constructor(
    private configService: ConfigService,
    private supabase: SupabaseService,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Paynow } = require('paynow');
    const integrationId = this.configService.get<string>('paynow.integrationId');
    const integrationKey = this.configService.get<string>('paynow.integrationKey');

    this.paynow = new Paynow(integrationId, integrationKey);
    this.paynow.resultUrl = this.configService.get<string>('paynow.resultUrl');
    this.paynow.returnUrl = this.configService.get<string>('paynow.returnUrl');
  }

  async initiateTicketPayment(dto: InitiatePaymentDto) {
    const { data: order, error: orderError } = await this.supabase.getClient()
      .from('orders')
      .select('*, order_items(*, ticket_types(name))')
      .eq('id', dto.order_id)
      .single();

    if (orderError || !order) throw new NotFoundException('Order not found');
    if (order.status === 'paid') throw new BadRequestException('Order is already paid');

    const payment = this.paynow.createPayment(
      `ZITF-${order.order_number}`,
      // order.user_email || 'bmwale2000000@gmail.com',
      'bmwale2000000@gmail.com',
    );

    for (const item of order.order_items) {
      const name = item.ticket_types?.name || `Ticket #${item.ticket_type_id}`;
      payment.add(name, item.subtotal);
    }

    return this.processPayment(payment, dto, order.id, order.total_amount, 'ticket');
  }

  async initiateStandPayment(dto: InitiateStandPaymentDto) {

    const payment = this.paynow.createPayment(
      `ZITF-STAND-${dto.stand_id.substring(0, 8)}`,
      // dto.user_email || 'bmwale2000000@gmail.com',
      'bmwale2000000@gmail.com',
    );

    payment.add('Stand Application Fee', dto.amount);

    const { data: paymentRecord, error } = await this.supabase.getAdminClient()
      .from('payments')
      .insert({
        order_id: null,
        paynow_reference: null,
        poll_url: null,
        redirect_url: null,
        amount: dto.amount,
        currency: 'USD',
        payment_method: dto.payment_method,
        status: 'pending',
        phone_number: dto.phone_number || null,
        payment_type: 'stand_application',
        metadata: {
          exhibitor_id: dto.exhibitor_id,
          stand_id: dto.stand_id,
          feature_ids: dto.feature_ids || [],
        },
      })
      .select()
      .single();


     console.log('Payment record created:', paymentRecord);
     console.log('Paynow record created:', payment);
    if (error) {
      console.error('Error creating payment record:', error);
      throw new BadRequestException(error.message)
    };

    return this.processPaymentRequest(payment, dto.payment_method, dto.phone_number, paymentRecord.id);
  }

  private async processPayment(
    payment: any,
    dto: InitiatePaymentDto,
    orderId: string,
    amount: number,
    paymentType: string,
  ) {
    const { data: paymentRecord, error } = await this.supabase.getAdminClient()
      .from('payments')
      .insert({
        order_id: orderId,
        paynow_reference: null,
        poll_url: null,
        redirect_url: null,
        amount,
        currency: 'USD',
        payment_method: dto.payment_method,
        status: 'pending',
        phone_number: dto.phone_number || null,
        payment_type: paymentType,
      })
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);

    return this.processPaymentRequest(payment, dto.payment_method, dto.phone_number, paymentRecord.id);
  }

  private async processPaymentRequest(
    payment: any,
    method: PaymentMethod,
    phoneNumber: string | undefined,
    paymentId: string,
  ) {
    try {
      let response: any;

      if (method === PaymentMethod.WEB) {
        response = await this.paynow.send(payment);
      } else {
        if (!phoneNumber) throw new BadRequestException('Phone number is required for mobile payments');
        response = await this.paynow.sendMobile(payment, phoneNumber, method);
      }

      if (response.success) {
        const updateData: any = {
          poll_url: response.pollUrl,
          paynow_reference: response.pollUrl,
        };
        if (method === PaymentMethod.WEB) updateData.redirect_url = response.redirectUrl;
        if (response.instructions) updateData.instructions = response.instructions;

        await this.supabase.getAdminClient()
          .from('payments')
          .update(updateData)
          .eq('id', paymentId);

        return {
          success: true,
          payment_id: paymentId,
          redirect_url: response.redirectUrl || null,
          poll_url: response.pollUrl,
          instructions: response.instructions || null,
        };
      } else {
        await this.supabase.getAdminClient()
          .from('payments')
          .update({ status: 'failed' })
          .eq('id', paymentId);

        throw new BadRequestException(response.error || 'Payment initiation failed');
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error('Payment processing error:', err);
      throw new BadRequestException('Payment processing failed. Please try again.');
    }
  }

  async pollPaymentStatus(paymentId: string) {
    const { data: payment, error } = await this.supabase.getAdminClient()
      .from('payments')
      .select('*')
      .eq('id', paymentId)
      .single();

    if (error || !payment) throw new NotFoundException('Payment not found');
    if (!payment.poll_url) throw new BadRequestException('Payment has no poll URL');
    if (payment.status === 'paid') return { status: 'paid', payment };

    try {
      const status = await this.paynow.pollTransaction(payment.poll_url);

      if (status.status?.toString().toLowerCase() === 'paid') {
        await this.supabase.getAdminClient()
          .from('payments')
          .update({
            status: 'paid',
            paid_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', paymentId);

        if (payment.order_id) {
          await this.markOrderPaid(payment.order_id);
        }

        if (payment.payment_type === 'stand_application' && payment.metadata) {
          await this.handleStandPaymentSuccess(payment.metadata);
        }

        return { status: 'paid', payment: { ...payment, status: 'paid' } };
      }

      return { status: payment.status, payment };
    } catch (err) {
      this.logger.error('Poll error:', err);
      return { status: payment.status, payment };
    }
  }

  private async markOrderPaid(orderId: string) {
    await this.supabase.getAdminClient()
      .from('orders')
      .update({ status: 'paid', updated_at: new Date().toISOString() })
      .eq('id', orderId);
  }

  private async handleStandPaymentSuccess(metadata: any) {
    if (metadata.stand_id) {
      await this.supabase.getAdminClient()
        .from('stands')
        .update({ status: 'booked', exhibitor_id: metadata.exhibitor_id })
        .eq('id', metadata.stand_id);
    }
  }

  async handleWebhook(body: any) {
    this.logger.log('Paynow webhook received:', JSON.stringify(body));

    const pollUrl = body.pollurl || body.PollUrl;
    if (!pollUrl) return { received: true };

    const { data: payment } = await this.supabase.getClient()
      .from('payments')
      .select('*')
      .eq('poll_url', pollUrl)
      .single();

    if (payment) {
      await this.pollPaymentStatus(payment.id);
    }

    return { received: true };
  }

  async getPaymentsByOrder(orderId: string) {
    const { data, error } = await this.supabase.getClient()
      .from('payments')
      .select('*')
      .eq('order_id', orderId)
      .order('created_at', { ascending: false });

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async getAllPayments(page = 1, pageSize = 20, status?: string) {
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = this.supabase.getClient()
      .from('payments')
      .select('*, orders(order_number, user_email, user_type)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error, count } = await query;
    if (error) throw new BadRequestException(error.message);
    return { data, total: count, page, pageSize };
  }
}
