import { Router } from 'express';
import { supabase } from '../supabase.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

// All admin routes require auth + admin role
router.use(requireAuth, requireAdmin);

function formatSeller(row) {
  return {
    id: row.id,
    shopName: row.shop_name,
    slug: row.slug,
    fullName: row.full_name,
    email: row.email,
    avatar: row.avatar || '',
    cover: row.cover || '',
    verified: row.verified || false,
    location: row.location || '',
    address: row.address || '',
    phone: row.phone || '',
    bio: row.bio || '',
    products: 0,
    rating: Number(row.rating) || 0,
    joinedAt: row.joined_at?.split('T')[0] || '',
    categories: [],
    socialLinks: {
      instagram: row.instagram || undefined,
      facebook: row.facebook || undefined,
    },
  };
}

function formatProduct(row) {
  return {
    id: row.id,
    name: row.name,
    price: Number(row.price),
    description: row.description,
    images: row.images || [],
    category: row.category,
    productCode: row.product_code,
    sellerId: row.seller_id,
    sellerName: row.sellers?.shop_name || '',
    sellerAvatar: row.sellers?.avatar || '',
    sellerSlug: row.sellers?.slug || '',
    sellerVerified: row.sellers?.verified || false,
    location: row.location || '',
    createdAt: row.created_at?.split('T')[0] || '',
    expiresAt: row.expires_at?.split('T')[0] || '',
    status: row.status,
    views: row.views || 0,
    whatsappClicks: row.whatsapp_clicks || 0,
    featured: row.featured || false,
  };
}

// ─── GET /api/admin/stats ──────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const { count: totalSellers } = await supabase
      .from('sellers')
      .select('*', { count: 'exact', head: true })
      .neq('role', 'admin');

    const { count: totalProducts } = await supabase
      .from('products')
      .select('*', { count: 'exact', head: true });

    const { data: viewData } = await supabase
      .from('products')
      .select('views');

    const totalViews = (viewData || []).reduce((s, p) => s + (p.views || 0), 0);

    const { count: pendingVerifications } = await supabase
      .from('sellers')
      .select('*', { count: 'exact', head: true })
      .eq('verified', false)
      .neq('role', 'admin');

    res.json({ totalSellers, totalProducts, totalViews, pendingVerifications });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── GET /api/admin/sellers ────────────────────────────────────────────────
router.get('/sellers', async (req, res) => {
  try {
    const { data: rows } = await supabase
      .from('sellers')
      .select('*')
      .neq('role', 'admin')
      .order('joined_at', { ascending: false });

    const { data: counts } = await supabase
      .from('products')
      .select('seller_id');

    const countMap = {};
    (counts || []).forEach((p) => {
      countMap[p.seller_id] = (countMap[p.seller_id] || 0) + 1;
    });

    const sellers = (rows || []).map((row) => ({
      ...formatSeller(row),
      products: countMap[row.id] || 0,
    }));

    res.json(sellers);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── PUT /api/admin/sellers/:id/verify ────────────────────────────────────
router.put('/sellers/:id/verify', async (req, res) => {
  try {
    const { verified } = req.body;

    const { data: row, error } = await supabase
      .from('sellers')
      .update({ verified: Boolean(verified) })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error || !row) return res.status(404).json({ error: 'Seller not found' });

    res.json(formatSeller(row));
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── DELETE /api/admin/sellers/:id ────────────────────────────────────────
router.delete('/sellers/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('sellers')
      .delete()
      .eq('id', req.params.id);

    if (error) return res.status(500).json({ error: 'Failed to delete seller' });

    res.json({ message: 'Seller deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── GET /api/admin/products ───────────────────────────────────────────────
router.get('/products', async (req, res) => {
  try {
    const { data: rows } = await supabase
      .from('products')
      .select(`*, sellers!inner(id, shop_name, avatar, slug, verified)`)
      .order('created_at', { ascending: false });

    res.json((rows || []).map(formatProduct));
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── PUT /api/admin/products/:id/feature ──────────────────────────────────
router.put('/products/:id/feature', async (req, res) => {
  try {
    const { featured } = req.body;

    const { data: row, error } = await supabase
      .from('products')
      .update({ featured: Boolean(featured) })
      .eq('id', req.params.id)
      .select(`*, sellers!inner(id, shop_name, avatar, slug, verified)`)
      .single();

    if (error || !row) return res.status(404).json({ error: 'Product not found' });

    res.json(formatProduct(row));
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── DELETE /api/admin/products/:id ───────────────────────────────────────
router.delete('/products/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('products')
      .delete()
      .eq('id', req.params.id);

    if (error) return res.status(500).json({ error: 'Failed to delete product' });

    res.json({ message: 'Product deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
