import { Router } from 'express';
import { supabase } from '../supabase.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

/* ── Slug helpers (mirrors auth.js logic) ─────────────────────────────── */
function cleanPart(s) {
  return s.toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/, '');
}
function makeBaseSlug(shopName)            { return cleanPart(shopName); }
function makeLocationSlug(shopName, loc)   { return [cleanPart(shopName), cleanPart(loc)].filter(Boolean).join('-'); }

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
    country:  row.country  || '',
    location: row.location || '',
    address: row.address || '',
    phone: row.phone || '',
    bio: row.bio || '',
    products: row.product_count || 0,
    rating: Number(row.rating) || 0,
    joinedAt: row.joined_at?.split('T')[0] || '',
    categories: row.categories || [],
    socialLinks: {
      instagram: row.instagram || undefined,
      facebook: row.facebook || undefined,
    },
  };
}

// ─── GET /api/sellers ──────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { search, location, country } = req.query;
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 12);

    // Get sellers with product count
    let { data: rows, error } = await supabase
      .from('sellers')
      .select('*')
      .neq('role', 'admin')
      .order('joined_at', { ascending: false });

    if (error) return res.status(500).json({ error: 'Failed to fetch sellers' });

    // Get product counts per seller
    const { data: counts } = await supabase
      .from('products')
      .select('seller_id')
      .neq('status', 'expired');

    const countMap = {};
    (counts || []).forEach((p) => {
      countMap[p.seller_id] = (countMap[p.seller_id] || 0) + 1;
    });

    // Get categories per seller
    const { data: catRows } = await supabase
      .from('products')
      .select('seller_id, category')
      .neq('status', 'expired');

    const catMap = {};
    (catRows || []).forEach((p) => {
      if (!catMap[p.seller_id]) catMap[p.seller_id] = new Set();
      catMap[p.seller_id].add(p.category);
    });

    let sellers = (rows || []).map((row) => ({
      ...formatSeller(row),
      products: countMap[row.id] || 0,
      categories: catMap[row.id] ? [...catMap[row.id]] : [],
    }));

    if (search) {
      const q = search.toLowerCase();
      sellers = sellers.filter(
        (s) =>
          s.shopName.toLowerCase().includes(q) ||
          s.fullName.toLowerCase().includes(q) ||
          s.bio.toLowerCase().includes(q)
      );
    }

    if (location) {
      sellers = sellers.filter((s) =>
        s.location.toLowerCase().includes(location.toLowerCase())
      );
    }

    if (country && country !== 'all') {
      sellers = sellers.filter((s) =>
        s.country.toLowerCase() === country.toLowerCase()
      );
    }

    // Paginate the filtered results
    const total = sellers.length;
    const from  = (page - 1) * limit;
    const to    = from + limit;
    const paged = sellers.slice(from, to);

    res.json({
      sellers: paged,
      pagination: { page, limit, total, hasMore: total > page * limit },
    });
  } catch (err) {
    console.error('getSellers crash:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── GET /api/sellers/:slug ────────────────────────────────────────────────
router.get('/:slug', async (req, res) => {
  try {
    const { data: row, error } = await supabase
      .from('sellers')
      .select('*')
      .eq('slug', req.params.slug)
      .single();

    if (error || !row) return res.status(404).json({ error: 'Seller not found' });

    // Product count
    const { count } = await supabase
      .from('products')
      .select('*', { count: 'exact', head: true })
      .eq('seller_id', row.id)
      .neq('status', 'expired');

    // Categories
    const { data: cats } = await supabase
      .from('products')
      .select('category')
      .eq('seller_id', row.id)
      .neq('status', 'expired');

    const categories = [...new Set((cats || []).map((c) => c.category))];

    res.json({ ...formatSeller(row), products: count || 0, categories });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── PUT /api/sellers/profile/me ──────────────────────────────────────────
// When shopName changes we regenerate the slug (same priority: name → name-location).
// Returns { slugChanged: true, newSlug } in the response so the frontend can update the stored user.
router.put('/profile/me', requireAuth, async (req, res) => {
  try {
    const { shopName, fullName, bio, country, location, address, phone, instagram, facebook, avatar, cover } = req.body;

    // Fetch current seller so we can compare shop name + get location fallback
    const { data: current } = await supabase
      .from('sellers').select('shop_name, slug, location').eq('id', req.user.id).single();

    const updates = {};
    if (fullName  !== undefined) updates.full_name  = fullName;
    if (bio       !== undefined) updates.bio        = bio;
    if (location  !== undefined) updates.location   = location;
    if (address   !== undefined) updates.address    = address;
    if (phone     !== undefined) updates.phone      = phone;
    if (instagram !== undefined) updates.instagram  = instagram;
    if (facebook  !== undefined) updates.facebook   = facebook;
    if (avatar    !== undefined) updates.avatar     = avatar;
    if (cover     !== undefined) updates.cover      = cover;

    let slugChanged = false;
    let newSlug     = current?.slug;

    // Regenerate slug only when shop name actually changed
    if (shopName !== undefined) {
      updates.shop_name = shopName;

      const nameChanged = shopName.trim().toLowerCase() !== (current?.shop_name || '').trim().toLowerCase();
      if (nameChanged) {
        const loc      = location ?? current?.location ?? '';
        const base     = makeBaseSlug(shopName);
        const withLoc  = makeLocationSlug(shopName, loc);

        // Check base slug — exclude the current seller so they can "re-claim" their own
        const { data: baseRow } = await supabase
          .from('sellers').select('id').eq('slug', base).neq('id', req.user.id).single();

        if (!baseRow) {
          newSlug = base;
        } else {
          const { data: locRow } = await supabase
            .from('sellers').select('id').eq('slug', withLoc).neq('id', req.user.id).single();

          if (!locRow) {
            newSlug = withLoc;
          } else {
            return res.status(409).json({
              slugConflict: true,
              error: `The shop name "${shopName}" is already taken${withLoc !== base ? ` in ${loc}` : ''}. Please choose a different shop name.`,
            });
          }
        }

        updates.slug = newSlug;
        slugChanged  = newSlug !== current?.slug;
      }
    }

    const { data: row, error } = await supabase
      .from('sellers').update(updates).eq('id', req.user.id).select().single();

    if (error) return res.status(500).json({ error: 'Failed to update profile' });

    res.json({ ...formatSeller(row), slugChanged, newSlug });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/sellers/check-slug ────────────────────────────────────────
// Used by Signup page to show a live preview of the slug before submitting.
router.post('/check-slug', async (req, res) => {
  try {
    const { shopName, location } = req.body;
    if (!shopName) return res.status(400).json({ error: 'shopName required' });

    const base     = makeBaseSlug(shopName);
    const withLoc  = makeLocationSlug(shopName, location || '');

    const { data: baseRow } = await supabase.from('sellers').select('id').eq('slug', base).single();
    if (!baseRow) return res.json({ slug: base, conflict: false });

    const { data: locRow } = await supabase.from('sellers').select('id').eq('slug', withLoc).single();
    if (!locRow) return res.json({ slug: withLoc, conflict: 'name', fallback: true });

    return res.json({ slug: withLoc, conflict: 'both' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;