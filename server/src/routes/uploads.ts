import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { supabaseAdmin } from '../supabase.js';
import { HttpError, requireAuth, currentProfile } from '../middleware/auth.js';
import { detectDocMime, detectImageMime } from '../magicBytes.js';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_RECEIPT_BYTES = 8 * 1024 * 1024;

type Bucket = 'products' | 'digital-goods' | 'receipts';

type BucketRule = {
  imagesOnly: boolean;
  adminOnly: boolean;
  publicUrl: boolean;
  maxBytes: number;
};

function ruleFor(bucket: Bucket): BucketRule {
  switch (bucket) {
    case 'products':
      return { imagesOnly: true, adminOnly: true, publicUrl: true, maxBytes: MAX_IMAGE_BYTES };
    case 'receipts':
      return { imagesOnly: true, adminOnly: false, publicUrl: false, maxBytes: MAX_RECEIPT_BYTES };
    case 'digital-goods':
      // No MIME allowlist — a merchant sells whatever they want.
      return { imagesOnly: false, adminOnly: true, publicUrl: false, maxBytes: MAX_FILE_BYTES };
  }
}

export const uploadRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/api/uploads/:bucket',
    { preHandler: requireAuth },
    async (req: FastifyRequest, reply) => {
      const { bucket: bucketRaw } = req.params as { bucket: string };
      if (bucketRaw !== 'products' && bucketRaw !== 'digital-goods' && bucketRaw !== 'receipts') {
        throw new HttpError(404, 'Unknown bucket');
      }
      const bucket = bucketRaw as Bucket;
      const me = currentProfile(req);
      const rule = ruleFor(bucket);

      if (rule.adminOnly && me.role !== 'admin' && me.role !== 'superadmin') {
        throw new HttpError(403, 'Admin only');
      }

      const part = await req.file({ limits: { fileSize: rule.maxBytes } });
      if (!part) throw new HttpError(400, 'No file part in request');

      const bytes = await part.toBuffer();
      if (bytes.length === 0) throw new HttpError(400, 'Empty file');
      if (bytes.length > rule.maxBytes) {
        throw new HttpError(413, `File too large (max ${Math.round(rule.maxBytes / 1024 / 1024)}MB)`);
      }

      let storedMime: string;
      if (rule.imagesOnly) {
        const detected = detectImageMime(bytes);
        if (!detected) {
          throw new HttpError(400, 'Only JPG, PNG, WebP, GIF or HEIC images are accepted here.');
        }
        storedMime = detected;
      } else {
        // If we recognize the content signature, use it. Otherwise trust
        // the client's declared type.
        const detected = detectDocMime(bytes);
        storedMime = detected ?? (part.mimetype || 'application/octet-stream');
      }

      const ext = (part.filename?.split('.').pop() ?? 'bin')
        .toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
      let path: string;
      if (bucket === 'receipts') {
        const fields = part.fields as Record<string, { value?: unknown } | undefined> | undefined;
        const orderIdField = fields?.order_id;
        const orderId = orderIdField && typeof orderIdField === 'object' && 'value' in orderIdField
          ? String(orderIdField.value ?? '') : '';
        if (!/^[0-9a-f-]{36}$/i.test(orderId)) {
          throw new HttpError(400, 'order_id field required for receipts');
        }
        path = `${me.id}/${orderId}.${ext}`;
      } else {
        path = `${crypto.randomUUID()}.${ext}`;
      }

      const { error: uploadErr } = await supabaseAdmin.storage
        .from(bucket)
        .upload(path, bytes, { contentType: storedMime, upsert: bucket === 'receipts' });
      if (uploadErr) {
        app.log.error(`[uploads] ${bucket}/${path} failed: ${uploadErr.message}`);
        throw new HttpError(500, 'Upload failed');
      }

      const publicUrl = rule.publicUrl
        ? supabaseAdmin.storage.from(bucket).getPublicUrl(path).data.publicUrl
        : null;

      return reply.send({ path, public_url: publicUrl, mime: storedMime });
    },
  );
};
