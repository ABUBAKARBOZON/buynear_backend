/**
 * Run this once to create/reset the admin account:
 *   node src/scripts/seed-admin.js
 *
 * Creates: admin@buynear.com / admin123
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { supabase } from '../supabase.js';

const ADMIN_EMAIL    = 'admin@buynear.com';
const ADMIN_PASSWORD = 'admin123';

async function seedAdmin() {
  console.log('🔐 Hashing password...');
  const password_hash = await bcrypt.hash(ADMIN_PASSWORD, 10);

  // Check if admin already exists
  const { data: existing } = await supabase
    .from('sellers')
    .select('id, email')
    .eq('email', ADMIN_EMAIL)
    .single();

  if (existing) {
    // Update password
    const { error } = await supabase
      .from('sellers')
      .update({ password_hash, role: 'admin', verified: true })
      .eq('email', ADMIN_EMAIL);

    if (error) {
      console.error('❌ Failed to update admin:', error.message);
      process.exit(1);
    }
    console.log(`✅ Admin password reset: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  } else {
    // Create fresh admin
    const { error } = await supabase
      .from('sellers')
      .insert({
        shop_name:     'BuyNear Admin',
        slug:          'buynear-admin',
        full_name:     'BuyNear Admin',
        email:         ADMIN_EMAIL,
        password_hash,
        role:          'admin',
        verified:      true,
        country:       '',
        location:      '',
      });

    if (error) {
      console.error('❌ Failed to create admin:', error.message);
      process.exit(1);
    }
    console.log(`✅ Admin created: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  }

  process.exit(0);
}

seedAdmin();
