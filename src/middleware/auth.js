import jwt from 'jsonwebtoken';
import { supabase } from '../supabase.js';

export async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Verify seller still exists in DB
    const { data: seller, error } = await supabase
      .from('sellers')
      .select('id, email, shop_name, avatar, role, verified')
      .eq('id', decoded.id)
      .single();

    if (error || !seller) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    req.user = seller;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}
