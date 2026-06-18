import sharp from 'sharp';
import { supabase } from './supabase.js';
import { uploadProductImage } from './cloudinary.js';

const PROFILE_BUCKET = 'profile-images';

// ─── PRODUCT IMAGES → Cloudinary ──────────────────────────────────────────
/**
 * Upload a product image buffer to Cloudinary.
 * Returns { public_id, url } — public_id is stored in DB,
 * size variants are generated on-the-fly via Cloudinary URLs.
 */
export async function processAndUploadImage(buffer) {
  // Light pre-processing with Sharp: strip EXIF, normalize orientation
  const cleaned = await sharp(buffer)
    .rotate()           // auto-rotate from EXIF
    .jpeg({ quality: 92 })
    .toBuffer();

  return uploadProductImage(cleaned);
}

// ─── AVATAR → Supabase Storage (Sharp 200×200 WebP) ──────────────────────
async function uploadToStorage(bucket, filePath, buffer) {
  const { error } = await supabase.storage
    .from(bucket)
    .upload(filePath, buffer, { contentType: 'image/webp', upsert: true });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  const { data } = supabase.storage.from(bucket).getPublicUrl(filePath);
  return data.publicUrl;
}

/**
 * Avatar → 200×200 WebP → Supabase Storage
 * Overwrites previous avatar (upsert: true)
 */
export async function processAndUploadAvatar(buffer, sellerId) {
  const compressed = await sharp(buffer)
    .rotate()
    .resize(200, 200, { fit: 'cover', position: 'center' })
    .webp({ quality: 85 })
    .toBuffer();

  return uploadToStorage(PROFILE_BUCKET, `avatars/${sellerId}.webp`, compressed);
}

/**
 * Cover → 1200×400 WebP → Supabase Storage
 * Overwrites previous cover (upsert: true)
 */
export async function processAndUploadCover(buffer, sellerId) {
  const compressed = await sharp(buffer)
    .rotate()
    .resize(1200, 400, { fit: 'cover', position: 'center' })
    .webp({ quality: 82 })
    .toBuffer();

  return uploadToStorage(PROFILE_BUCKET, `covers/${sellerId}.webp`, compressed);
}
