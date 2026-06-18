import { Router } from 'express';
import { supabase } from '../supabase.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// ─── GET /api/dashboard/stats ──────────────────────────────────────────────
router.get('/stats', requireAuth, async (req, res) => {
  try {
    try { await supabase.rpc('update_product_status'); } catch { /* non-fatal */ }

    const sellerId = req.user.id;

    const { data: products } = await supabase
      .from('products')
      .select('id, status, views, whatsapp_clicks')
      .eq('seller_id', sellerId);

    const all = products || [];
    const totalViews      = all.reduce((s, p) => s + (p.views || 0), 0);
    const totalClicks     = all.reduce((s, p) => s + (p.whatsapp_clicks || 0), 0);
    const totalProducts   = all.length;
    const activeProducts  = all.filter((p) => p.status === 'active').length;
    const expiredProducts = all.filter((p) => p.status === 'expired').length;
    const expiringSoon    = all.filter((p) => p.status === 'expiring').length;

    const { data: activity } = await supabase
      .from('activity_log')
      .select('*')
      .eq('seller_id', sellerId)
      .order('created_at', { ascending: false })
      .limit(10);

    const recentActivity = (activity || []).map((a) => ({
      id:          a.id,
      type:        a.type,
      message:     a.message,
      productId:   a.product_id,
      productName: a.product_name,
      timestamp:   a.created_at,
    }));

    res.json({ totalProducts, totalViews, totalClicks, activeProducts, expiredProducts, expiringSoon, recentActivity });
  } catch (err) {
    console.error('dashboardStats error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── GET /api/dashboard/analytics ─────────────────────────────────────────
router.get('/analytics', requireAuth, async (req, res) => {
  try {
    const sellerId = req.user.id;
    const days = parseInt(req.query.days) || 30;

    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceStr = since.toISOString().split('T')[0];

    // Per-day views from views_log
    const { data: viewsLog } = await supabase
      .from('views_log')
      .select('viewed_at, count')
      .eq('seller_id', sellerId)
      .gte('viewed_at', sinceStr)
      .order('viewed_at', { ascending: true });

    // Per-day clicks from clicks_log
    const { data: clicksLog } = await supabase
      .from('clicks_log')
      .select('clicked_at, count')
      .eq('seller_id', sellerId)
      .gte('clicked_at', sinceStr)
      .order('clicked_at', { ascending: true });

    // Build full date range (fill zeros for missing days)
    const allDays = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      allDays.push(d.toISOString().split('T')[0]);
    }

    const viewsByDay  = Object.fromEntries((viewsLog  || []).map((r) => [r.viewed_at,  r.count]));
    const clicksByDay = Object.fromEntries((clicksLog || []).map((r) => [r.clicked_at, r.count]));

    const pageViews      = allDays.map((date) => ({ date, views:  viewsByDay[date]  || 0 }));
    const whatsappClicks = allDays.map((date) => ({ date, clicks: clicksByDay[date] || 0 }));

    // Top products by total views — read directly from products table
    const { data: products } = await supabase
      .from('products')
      .select('id, name, views, whatsapp_clicks')
      .eq('seller_id', sellerId)
      .order('views', { ascending: false })
      .limit(8);

    const all = products || [];
    const productViews = all.map((p) => ({
      name:  p.name.length > 22 ? p.name.slice(0, 22) + '…' : p.name,
      views: p.views || 0,
    }));

    // Totals from products table (source of truth)
    const totalViews   = all.reduce((s, p) => s + (p.views || 0), 0);
    const totalClicks  = all.reduce((s, p) => s + (p.whatsapp_clicks || 0), 0);
    const topProduct   = all[0]?.name || 'N/A';
    const uniqueVisitors = Math.floor(totalViews * 0.65);

    res.json({
      pageViews,
      productViews,
      whatsappClicks,
      summary: { totalViews, totalClicks, uniqueVisitors, topProduct },
    });
  } catch (err) {
    console.error('analytics error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── GET /api/dashboard/notifications ─────────────────────────────────────
router.get('/notifications', requireAuth, async (req, res) => {
  try {
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('seller_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(50);

    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── PUT /api/dashboard/notifications/:id/read ────────────────────────────
router.put('/notifications/:id/read', requireAuth, async (req, res) => {
  try {
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('id', req.params.id)
      .eq('seller_id', req.user.id);
    res.json({ message: 'Marked as read' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── PUT /api/dashboard/notifications/read-all ────────────────────────────
router.put('/notifications/read-all', requireAuth, async (req, res) => {
  try {
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('seller_id', req.user.id)
      .eq('read', false);
    res.json({ message: 'All marked as read' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── GET /api/dashboard/live-stats ────────────────────────────────────────
// Lightweight — polled every 30s from frontend for live counts
router.get('/live-stats', requireAuth, async (req, res) => {
  try {
    const { data: products } = await supabase
      .from('products')
      .select('views, whatsapp_clicks')
      .eq('seller_id', req.user.id);

    const all         = products || [];
    const totalViews  = all.reduce((s, p) => s + (p.views || 0), 0);
    const totalClicks = all.reduce((s, p) => s + (p.whatsapp_clicks || 0), 0);

    res.json({ totalViews, totalClicks, updatedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;