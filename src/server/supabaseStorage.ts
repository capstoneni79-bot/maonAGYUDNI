import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

export interface LandingUploadResult {
  filePath: string;
  fileUrl: string;
  fileSize: number;
}

const IMAGE_CONTENT_TYPES: Record<string, { extensions: string[]; matches: (file: Buffer) => boolean }> = {
  'image/jpeg': { extensions: ['jpg', 'jpeg'], matches: file => file[0] === 0xff && file[1] === 0xd8 && file[2] === 0xff },
  'image/png': { extensions: ['png'], matches: file => file[0] === 0x89 && file.toString('ascii', 1, 4) === 'PNG' },
  'image/webp': { extensions: ['webp'], matches: file => file.toString('ascii', 0, 4) === 'RIFF' && file.toString('ascii', 8, 12) === 'WEBP' },
  'image/gif': { extensions: ['gif'], matches: file => ['GIF87a', 'GIF89a'].includes(file.toString('ascii', 0, 6)) },
};

export async function uploadLandingCmsAsset(
  fileName: string,
  mimeType: string,
  base64Payload: string,
  category: string
): Promise<LandingUploadResult> {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const adminKey = process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!supabaseUrl || !adminKey) {
      throw new Error('Server-side Supabase Storage is unavailable. Set SUPABASE_URL and SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY) as server-side environment variables.');
  }

  const match = base64Payload.match(/^data:([^;]+);base64,([A-Za-z0-9+/=\r\n]+)$/s);
  if (!match || match[1].toLowerCase() !== mimeType.toLowerCase()) {
    throw new Error('The image payload is malformed or its declared MIME type does not match.');
  }
  const encoded = match[2];
  const file = Buffer.from(encoded, 'base64');
  if (file.length === 0 || file.length > 15 * 1024 * 1024) {
    throw new Error('The uploaded image is empty or exceeds the 15 MB limit.');
  }
  const contentType = mimeType.toLowerCase();
  const extension = fileName.split('.').pop()?.toLowerCase() || '';
  const imageType = IMAGE_CONTENT_TYPES[contentType];
  if (!imageType || !imageType.extensions.includes(extension) || !imageType.matches(file)) {
    throw new Error('Only genuine JPEG, PNG, WebP, or GIF images with matching MIME type and extension are accepted.');
  }

    const supabase = createClient(supabaseUrl, adminKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const bucket = process.env.SUPABASE_LANDING_MEDIA_BUCKET || 'landing-page-media';
  const buckets = await supabase.storage.listBuckets();
  if (buckets.error) throw new Error(`Unable to inspect Supabase Storage buckets: ${buckets.error.message}`);

  if (!buckets.data.some(item => item.name === bucket)) {
    const created = await supabase.storage.createBucket(bucket, { public: true });
    if (created.error) throw new Error(`Unable to create the ${bucket} Storage bucket: ${created.error.message}`);
  }

  const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'asset';
  const safeCategory = category.toLowerCase().replace(/[^a-z0-9_-]/g, '-') || 'other';
  const filePath = `${safeCategory}/${randomUUID()}-${safeFileName}`;
  const uploaded = await supabase.storage.from(bucket).upload(filePath, file, {
    contentType,
    cacheControl: '3600',
    upsert: false,
  });
  if (uploaded.error) throw new Error(`Supabase Storage upload failed: ${uploaded.error.message}`);

  const { data } = supabase.storage.from(bucket).getPublicUrl(filePath);
  return { filePath, fileUrl: data.publicUrl, fileSize: file.length };
}

export async function deleteLandingCmsAsset(filePath: string): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const adminKey = process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!supabaseUrl || !adminKey) {
      throw new Error('Server-side Supabase Storage is unavailable. Set SUPABASE_URL and SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY) as server-side environment variables.');
    }
  const bucket = process.env.SUPABASE_LANDING_MEDIA_BUCKET || 'landing-page-media';
    const supabase = createClient(supabaseUrl, adminKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const result = await supabase.storage.from(bucket).remove([filePath]);
  if (result.error) throw new Error(`Failed to remove Supabase Storage object: ${result.error.message}`);
}