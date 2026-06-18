import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.js';
import {
  processAndUploadImage,
  processAndUploadAvatar,
  processAndUploadCover,
} from '../upload.js';
import { supabase } from '../supabase.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed'));
    }
    cb(null, true);
  },
});

/**
 * POST /api/upload/image
 * Single product image → Cloudinary
 * Returns { public_id, url }
 */
router.post('/image', requireAuth, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image file provided' });
    const result = await processAndUploadImage(req.file.buffer);
    res.json(result);
  } catch (err) {
    console.error('Image upload error:', err);
    res.status(500).json({ error: err.message || 'Image upload failed' });
  }
});

/**
 * POST /api/upload/images
 * Exactly 1 product image per product → Cloudinary
 * Returns array of { public_id, url } (kept as array for frontend compat)
 */
router.post('/images', requireAuth, upload.array('images', 1), async (req, res) => {
  try {
    if (!req.files?.length) return res.status(400).json({ error: 'No image file provided' });
    if (req.files.length > 1) return res.status(400).json({ error: 'Only 1 image is allowed per product' });

    const results = await Promise.all(
      req.files.map((f) => processAndUploadImage(f.buffer))
    );
    res.json(results); // [{ public_id, url }]
  } catch (err) {
    console.error('Image upload error:', err);
    res.status(500).json({ error: err.message || 'Image upload failed' });
  }
});

/**
 * POST /api/upload/avatar
 * Seller avatar → Sharp 200×200 WebP → Supabase Storage
 * Saves URL directly to sellers table
 * Returns { url }
 */
router.post('/avatar', requireAuth, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No avatar file provided' });

    const url = await processAndUploadAvatar(req.file.buffer, req.user.id);
    await supabase.from('sellers').update({ avatar: url }).eq('id', req.user.id);

    res.json({ url });
  } catch (err) {
    console.error('Avatar upload error:', err);
    res.status(500).json({ error: err.message || 'Avatar upload failed' });
  }
});

/**
 * POST /api/upload/cover
 * Shop cover → Sharp 1200×400 WebP → Supabase Storage
 * Saves URL directly to sellers table
 * Returns { url }
 */
router.post('/cover', requireAuth, upload.single('cover'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No cover file provided' });

    const url = await processAndUploadCover(req.file.buffer, req.user.id);
    await supabase.from('sellers').update({ cover: url }).eq('id', req.user.id);

    res.json({ url });
  } catch (err) {
    console.error('Cover upload error:', err);
    res.status(500).json({ error: err.message || 'Cover upload failed' });
  }
});

export default router;