import type { FastifyPluginAsync } from 'fastify';
import { supabaseAdmin } from '../supabase.js';
import { HttpError, requireRole } from '../middleware/auth.js';
import { CategoryCreateSchema, CategoryUpdateSchema } from '../schemas.js';
import type { Category } from '../types.js';

export const categoryRoutes: FastifyPluginAsync = async (app) => {
  // ---- Public ----
  app.get('/api/categories', async (_req, reply) => {
    const { data, error } = await supabaseAdmin
      .from('categories')
      .select('*')
      .order('position', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) throw new HttpError(500, error.message);
    return reply.send({ categories: (data as Category[]) ?? [] });
  });

  // ---- Admin ----
  app.post(
    '/api/admin/categories',
    { preHandler: requireRole('admin', 'superadmin') },
    async (req, reply) => {
      const body = CategoryCreateSchema.parse(req.body);
      const { data, error } = await supabaseAdmin
        .from('categories')
        .insert({
          name: body.name,
          position: body.position ?? 0,
        })
        .select()
        .single();
      if (error || !data) {
        if (error?.code === '23505') throw new HttpError(409, 'Category name already exists');
        throw new HttpError(500, error?.message ?? 'insert failed');
      }
      return reply.code(201).send({ category: data as Category });
    },
  );

  app.patch(
    '/api/admin/categories/:id',
    { preHandler: requireRole('admin', 'superadmin') },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = CategoryUpdateSchema.parse(req.body);
      const { data, error } = await supabaseAdmin
        .from('categories')
        .update(body)
        .eq('id', id)
        .select()
        .single();
      if (error || !data) {
        if (error?.code === '23505') throw new HttpError(409, 'Category name already exists');
        throw new HttpError(404, 'Category not found');
      }
      return reply.send({ category: data as Category });
    },
  );

  app.delete(
    '/api/admin/categories/:id',
    { preHandler: requireRole('admin', 'superadmin') },
    async (req, reply) => {
      const { id } = req.params as { id: string };

      // Block deletion if products still reference this category —
      // silent orphaning is worse than a clear error.
      const { count, error: countErr } = await supabaseAdmin
        .from('products')
        .select('id', { count: 'exact', head: true })
        .eq('category_id', id);
      if (countErr) throw new HttpError(500, countErr.message);
      if ((count ?? 0) > 0) {
        throw new HttpError(409, `Category has ${count} product(s). Move or delete them first.`);
      }

      const { error } = await supabaseAdmin.from('categories').delete().eq('id', id);
      if (error) throw new HttpError(500, error.message);
      return reply.send({ ok: true });
    },
  );
};
