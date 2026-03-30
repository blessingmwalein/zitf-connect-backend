import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service.js';
import { TicketTypesService } from '../ticket-types/ticket-types.service.js';
import { CreateOrderDto } from './dto/create-order.dto.js';
import { v4 as uuidv4 } from 'uuid';
import * as QRCode from 'qrcode';

@Injectable()
export class OrdersService {
  constructor(
    private supabase: SupabaseService,
    private ticketTypesService: TicketTypesService,
  ) {}

  async createOrder(dto: CreateOrderDto) {
    const orderNumber = `ZITF-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    let totalAmount = 0;
    const itemsWithPrice: Array<{
      ticket_type_id: string;
      quantity: number;
      unit_price: number;
      subtotal: number;
    }> = [];

    for (const item of dto.items) {
      const ticketType = await this.ticketTypesService.findOne(item.ticket_type_id);

      if (!ticketType.is_active) {
        throw new BadRequestException(`Ticket type "${ticketType.name}" is not available`);
      }
      if (ticketType.max_quantity !== null && ticketType.sold_count + item.quantity > ticketType.max_quantity) {
        throw new BadRequestException(`Not enough tickets available for "${ticketType.name}"`);
      }

      const subtotal = ticketType.price * item.quantity;
      totalAmount += subtotal;

      itemsWithPrice.push({
        ticket_type_id: item.ticket_type_id,
        quantity: item.quantity,
        unit_price: ticketType.price,
        subtotal,
      });
    }

    const { data: order, error: orderError } = await this.supabase.getAdminClient()
      .from('orders')
      .insert({
        order_number: orderNumber,
        user_id: dto.user_id || null,
        user_email: dto.user_email,
        user_type: dto.user_type,
        total_amount: totalAmount,
        currency: 'USD',
        status: 'pending',
      })
      .select()
      .single();

    if (orderError) throw new BadRequestException(orderError.message);

    const orderItemsData = itemsWithPrice.map(item => ({
      order_id: order.id,
      ...item,
    }));

    const { error: itemsError } = await this.supabase.getAdminClient()
      .from('order_items')
      .insert(orderItemsData);

    if (itemsError) throw new BadRequestException(itemsError.message);

    const { data: fullOrder } = await this.supabase.getClient()
      .from('orders')
      .select('*, order_items(*, ticket_types(name, description, ticket_category))')
      .eq('id', order.id)
      .single();

    return fullOrder;
  }

  async getOrder(id: string) {
    const { data, error } = await this.supabase.getClient()
      .from('orders')
      .select('*, order_items(*, ticket_types(name, description, ticket_category)), payments(*)')
      .eq('id', id)
      .single();

    if (error || !data) throw new NotFoundException('Order not found');
    return data;
  }

  async getOrdersByUser(userId: string) {
    const { data, error } = await this.supabase.getClient()
      .from('orders')
      .select('*, order_items(*, ticket_types(name)), payments(status, payment_method)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async getOrdersByEmail(email: string) {
    const { data, error } = await this.supabase.getClient()
      .from('orders')
      .select('*, order_items(*, ticket_types(name)), payments(status, payment_method)')
      .eq('user_email', email)
      .order('created_at', { ascending: false });

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async generateTickets(orderId: string) {
    const order = await this.getOrder(orderId);

    if (order.status !== 'paid') {
      throw new ForbiddenException('Payment must be completed before tickets can be generated');
    }

    const { data: existingTickets } = await this.supabase.getClient()
      .from('tickets')
      .select('id')
      .eq('order_id', orderId);

    if (existingTickets && existingTickets.length > 0) {
      const { data: tickets } = await this.supabase.getClient()
        .from('tickets')
        .select('*')
        .eq('order_id', orderId);
      return tickets;
    }

    const tickets: any[] = [];

    for (const item of order.order_items) {
      for (let i = 0; i < item.quantity; i++) {
        const ticketId = uuidv4();
        const qrData = JSON.stringify({
          ticket_id: ticketId,
          order_id: orderId,
          order_number: order.order_number,
          ticket_type: item.ticket_types?.name,
          holder_name: order.user_email,
          holder_type: order.user_type,
          issued_at: new Date().toISOString(),
        });

        const qrCodeDataUrl = await QRCode.toDataURL(qrData, {
          errorCorrectionLevel: 'H',
          width: 300,
          margin: 2,
        });

        tickets.push({
          id: ticketId,
          order_id: orderId,
          order_item_id: item.id,
          ticket_type_id: item.ticket_type_id,
          holder_name: order.user_email,
          holder_email: order.user_email,
          holder_type: order.user_type,
          qr_code_data: qrData,
          qr_code_url: qrCodeDataUrl,
          is_used: false,
          downloaded: false,
          download_count: 0,
        });
      }
    }

    const { data: insertedTickets, error } = await this.supabase.getAdminClient()
      .from('tickets')
      .insert(tickets)
      .select();

    if (error) throw new BadRequestException(error.message);

    for (const item of order.order_items) {
      await this.supabase.getAdminClient()
        .from('ticket_types')
        .update({ sold_count: item.quantity })
        .eq('id', item.ticket_type_id);
    }

    return insertedTickets;
  }

  async getTicketPdf(ticketId: string) {
    const { data: ticket, error } = await this.supabase.getClient()
      .from('tickets')
      .select('*, orders(order_number, user_email, user_type), ticket_types:ticket_type_id(name, description)')
      .eq('id', ticketId)
      .single();

    if (error || !ticket) throw new NotFoundException('Ticket not found');

    const { data: order } = await this.supabase.getClient()
      .from('orders')
      .select('status')
      .eq('id', ticket.order_id)
      .single();

    if (!order || order.status !== 'paid') {
      throw new ForbiddenException('Payment must be completed before downloading ticket');
    }

    await this.supabase.getAdminClient()
      .from('tickets')
      .update({
        downloaded: true,
        download_count: (ticket.download_count || 0) + 1,
      })
      .eq('id', ticketId);

    return ticket;
  }

  async generateTicketPdfBuffer(ticketId: string): Promise<Buffer> {
    const ticket = await this.getTicketPdf(ticketId);
    const PDFDocument = (await import('pdfkit')).default;

    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({
        size: [400, 600],
        margins: { top: 30, bottom: 30, left: 30, right: 30 },
      });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Header
      doc.fontSize(24).font('Helvetica-Bold').text('ZITF CONNECT', { align: 'center' });
      doc.moveDown(0.3);
      doc.fontSize(12).font('Helvetica').text('Zimbabwe International Trade Fair', { align: 'center' });
      doc.moveDown(0.5);

      // Divider
      doc.moveTo(30, doc.y).lineTo(370, doc.y).stroke('#333');
      doc.moveDown(0.5);

      // Ticket type
      const ticketTypeName = (ticket as any).ticket_types?.name || 'General Admission';
      doc.fontSize(18).font('Helvetica-Bold').text(ticketTypeName, { align: 'center' });
      doc.moveDown(0.3);

      // Details
      doc.fontSize(10).font('Helvetica');
      doc.text(`Order: ${(ticket as any).orders?.order_number || 'N/A'}`, { align: 'center' });
      doc.text(`Holder: ${ticket.holder_email}`, { align: 'center' });
      doc.text(`Type: ${ticket.holder_type?.toUpperCase()}`, { align: 'center' });
      doc.text(`Issued: ${new Date(ticket.created_at).toLocaleDateString()}`, { align: 'center' });
      doc.moveDown(1);

      // QR Code
      if (ticket.qr_code_url) {
        const base64Data = ticket.qr_code_url.replace(/^data:image\/png;base64,/, '');
        const qrBuffer = Buffer.from(base64Data, 'base64');
        doc.image(qrBuffer, 100, doc.y, { width: 200, align: 'center' });
        doc.moveDown(0.5);
        doc.y += 210;
      }

      // Ticket ID
      doc.fontSize(8).font('Helvetica').text(`Ticket ID: ${ticket.id}`, { align: 'center' });
      doc.moveDown(1);

      // Footer
      doc.moveTo(30, doc.y).lineTo(370, doc.y).stroke('#333');
      doc.moveDown(0.3);
      doc.fontSize(8).text('Present this ticket with QR code at the entrance.', { align: 'center' });
      doc.text('This ticket is valid for one-time entry only.', { align: 'center' });

      doc.end();
    });
  }

  async validateTicket(ticketId: string) {
    const { data: ticket, error } = await this.supabase.getClient()
      .from('tickets')
      .select('*, ticket_types:ticket_type_id(name)')
      .eq('id', ticketId)
      .single();

    if (error || !ticket) throw new NotFoundException('Ticket not found');

    if (ticket.is_used) {
      return {
        valid: false,
        message: 'Ticket has already been used',
        used_at: ticket.used_at,
        ticket,
      };
    }

    await this.supabase.getAdminClient()
      .from('tickets')
      .update({ is_used: true, used_at: new Date().toISOString() })
      .eq('id', ticketId);

    return {
      valid: true,
      message: 'Ticket validated successfully',
      ticket: { ...ticket, is_used: true },
    };
  }

  async getAllOrders(page = 1, pageSize = 20, status?: string) {
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = this.supabase.getClient()
      .from('orders')
      .select('*, order_items(quantity, subtotal, ticket_types(name)), payments(status, payment_method)', { count: 'exact' })
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
