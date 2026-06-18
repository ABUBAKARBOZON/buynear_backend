import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { supabase } from '../supabase.js';
import { requireAuth } from '../middleware/auth.js';
import { sendVerificationEmail } from '../email.js';

const router = Router();

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

/**
 * Slug: shopname-country-location
 * e.g. "Kings Electronics", Nigeria, Lagos → kings-electronics-nigeria-lagos
 * Same combo gets a counter: kings-electronics-nigeria-lagos-2
 */
function cleanPart(s) {
  return s.toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function makeSlug(shopName, country = '', location = '') {
  const parts = [cleanPart(shopName), cleanPart(country), cleanPart(location)]
    .filter(Boolean);
  return parts.join('-');
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function formatUser(seller, token) {
  return {
    id:            seller.id,
    shopName:      seller.shop_name,
    slug:          seller.slug,
    email:         seller.email,
    avatar:        seller.avatar || '',
    role:          seller.role,
    emailVerified: seller.email_verified ?? true,
    token,
  };
}

async function createAndSendVerificationToken(seller) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24h

  const { error: insertErr } = await supabase
    .from('email_verification_tokens')
    .insert({
      seller_id:  seller.id,
      token,
      expires_at: expiresAt,
    });

  if (insertErr) {
    console.error('❌ Failed to insert verification token:', insertErr.message);
    throw new Error(`Could not create verification token: ${insertErr.message}`);
  }

  const verifyUrl = `${FRONTEND_URL}/verify-email?token=${token}`;
  await sendVerificationEmail(seller.email, seller.shop_name, verifyUrl).catch((err) => {
    console.error('Failed to send verification email:', err.message);
  });
}

// ─── POST /api/auth/signup ─────────────────────────────────────────────────
router.post('/signup', async (req, res) => {
  try {
    const { shopName, fullName, country, location, email, phone, password } = req.body;

    if (!shopName || !fullName || !email || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    if (!country?.trim()) {
      return res.status(400).json({ error: 'Country is required' });
    }
    if (!location?.trim()) {
      return res.status(400).json({ error: 'Location/city is required' });
    }

    const { data: existing } = await supabase
      .from('sellers')
      .select('id')
      .eq('email', email.toLowerCase())
      .single();

    if (existing) {
      return res.status(409).json({ error: 'Email already in use' });
    }

    const baseSlug = makeSlug(shopName, country, location);

    const { data: slugExists } = await supabase
      .from('sellers')
      .select('id')
      .eq('slug', baseSlug)
      .single();

    if (slugExists) {
      return res.status(409).json({
        error: `A shop with that name already exists in ${location}, ${country}. Please change your shop name or use a more specific location (e.g. "Lagos Island" instead of "Lagos").`,
      });
    }

    const password_hash = await bcrypt.hash(password, 10);

    const { data: seller, error } = await supabase
      .from('sellers')
      .insert({
        shop_name:      shopName,
        slug:           baseSlug,
        full_name:      fullName,
        email:          email.toLowerCase(),
        password_hash,
        country:        country.trim(),
        location:       location.trim(),
        phone:          phone || '',
        role:           'seller',
        verified:       false,
        email_verified: false,
      })
      .select()
      .single();

    if (error) {
      console.error('Signup DB error:', error);
      return res.status(500).json({ error: 'Failed to create account' });
    }

    // Fire off verification email (non-blocking failure — account still created)
    await createAndSendVerificationToken(seller);

    const token = signToken(seller);
    res.status(201).json(formatUser(seller, token));
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Server error during signup' });
  }
});

// ─── POST /api/auth/login ──────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const { data: seller, error } = await supabase
      .from('sellers')
      .select('*')
      .eq('email', email.toLowerCase())
      .single();

    if (error || !seller) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const valid = await bcrypt.compare(password, seller.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Block login until email is confirmed (admin account is exempt)
    if (seller.role !== 'admin' && !seller.email_verified) {
      return res.status(403).json({
        error: 'Please confirm your email before logging in. Check your inbox (or spam folder) for the verification link.',
        code: 'EMAIL_NOT_VERIFIED',
      });
    }

    const token = signToken(seller);
    res.json(formatUser(seller, token));
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error during login' });
  }
});

// ─── GET /api/auth/verify-email?token=... ─────────────────────────────────
router.get('/verify-email', async (req, res) => {
  try {
    const { token } = req.query;
    console.log('🔍 verify-email called with token:', token);

    if (!token) return res.status(400).json({ error: 'Missing token' });

    const { data: record, error } = await supabase
      .from('email_verification_tokens')
      .select('*')
      .eq('token', token)
      .single();

    console.log('🔍 lookup result — error:', error?.message || null, '| record:', record ? { id: record.id, used: record.used, expires_at: record.expires_at } : null);

    if (error || !record) {
      return res.status(400).json({ error: 'Invalid or already-used verification link' });
    }
    if (record.used) {
      console.log('🔍 rejected: token already used');
      return res.status(400).json({ error: 'This verification link has already been used' });
    }
    if (new Date(record.expires_at) < new Date()) {
      console.log('🔍 rejected: token expired at', record.expires_at, 'now is', new Date().toISOString());
      return res.status(400).json({ error: 'This verification link has expired. Please request a new one.' });
    }

    // Mark seller verified + token used
    await supabase.from('sellers').update({ email_verified: true }).eq('id', record.seller_id);
    await supabase.from('email_verification_tokens').update({ used: true }).eq('id', record.id);

    res.json({ message: 'Email verified successfully' });
  } catch (err) {
    console.error('verify-email error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/auth/resend-verification ───────────────────────────────────
router.post('/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const { data: seller } = await supabase
      .from('sellers')
      .select('*')
      .eq('email', email.toLowerCase())
      .single();

    // Don't reveal whether the email exists — respond the same either way
    if (!seller || seller.email_verified) {
      return res.json({ message: 'If an unverified account exists for this email, a new link has been sent.' });
    }

    await createAndSendVerificationToken(seller);
    res.json({ message: 'If an unverified account exists for this email, a new link has been sent.' });
  } catch (err) {
    console.error('resend-verification error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── GET /api/auth/me ──────────────────────────────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  try {
    const { data: seller } = await supabase
      .from('sellers')
      .select('*')
      .eq('id', req.user.id)
      .single();

    if (!seller) return res.status(404).json({ error: 'User not found' });
    const token = signToken(seller);
    res.json(formatUser(seller, token));
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/auth/change-password ───────────────────────────────────────
router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: 'Both passwords required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    const { data: seller } = await supabase
      .from('sellers')
      .select('password_hash')
      .eq('id', req.user.id)
      .single();

    const valid = await bcrypt.compare(oldPassword, seller.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const password_hash = await bcrypt.hash(newPassword, 10);
    await supabase.from('sellers').update({ password_hash }).eq('id', req.user.id);

    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;