import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { supabaseAdmin } from '../supabase.js';
import { HttpError, requireAuth, currentProfile } from '../middleware/auth.js';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_RECEIPT_BYTES = 8 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const ALLOWED_DIGITAL_TYPES = [
  'application/pdf',
  'application/zip',
  'application/x-zip-compressed',
  'application/epub+zip',
  'application/octet-stream',
  'audio/mpeg',
  'audio/wav',
  'audio/mp4',
  'video/mp4',
];
const ALLOWED_RECEIPT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

type Bucket = 'products' | 'digital-goods' | 'receipts';

function classify(bucket: Bucket): {
  allowed: string[];
  maxBytes: number;
  requiresAdmin: boolean;
  publicUrl: boolean;
} {
  switch (bucket) {
    case 'products':
      return {
        allowed: ALLOWED_IMAGE_TYPES,
        maxBytes: MAX_IMAGE_BYTES,
        requiresAdmin: true,
        publicUrl: true,
      };
    case 'digital-goods':
      return {
        allowed: ALLOWED_DIGITAL_TYPES,
        maxBytes: MAX_FILE_BYTES,
        requiresAdmin: true,
        publicUrl: false,
      };
    case 'receipts':
      return {
        allowed: ALLOWED_RECEIPT_TYPES,
        maxBytes: MAX_RECEIPT_BYTES,
        requiresAdmin: false,
        publicUrl: false,
      };
  }
}

export const uploadRoutes: FastifyPluginAsync = async (app) => {
  /**
   * POST /api/uploads/:bucket
   * multipart/form-data with fields:
   *   file       (required)
   *   order_id   (optional, only for bucket=receipts — scopes the path)
   *
   * Replaces the previous direct-to-Supabase uploads, which failed
   * whenever SUPABASE_JWT_SECRET didn't byte-match the project's JWT
   * signing key. Service-role uploads sidestep that entirely.
   */
  app.post('/api/uploads/:bucket', { preHandler: requireAuth }, async (req: FastifyRequest, reply) => {
    const { bucket: bucketRaw } = req.params as { bucket: string };
    if (bucketRaw !== 'products' && bucketRaw !== 'digital-goods' && bucketRaw !== 'receipts') {
      throw new HttpError(404, 'Unknown bucket');
    }
    const bucket = bucketRaw as Bucket;
    const me = currentProfile(req);
    const cfg = classify(bucket);

    if (cfg.requiresAdmin && me.role !== 'admin' && me.role !== 'superadmin') {
      throw new HttpError(403, 'Admin only');
    }

    const part = await req.file({ limits: { fileSize: cfg.maxBytes } });
    if (!part) throw new HttpError(400, 'No file part in request');

    if (!cfg.allowed.includes(part.mimetype)) {
      throw new HttpError(400, `Unsupported file type: ${part.mimetype}`);
    }

    const bytes = await part.toBuffer();
    if (bytes.length > cfg.maxBytes) {
      throw new HttpError(413, `File too large (max ${Math.round(cfg.maxBytes / 1024 / 1024)}MB)`);
    }

    // Path convention per bucket.
    const ext = (part.filename?.split('.').pop() ?? 'bin')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '') || 'bin';
    let path: string;
    if (bucket === 'receipts') {
      const orderIdRaw = (part.fields as Record<string, { value?: unknown }> | undefined)
        ?.order_id;
      const orderId =
        orderIdRaw && typeof orderIdRaw === 'object' && 'value' in orderIdRaw
          ? String(orderIdRaw.value ?? '')
          : '';
      if (!/^[0-9a-f-]{36}$/i.test(orderId)) {
        throw new HttpError(400, 'order_id field required for receipts');
      }
      path = `${me.id}/${orderId}.${ext}`;
    } else {
      path = `${crypto.randomUUID()}.${ext}`;
    }

    const { error: uploadErr } = await supabaseAdmin.storage
      .from(bucket)
      .upload(path, bytes, {
        contentType: part.mimetype,
        upsert: bucket === 'receipts',
      });
    if (uploadErr) {
      app.log.error(`[uploads] ${bucket}/${path} failed: ${uploadErr.message}`);
      throw new HttpError(500, 'Upload failed');
    }

    const publicUrl = cfg.publicUrl
      ? supabaseAdmin.storage.from(bucket).getPublicUrl(path).data.publicUrl
      : null;

    return reply.send({ path, public_url: publicUrl });
  });
};
