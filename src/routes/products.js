import { Router } from 'express';
import { supabase } from '../supabase.js';
import { requireAuth } from '../middleware/auth.js';
import { cloudinaryUrl, deleteProductImage } from '../cloudinary.js';

const router = Router();

const PRODUCT_LIMIT_PER_SELLER = 50;
const DEFAULT_PAGE_SIZE = 12;

async function refreshProductStatuses() {
  try {
    await supabase.rpc('update_product_status');
  } catch {
    // non-fatal — status update best-effort
  }
}

function makeProductCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const rand = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `BN-${new Date().getFullYear()}-${rand}`;
}

/**
 * Format a product row for the frontend.
 * cloudinary_ids is an array of Cloudinary public_ids.
 * We derive thumb/medium/full URLs at format time — nothing extra stored.
 */
function formatProduct(row, seller) {
  const ids = row.cloudinary_ids || [];

  // Build image variant objects from Cloudinary public_ids
  const imageVariants = ids.map((id) => ({
    thumb:  cloudinaryUrl(id, 'thumb'),
    medium: cloudinaryUrl(id, 'medium'),
    full:   cloudinaryUrl(id, 'full'),
  }));

  // Legacy images[] = medium URLs (backward compat with any component using images[0])
  const images = imageVariants.map((v) => v.medium);

  return {
    id:             row.id,
    name:           row.name,
    price:          Number(row.price),
    description:    row.description,
    images,
    imageVariants,
    cloudinaryIds:  ids,
    category:       row.category,
    productCode:    row.product_code,
    sellerId:       row.seller_id,
    sellerName:     seller?.shop_name || '',
    sellerAvatar:   seller?.avatar    || '',
    sellerSlug:     seller?.slug      || '',
    sellerVerified: seller?.verified  || false,
    sellerPhone:    seller?.phone      || '',
    country:        row.country       || seller?.country   || '',
    location:       row.location      || seller?.location  || '',
    createdAt:      row.created_at?.split('T')[0] || '',
    expiresAt:      row.expires_at?.split('T')[0] || '',
    status:         row.status,
    views:          row.views          || 0,
    whatsappClicks: row.whatsapp_clicks || 0,
    featured:       row.featured        || false,
  };
}

// ─── GET /api/products ─────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    await refreshProductStatuses();

    const { search, category, sort, sellerId, country, featured } = req.query;
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || DEFAULT_PAGE_SIZE);
    const from  = (page - 1) * limit;
    const to    = from + limit - 1;

    let query = supabase
      .from('products')
      .select(`*, sellers!inner(id, shop_name, avatar, slug, verified, location, country, phone)`, { count: 'exact' });

    if (sellerId) {
      query = query.eq('seller_id', sellerId);
    } else {
      query = query.neq('status', 'expired');
    }

    if (category && category !== 'All') query = query.eq('category', category);
    if (country  && country  !== 'all') query = query.ilike('country', country);
    if (featured === 'true') query = query.eq('featured', true);

    if      (sort === 'price-low')  query = query.order('price',   { ascending: true  });
    else if (sort === 'price-high') query = query.order('price',   { ascending: false });
    else if (sort === 'popular')    query = query.order('views',   { ascending: false });
    else                            query = query.order('created_at', { ascending: false });

    query = query.range(from, to);

    const { data: rows, error, count } = await query;

    if (error) {
      console.error('getProducts error:', error);
      return res.status(500).json({ error: 'Failed to fetch products' });
    }

    let products = (rows || []).map((row) => formatProduct(row, row.sellers));

    if (search) {
      const q = search.toLowerCase();
      products = products.filter((p) =>
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.sellerName.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
      );
    }

    res.json({
      products,
      pagination: { page, limit, total: count || 0, hasMore: (count || 0) > page * limit },
    });
  } catch (err) {
    console.error('getProducts crash:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── GET /api/products/:id ─────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const { data: row, error } = await supabase
      .from('products')
      .select(`*, sellers!inner(id, shop_name, avatar, slug, verified, location, country, phone)`)
      .eq('id', req.params.id)
      .single();

    if (error || !row) return res.status(404).json({ error: 'Product not found' });

    // Increment views directly on products table
    const newViews = (row.views || 0) + 1;
    const { error: viewsErr } = await supabase
      .from('products')
      .update({ views: newViews })
      .eq('id', row.id);
    if (viewsErr) console.error('❌ views update error:', viewsErr.message);

    // Log to views_log for per-day analytics
    const today = new Date().toISOString().split('T')[0];
    const { data: existingView, error: selectErr } = await supabase
      .from('views_log')
      .select('id, count')
      .eq('product_id', row.id)
      .eq('viewed_at', today)
      .maybeSingle();

    if (selectErr) {
      console.error('❌ views_log select error:', selectErr.message);
    } else if (existingView) {
      const { error: updErr } = await supabase
        .from('views_log')
        .update({ count: existingView.count + 1 })
        .eq('id', existingView.id);
      if (updErr) console.error('❌ views_log update error:', updErr.message);
    } else {
      const { error: insErr } = await supabase
        .from('views_log')
        .insert({ product_id: row.id, seller_id: row.seller_id, viewed_at: today, count: 1 });
      if (insErr) console.error('❌ views_log insert error:', insErr.message);
    }

    // View milestone notification (every 10 views)
    if (newViews % 10 === 0) {
      try {
        await supabase.from('notifications').insert({
          seller_id:  row.seller_id,
          type:       'view',
          title:      'Product milestone 🎉',
          message:    `"${row.name}" just hit ${newViews} views!`,
          product_id: row.id,
        });
      } catch { /* non-fatal */ }
    }

    res.json(formatProduct({ ...row, views: newViews }, row.sellers));
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/products ────────────────────────────────────────────────────
router.post('/', requireAuth, async (req, res) => {
  try {
    const { name, price, description, cloudinaryIds, category, location } = req.body;

    if (!name || !price || !description || !category) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // 50-product limit
    const { count: existingCount } = await supabase
      .from('products')
      .select('*', { count: 'exact', head: true })
      .eq('seller_id', req.user.id)
      .neq('status', 'expired');

    if ((existingCount || 0) >= PRODUCT_LIMIT_PER_SELLER) {
      return res.status(429).json({
        error: `You've reached the ${PRODUCT_LIMIT_PER_SELLER} active product limit. Delete or let some expire first.`,
      });
    }

    const { data: seller } = await supabase
      .from('sellers')
      .select('id, shop_name, avatar, slug, verified, location, country')
      .eq('id', req.user.id)
      .single();

    let product_code;
    for (let i = 0; i < 5; i++) {
      product_code = makeProductCode();
      const { data: exists } = await supabase
        .from('products').select('id').eq('product_code', product_code).single();
      if (!exists) break;
    }

    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: product, error } = await supabase
      .from('products')
      .insert({
        name,
        price:           parseFloat(price),
        description,
        cloudinary_ids:  cloudinaryIds || [],
        category,
        product_code,
        seller_id:       req.user.id,
        country:         seller?.country  || '',
        location:        location || seller?.location || '',
        expires_at:      expiresAt,
        status:          'active',
        views:           0,
        whatsapp_clicks: 0,
        featured:        false,
      })
      .select()
      .single();

    if (error) {
      console.error('createProduct error:', error);
      return res.status(500).json({ error: 'Failed to create product' });
    }

    try {
      await supabase.from('activity_log').insert({
        seller_id:    req.user.id,
        type:         'product_added',
        message:      `New product listed: ${name}`,
        product_id:   product.id,
        product_name: name,
      });
    } catch { /* non-fatal */ }

    res.status(201).json(formatProduct(product, seller));
  } catch (err) {
    console.error('createProduct crash:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── PUT /api/products/:id ─────────────────────────────────────────────────
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const { data: existing } = await supabase
      .from('products').select('seller_id').eq('id', req.params.id).single();

    if (!existing) return res.status(404).json({ error: 'Product not found' });
    if (existing.seller_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { name, price, description, cloudinaryIds, category, location } = req.body;
    const updates = {};
    if (name          !== undefined) updates.name           = name;
    if (price         !== undefined) updates.price          = parseFloat(price);
    if (description   !== undefined) updates.description    = description;
    if (cloudinaryIds !== undefined) updates.cloudinary_ids = cloudinaryIds;
    if (category      !== undefined) updates.category       = category;
    if (location      !== undefined) updates.location       = location;

    const { data: row, error } = await supabase
      .from('products')
      .update(updates)
      .eq('id', req.params.id)
      .select(`*, sellers!inner(id, shop_name, avatar, slug, verified, location, country, phone)`)
      .single();

    if (error) return res.status(500).json({ error: 'Failed to update product' });
    res.json(formatProduct(row, row.sellers));
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── DELETE /api/products/:id ──────────────────────────────────────────────
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { data: existing } = await supabase
      .from('products')
      .select('seller_id, cloudinary_ids')
      .eq('id', req.params.id)
      .single();

    if (!existing) return res.status(404).json({ error: 'Product not found' });
    if (existing.seller_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Delete images from Cloudinary
    if (existing.cloudinary_ids?.length) {
      await Promise.all(existing.cloudinary_ids.map(deleteProductImage));
    }

    await supabase.from('products').delete().eq('id', req.params.id);
    res.json({ message: 'Product deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/products/:id/renew ──────────────────────────────────────────
router.post('/:id/renew', requireAuth, async (req, res) => {
  try {
    const { data: existing } = await supabase
      .from('products').select('seller_id, name').eq('id', req.params.id).single();

    if (!existing) return res.status(404).json({ error: 'Product not found' });
    if (existing.seller_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const newExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: row, error } = await supabase
      .from('products')
      .update({ expires_at: newExpiry, status: 'active' })
      .eq('id', req.params.id)
      .select(`*, sellers!inner(id, shop_name, avatar, slug, verified, location, country, phone)`)
      .single();

    if (error) return res.status(500).json({ error: 'Failed to renew product' });

    try {
      await supabase.from('activity_log').insert({
        seller_id:    req.user.id,
        type:         'product_renewed',
        message:      `Product renewed: ${existing.name}`,
        product_id:   req.params.id,
        product_name: existing.name,
      });
    } catch { /* non-fatal */ }

    res.json(formatProduct(row, row.sellers));
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/products/:id/whatsapp-click ────────────────────────────────
router.post('/:id/whatsapp-click', async (req, res) => {
  try {
    const { data: row } = await supabase
      .from('products')
      .select('seller_id, name, whatsapp_clicks')
      .eq('id', req.params.id)
      .single();

    if (row) {
      const newClicks = (row.whatsapp_clicks || 0) + 1;

      // Increment directly on products table
      await supabase
        .from('products')
        .update({ whatsapp_clicks: newClicks })
        .eq('id', req.params.id);

      // Log to clicks_log for per-day analytics
      const clickToday = new Date().toISOString().split('T')[0];
      const { data: existingClick, error: clickSelectErr } = await supabase
        .from('clicks_log')
        .select('id, count')
        .eq('product_id', req.params.id)
        .eq('clicked_at', clickToday)
        .maybeSingle();

      if (clickSelectErr) {
        console.error('❌ clicks_log select error:', clickSelectErr.message);
      } else if (existingClick) {
        const { error: clickUpdErr } = await supabase
          .from('clicks_log')
          .update({ count: existingClick.count + 1 })
          .eq('id', existingClick.id);
        if (clickUpdErr) console.error('❌ clicks_log update error:', clickUpdErr.message);
      } else {
        const { error: clickInsErr } = await supabase
          .from('clicks_log')
          .insert({ product_id: req.params.id, seller_id: row.seller_id, clicked_at: clickToday, count: 1 });
        if (clickInsErr) console.error('❌ clicks_log insert error:', clickInsErr.message);
      }

      // products.whatsapp_clicks already incremented above

      // Insert into activity_log so it shows in Recent Activity
      const { error: actErr } = await supabase.from('activity_log').insert({
        seller_id:    row.seller_id,
        type:         'click',
        message:      `💬 WhatsApp inquiry on "${row.name}"`,
        product_id:   req.params.id,
        product_name: row.name,
      });
      if (actErr) console.error('❌ activity_log click error:', actErr.message);
    }

    res.json({ message: 'Click recorded' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
