import type { FastifyPluginAsync } from 'fastify';
import { supabaseAdmin } from '../supabase.js';
import { HttpError, requireRole, currentProfile } from '../middleware/auth.js';
import { ProductCreateSchema, ProductUpdateSchema } from '../schemas.js';
import type { Product } from '../types.js';

export const productRoutes: FastifyPluginAsync = async (app) => {
  // ---- Public list ----
  // Clients typically load this once and filter locally, but we support
  // ?category_id= and ?q= for larger catalogues.
  app.get('/api/products', async (req, reply) => {
    const q = req.query as { category_id?: string; q?: string; all?: string };
    let query = supabaseAdmin.from('products').select('*');

    // Only admins may see inactive products.
    let isAdmin = false;
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ') && q.all === '1') {
      try {
        await requireRole('admin', 'superadmin')(req, reply);
        isAdmin = true;
      } catch (err) {
        // Only swallow "authenticated but not an admin" — the caller
        // still gets the public list. Anything else (malformed JWT,
        // missing profile, DB failure) is a real error and must bubble
        // up to the error handler rather than silently degrading.
        if (!(err instanceof HttpError) || err.status !== 403) {
          throw err;
        }
      }
    }
    if (!isAdmin) query = query.eq('active', true);

    if (q.category_id) query = query.eq('category_id', q.category_id);
    if (q.q) query = query.ilike('name', `%${q.q}%`);

    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw new HttpError(500, error.message);
    return reply.send({ products: (data as Product[]) ?? [] });
  });

  app.get('/api/products/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { data, error } = await supabaseAdmin
      .from('products')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new HttpError(500, error.message);
    if (!data) throw new HttpError(404, 'Product not found');
    return reply.send({ product: data as Product });
  });

  // ---- Admin ----
  app.post(
    '/api/admin/products',
    { preHandler: requireRole('admin', 'superadmin') },
    async (req, reply) => {
      const body = ProductCreateSchema.parse(req.body);
      const { data, error } = await supabaseAdmin
        .from('products')
        .insert({
          name: body.name,
          description: body.description ?? '',
          price: body.price,
          category_id: body.category_id ?? null,
          image_url: body.image_url ?? null,
          pastel_color: body.pastel_color,
          stock: body.stock,
          active: body.active,
        })
        .select()
        .single();
      if (error || !data) throw new HttpError(500, error?.message ?? 'insert failed');
      return reply.code(201).send({ product: data as Product });
    },
  );

  app.patch(
    '/api/admin/products/:id',
    { preHandler: requireRole('admin', 'superadmin') },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = ProductUpdateSchema.parse(req.body);
      const { data, error } = await supabaseAdmin
        .from('products')
        .update({ ...body, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      if (error || !data) throw new HttpError(404, 'Product not found');
      return reply.send({ product: data as Product });
    },
  );

  app.delete(
    '/api/admin/products/:id',
    { preHandler: requireRole('admin', 'superadmin') },
    async (req, reply) => {
      const actor = currentProfile(req);
      const { id } = req.params as { id: string };

      // Soft-delete is safer: order_items reference products for history,
      // and a hard delete would orphan them. We deactivate instead.
      const { error } = await supabaseAdmin
        .from('products')
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw new HttpError(500, error.message);

      // eslint-disable-next-line no-console
      console.log(`[admin] product ${id} deactivated by ${actor.id} (${actor.role})`);
      return reply.send({ ok: true });
    },
  );
};
