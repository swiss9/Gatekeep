import type { FastifyPluginAsync } from 'fastify';
import { supabaseAdmin } from '../supabase.js';
import { HttpError } from '../middleware/auth.js';
import type { StoreSettings } from '../types.js';

const FALLBACK: StoreSettings = {
  id: 1, store_name: 'Gatekeep Shop', store_tagline: 'General Goods',
  currency_symbol: '$', currency_code: 'usd',
  shipping_threshold: 60, shipping_cost: 6,
  banner_enabled: true, banner_eyebrow: 'NEW',
  banner_title: 'Welcome to your store.',
  banner_subtitle: 'Free shipping on orders over $60.',
  banner_cta: 'Shop all', banner_cta_action: 'all', banner_color: 'mint',
  payment_provider: 'manual', payment_url: '', payment_ton_address: '',
  perks_enabled: true, perk_1_text: 'Free shipping over $60',
  perk_2_text: '30-day easy returns', perk_3_text: 'Secure checkout',
  stars_enabled: false, stars_rate: 77,
  bank_enabled: false, bank_details: '',
  crypto_enabled: false, crypto_btc: '', crypto_eth: '',
  crypto_usdt_trc20: '', crypto_ton: '',
  stripe_enabled: false,
  updated_at: new Date(0).toISOString(),
};

export const storeRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/store', async (_req, reply) => {
    const { data, error } = await supabaseAdmin
      .from('store_settings').select('*').eq('id', 1).maybeSingle();
    if (error) throw new HttpError(500, error.message);

    // Primary superadmin's Telegram username — used by the client for
    // "Message seller on Telegram" deep links (manual payment method).
    let supportUsername: string | null = null;
    const { data: primaryAdmin } = await supabaseAdmin
      .from('profiles')
      .select('username')
      .eq('role', 'superadmin')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (primaryAdmin?.username) supportUsername = primaryAdmin.username;

    return reply.send({
      store: (data as StoreSettings | null) ?? FALLBACK,
      support_username: supportUsername,
    });
  });
};
