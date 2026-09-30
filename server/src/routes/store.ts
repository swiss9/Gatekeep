import type { FastifyPluginAsync } from 'fastify';
import { supabaseAdmin } from '../supabase.js';
import { HttpError } from '../middleware/auth.js';
import type { StoreSettings } from '../types.js';

const FALLBACK: StoreSettings = {
  id: 1,
  store_name: 'Gatekeep Shop',
  store_tagline: 'General Goods',
  currency_symbol: '$',
  shipping_threshold: 60,
  shipping_cost: 6,
  banner_enabled: true,
  banner_eyebrow: 'NEW',
  banner_title: 'Welcome to your store.',
  banner_subtitle: 'Free shipping on orders over $60.',
  banner_cta: 'Shop all',
  banner_cta_action: 'all',
  banner_color: 'mint',
  updated_at: new Date(0).toISOString(),
};

export const storeRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/store', async (_req, reply) => {
    const { data, error } = await supabaseAdmin
      .from('store_settings')
      .select('*')
      .eq('id', 1)
      .maybeSingle();
    if (error) throw new HttpError(500, error.message);
    return reply.send({ store: (data as StoreSettings | null) ?? FALLBACK });
  });
};
