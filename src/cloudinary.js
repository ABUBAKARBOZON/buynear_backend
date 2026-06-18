import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';
dotenv.config();

if (!process.env.CLOUDINARY_CLOUD_NAME) {
  console.error('❌  Missing CLOUDINARY_CLOUD_NAME in .env');
  process.exit(1);
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure:     true,
});

/**
 * Upload a raw image buffer to Cloudinary under the buynear/products folder.
 * Returns the public_id which we store in the database.
 * All size variants are derived at request time via URL transforms — nothing
 * extra is stored; Cloudinary caches each transform automatically.
 *
 * Folder: buynear/products/{public_id}
 */
export async function uploadProductImage(buffer, originalName = 'product') {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder:          'buynear/products',
        resource_type:   'image',
        use_filename:    false,
        unique_filename: true,
        overwrite:       false,
        // Store as-is; transforms happen at URL time
        transformation:  [],
      },
      (error, result) => {
        if (error) return reject(new Error(error.message));
        resolve({
          public_id: result.public_id,       // stored in DB
          url:       result.secure_url,      // original URL
        });
      }
    );

    uploadStream.end(buffer);
  });
}

/**
 * Delete a product image from Cloudinary by public_id.
 * Called when a product is deleted.
 */
export async function deleteProductImage(publicId) {
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch {
    // non-fatal — log and continue
    console.warn(`Failed to delete Cloudinary asset: ${publicId}`);
  }
}

/**
 * Build a Cloudinary transform URL for a given public_id and size.
 *
 * Sizes:
 *   thumb  → 200×200 crop, quality auto:low  (~30 KB)
 *   medium → 600×600 fit,  quality auto:good (~200 KB)
 *   full   → 1200×1200 fit, quality auto:best (~500 KB–1 MB)
 *
 * format: webp is requested via f_webp
 * These URLs are CDN-cached by Cloudinary — first hit transforms + caches,
 * subsequent hits serve from edge.
 */
export function cloudinaryUrl(publicId, size = 'medium') {
  if (!publicId) return '';

  const transforms = {
    thumb: 'c_fill,g_auto,w_200,h_200,q_auto:low,f_webp',
    medium: 'c_fit,w_600,h_600,q_auto:good,f_webp',
    full:   'c_fit,w_1200,h_1200,q_auto:best,f_webp',
  };

  const t = transforms[size] || transforms.medium;
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  return `https://res.cloudinary.com/${cloudName}/image/upload/${t}/${publicId}`;
}

export { cloudinary };
