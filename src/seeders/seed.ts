import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(__dirname, '../../.env') });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!,
);

async function seedTicketTypes() {
  console.log('Seeding ticket types...');

  const ticketTypes = [
    {
      name: 'General Admission - Visitor',
      description: 'Standard entry ticket for visitors to access the trade fair grounds and exhibition halls.',
      price: 10.00,
      currency: 'USD',
      max_quantity: 5000,
      sold_count: 0,
      ticket_category: 'visitor',
      is_active: true,
      valid_from: '2025-04-22T08:00:00Z',
      valid_until: '2025-04-26T18:00:00Z',
    },
    {
      name: 'VIP Pass - Visitor',
      description: 'Premium visitor pass with access to VIP lounges, networking events, and priority seating at seminars.',
      price: 50.00,
      currency: 'USD',
      max_quantity: 500,
      sold_count: 0,
      ticket_category: 'visitor',
      is_active: true,
      valid_from: '2025-04-22T08:00:00Z',
      valid_until: '2025-04-26T18:00:00Z',
    },
    {
      name: 'Day Pass - Visitor',
      description: 'Single-day entry pass for visitors.',
      price: 5.00,
      currency: 'USD',
      max_quantity: 10000,
      sold_count: 0,
      ticket_category: 'visitor',
      is_active: true,
      valid_from: '2025-04-22T08:00:00Z',
      valid_until: '2025-04-26T18:00:00Z',
    },
    {
      name: 'Student Pass',
      description: 'Discounted entry for students with valid student ID.',
      price: 3.00,
      currency: 'USD',
      max_quantity: 3000,
      sold_count: 0,
      ticket_category: 'visitor',
      is_active: true,
      valid_from: '2025-04-22T08:00:00Z',
      valid_until: '2025-04-26T18:00:00Z',
    },
    {
      name: 'Exhibitor Pass',
      description: 'Full exhibitor pass for the duration of the trade fair with exhibitor-only areas access.',
      price: 100.00,
      currency: 'USD',
      max_quantity: 1000,
      sold_count: 0,
      ticket_category: 'exhibitor',
      is_active: true,
      valid_from: '2025-04-22T08:00:00Z',
      valid_until: '2025-04-26T18:00:00Z',
    },
    {
      name: 'Exhibitor Staff Pass',
      description: 'Additional staff pass for exhibitor team members.',
      price: 25.00,
      currency: 'USD',
      max_quantity: 2000,
      sold_count: 0,
      ticket_category: 'exhibitor',
      is_active: true,
      valid_from: '2025-04-22T08:00:00Z',
      valid_until: '2025-04-26T18:00:00Z',
    },
  ];

  const { data, error } = await supabase
    .from('ticket_types')
    .upsert(ticketTypes, { onConflict: 'name' })
    .select();

  if (error) {
    console.error('Error seeding ticket types:', error.message);
  } else {
    console.log(`Seeded ${data.length} ticket types`);
  }
}

async function seedSamplePayments() {
  console.log('Seeding sample orders and payments...');

  // Create a sample order
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .insert({
      order_number: 'ZITF-SEED-001',
      user_email: 'demo-visitor@zitf.co.zw',
      user_type: 'visitor',
      total_amount: 10.00,
      currency: 'USD',
      status: 'paid',
    })
    .select()
    .single();

  if (orderError) {
    console.error('Error seeding order:', orderError.message);
    return;
  }

  console.log(`Seeded order: ${order.order_number}`);

  // Get a ticket type to link
  const { data: ticketType } = await supabase
    .from('ticket_types')
    .select('id')
    .eq('name', 'General Admission - Visitor')
    .single();

  if (ticketType) {
    // Create order item
    await supabase.from('order_items').insert({
      order_id: order.id,
      ticket_type_id: ticketType.id,
      quantity: 1,
      unit_price: 10.00,
      subtotal: 10.00,
    });

    console.log('Seeded order item');
  }

  // Create a sample payment record
  const { error: paymentError } = await supabase
    .from('payments')
    .insert({
      order_id: order.id,
      paynow_reference: 'SEED-PAYNOW-REF-001',
      poll_url: 'https://paynow.co.zw/poll/seed-001',
      amount: 10.00,
      currency: 'USD',
      payment_method: 'ecocash',
      status: 'paid',
      payment_type: 'ticket',
      phone_number: '0771234567',
      paid_at: new Date().toISOString(),
    });

  if (paymentError) {
    console.error('Error seeding payment:', paymentError.message);
  } else {
    console.log('Seeded sample payment');
  }
}

async function main() {
  console.log('=== ZITF Billing Module Seeder ===\n');
  await seedTicketTypes();
  await seedSamplePayments();
  console.log('\n=== Seeding complete ===');
}

main().catch(console.error);
