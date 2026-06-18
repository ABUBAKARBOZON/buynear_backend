import { Router } from 'express';
import { supabase } from '../supabase.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

// ─── POST /api/messages/contact ───────────────────────────────────────────
// Anyone can send a contact message from the About page (no auth needed)
router.post('/contact', async (req, res) => {
  try {
    const { name, email, message } = req.body;

    if (!name?.trim() || !email?.trim() || !message?.trim()) {
      return res.status(400).json({ error: 'Name, email and message are required' });
    }

    const { error } = await supabase.from('messages').insert({
      type:       'contact',
      from_name:  name.trim(),
      from_email: email.trim(),
      subject:    'Contact from About page',
      body:       message.trim(),
    });

    if (error) {
      console.error('contact message error:', error.message);
      return res.status(500).json({ error: 'Failed to send message' });
    }

    res.json({ message: 'Message sent successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── GET /api/messages/admin ───────────────────────────────────────────────
// Admin reads all contact messages from the About page
router.get('/admin', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('type', 'contact')
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── PUT /api/messages/:id/read ────────────────────────────────────────────
router.put('/:id/read', requireAuth, async (req, res) => {
  try {
    await supabase.from('messages').update({ read: true }).eq('id', req.params.id);
    res.json({ message: 'Marked as read' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/messages/send ───────────────────────────────────────────────
// Admin sends a message to a specific seller
router.post('/send', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { sellerId, subject, body } = req.body;

    if (!sellerId || !body?.trim()) {
      return res.status(400).json({ error: 'sellerId and body are required' });
    }

    // Verify seller exists
    const { data: seller, error: sellerErr } = await supabase
      .from('sellers')
      .select('id, shop_name')
      .eq('id', sellerId)
      .single();

    if (sellerErr || !seller) {
      return res.status(404).json({ error: 'Seller not found' });
    }

    // Save message
    const { error } = await supabase.from('messages').insert({
      type:      'admin_to_seller',
      seller_id: sellerId,
      subject:   subject?.trim() || 'Message from BuyNear Admin',
      body:      body.trim(),
    });

    if (error) {
      console.error('send message error:', error.message);
      return res.status(500).json({ error: 'Failed to send message' });
    }

    // Also insert into activity_log so it shows in seller's Recent Activity
    await supabase.from('activity_log').insert({
      seller_id:    sellerId,
      type:         'admin_message',
      message:      `📢 Admin: ${body.trim().slice(0, 100)}${body.length > 100 ? '…' : ''}`,
      product_name: subject?.trim() || 'Message from BuyNear Admin',
    });

    res.json({ message: `Message sent to ${seller.shop_name}` });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── GET /api/messages/inbox ───────────────────────────────────────────────
// Seller reads their messages from admin
router.get('/inbox', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('type',      'admin_to_seller')
      .eq('seller_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
