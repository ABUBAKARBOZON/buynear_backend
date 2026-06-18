import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import authRoutes      from './routes/auth.js';
import productsRoutes  from './routes/products.js';
import sellersRoutes   from './routes/sellers.js';
import dashboardRoutes from './routes/dashboard.js';
import adminRoutes     from './routes/admin.js';
import uploadRoutes    from './routes/upload.js';
import messagesRoutes  from './routes/messages.js';

const app  = express();
const PORT = process.env.PORT || 3000;

const allowedOrigins = [
  'http://localhost:3000',
  'https://buynear-frontend.vercel.app',
  'https://buynear.store',
  'https://www.buynear.store'
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, Postman, or curl)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      return callback(null, true);
    } else {
      return callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));

// JSON body (for most routes). Upload routes use multipart — multer handles that.
app.use(express.json({ limit: '10mb' }));

app.use('/api/auth',      authRoutes);
app.use('/api/products',  productsRoutes);
app.use('/api/sellers',   sellersRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/admin',     adminRoutes);
app.use('/api/upload',    uploadRoutes);
app.use('/api/messages',  messagesRoutes);

app.get('/api/health', (_, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

app.use((req, res) => res.status(404).json({ error: `Route ${req.method} ${req.path} not found` }));
app.use((err, req, res, next) => {
  console.error('Unhandled:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`\n🚀 BuyNear API → http://localhost:${PORT}`);
});
