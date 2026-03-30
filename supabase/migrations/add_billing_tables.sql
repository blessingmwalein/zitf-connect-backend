-- ============================================
-- ZITF Billing Module - Database Migration
-- Tables: ticket_types, orders, order_items, payments, tickets
-- ============================================

-- Enum: ticket_category
DO $$ BEGIN
  CREATE TYPE ticket_category AS ENUM ('visitor', 'exhibitor');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Enum: order_status
DO $$ BEGIN
  CREATE TYPE order_status AS ENUM ('pending', 'paid', 'failed', 'refunded', 'cancelled');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Enum: payment_status
DO $$ BEGIN
  CREATE TYPE payment_status AS ENUM ('pending', 'paid', 'failed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Enum: payment_method_type
DO $$ BEGIN
  CREATE TYPE payment_method_type AS ENUM ('web', 'ecocash', 'onemoney');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Enum: payment_type
DO $$ BEGIN
  CREATE TYPE payment_type AS ENUM ('ticket', 'stand_application');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ============================================
-- 1. ticket_types
-- ============================================
CREATE TABLE IF NOT EXISTS ticket_types (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  price       NUMERIC(10,2) NOT NULL DEFAULT 0,
  currency    TEXT NOT NULL DEFAULT 'USD',
  max_quantity INTEGER,
  sold_count  INTEGER NOT NULL DEFAULT 0,
  ticket_category ticket_category NOT NULL DEFAULT 'visitor',
  valid_from  TIMESTAMPTZ,
  valid_until TIMESTAMPTZ,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- 2. orders
-- ============================================
CREATE TABLE IF NOT EXISTS orders (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number  TEXT NOT NULL UNIQUE,
  user_id       UUID,
  user_email    TEXT NOT NULL,
  user_type     TEXT NOT NULL DEFAULT 'visitor',
  total_amount  NUMERIC(10,2) NOT NULL DEFAULT 0,
  currency      TEXT NOT NULL DEFAULT 'USD',
  status        order_status NOT NULL DEFAULT 'pending',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- 3. order_items
-- ============================================
CREATE TABLE IF NOT EXISTS order_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  ticket_type_id  UUID NOT NULL REFERENCES ticket_types(id),
  quantity        INTEGER NOT NULL DEFAULT 1,
  unit_price      NUMERIC(10,2) NOT NULL,
  subtotal        NUMERIC(10,2) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- 4. payments
-- ============================================
CREATE TABLE IF NOT EXISTS payments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          UUID REFERENCES orders(id) ON DELETE SET NULL,
  paynow_reference  TEXT,
  poll_url          TEXT,
  redirect_url      TEXT,
  amount            NUMERIC(10,2) NOT NULL,
  currency          TEXT NOT NULL DEFAULT 'USD',
  payment_method    TEXT NOT NULL DEFAULT 'web',
  status            payment_status NOT NULL DEFAULT 'pending',
  payment_type      TEXT NOT NULL DEFAULT 'ticket',
  phone_number      TEXT,
  instructions      TEXT,
  metadata          JSONB,
  paid_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- 5. tickets (issued after payment)
-- ============================================
CREATE TABLE IF NOT EXISTS tickets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_item_id   UUID REFERENCES order_items(id),
  ticket_type_id  UUID NOT NULL REFERENCES ticket_types(id),
  holder_name     TEXT,
  holder_email    TEXT,
  holder_type     TEXT NOT NULL DEFAULT 'visitor',
  qr_code_data    TEXT,
  qr_code_url     TEXT,
  is_used         BOOLEAN NOT NULL DEFAULT false,
  used_at         TIMESTAMPTZ,
  downloaded      BOOLEAN NOT NULL DEFAULT false,
  download_count  INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- Indexes
-- ============================================
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_user_email ON orders(user_email);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_poll_url ON payments(poll_url);
CREATE INDEX IF NOT EXISTS idx_tickets_order_id ON tickets(order_id);
CREATE INDEX IF NOT EXISTS idx_tickets_is_used ON tickets(is_used);
CREATE INDEX IF NOT EXISTS idx_ticket_types_category ON ticket_types(ticket_category);
CREATE INDEX IF NOT EXISTS idx_ticket_types_active ON ticket_types(is_active);

-- ============================================
-- RLS Policies (basic - adjust as needed)
-- ============================================
ALTER TABLE ticket_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;

-- Allow public read on active ticket types
CREATE POLICY "Anyone can view active ticket types"
  ON ticket_types FOR SELECT
  USING (is_active = true);

-- Allow authenticated users to manage their own orders
CREATE POLICY "Users can view own orders"
  ON orders FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR user_email = auth.email());

CREATE POLICY "Users can create orders"
  ON orders FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Allow authenticated users to view their order items
CREATE POLICY "Users can view own order items"
  ON order_items FOR SELECT
  TO authenticated
  USING (order_id IN (SELECT id FROM orders WHERE user_id = auth.uid() OR user_email = auth.email()));

-- Allow authenticated users to view their payments
CREATE POLICY "Users can view own payments"
  ON payments FOR SELECT
  TO authenticated
  USING (order_id IN (SELECT id FROM orders WHERE user_id = auth.uid() OR user_email = auth.email()));

-- Allow authenticated users to view their tickets
CREATE POLICY "Users can view own tickets"
  ON tickets FOR SELECT
  TO authenticated
  USING (order_id IN (SELECT id FROM orders WHERE user_id = auth.uid() OR user_email = auth.email()));

-- Service role can do everything (for backend API)
CREATE POLICY "Service role full access ticket_types" ON ticket_types FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access orders" ON orders FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access order_items" ON order_items FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access payments" ON payments FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access tickets" ON tickets FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Anon role can read ticket types (for mobile app browsing)
CREATE POLICY "Anon can view active ticket types" ON ticket_types FOR SELECT TO anon USING (is_active = true);
-- Anon can insert orders (for guest checkout)
CREATE POLICY "Anon can create orders" ON orders FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Anon can insert order items" ON order_items FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Anon can insert payments" ON payments FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Anon can read own payments by poll_url" ON payments FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can read orders" ON orders FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can read order items" ON order_items FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can read tickets" ON tickets FOR SELECT TO anon USING (true);

-- ============================================
-- Updated_at trigger
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_ticket_types_updated_at BEFORE UPDATE ON ticket_types
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_payments_updated_at BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
