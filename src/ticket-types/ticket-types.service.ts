import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service.js';
import { CreateTicketTypeDto } from './dto/create-ticket-type.dto.js';
import { UpdateTicketTypeDto } from './dto/update-ticket-type.dto.js';

@Injectable()
export class TicketTypesService {
  constructor(private supabase: SupabaseService) {}

  async findAll(activeOnly = false) {
    const query = this.supabase.getClient()
      .from('ticket_types')
      .select('*')
      .order('created_at', { ascending: false });

    if (activeOnly) {
      query.eq('is_active', true);
    }

    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async findOne(id: string) {
    const { data, error } = await this.supabase.getClient()
      .from('ticket_types')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) throw new NotFoundException(`Ticket type ${id} not found`);
    return data;
  }

  async create(dto: CreateTicketTypeDto) {
    const { data, error } = await this.supabase.getAdminClient()
      .from('ticket_types')
      .insert({
        name: dto.name,
        description: dto.description || null,
        price: dto.price,
        currency: dto.currency || 'USD',
        max_quantity: dto.max_quantity || null,
        ticket_category: dto.ticket_category,
        valid_from: dto.valid_from || null,
        valid_until: dto.valid_until || null,
        is_active: dto.is_active ?? true,
        sold_count: 0,
      })
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async update(id: string, dto: UpdateTicketTypeDto) {
    await this.findOne(id);

    const { data, error } = await this.supabase.getAdminClient()
      .from('ticket_types')
      .update({ ...dto, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async remove(id: string) {
    await this.findOne(id);

    const { error } = await this.supabase.getAdminClient()
      .from('ticket_types')
      .delete()
      .eq('id', id);

    if (error) throw new BadRequestException(error.message);
    return { message: 'Ticket type deleted' };
  }

  async getAvailable() {
    const now = new Date().toISOString();
    const { data, error } = await this.supabase.getClient()
      .from('ticket_types')
      .select('*')
      .eq('is_active', true)
      .or(`valid_from.is.null,valid_from.lte.${now}`)
      .or(`valid_until.is.null,valid_until.gte.${now}`)
      .order('price', { ascending: true });

    if (error) throw new BadRequestException(error.message);

    return data.filter(tt =>
      tt.max_quantity === null || tt.sold_count < tt.max_quantity,
    );
  }
}
