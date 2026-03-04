import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'path';
import MongoStore from 'connect-mongo';

// Import routes
import authRoutes from './routes/auth';
import roomRoutes from './routes/rooms';
import reservationRoutes from './routes/reservations';
import mediaRoutes from './routes/media';
import adminRoutes from './routes/admin';
import amenityRoutes from './routes/amenities';
import eventTypeRoutes from './routes/eventTypes';
import roleRoutes from './routes/roles';
import pricingRoutes from './routes/pricing';
import settingsRoutes from './routes/settings';
import companyRoutes from './routes/companies';
import guestRoutes from './routes/guests';
import creditAccountRoutes from './routes/creditAccounts';
import cashierClosureRoutes from './routes/cashierClosures';
import platformRoutes from './routes/platform';
import { syncUploadsToMedia } from './utils/mediaSync';
import { resolveTenant } from './middleware/tenantContext';
import Tenant from './models/Tenant';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Trust proxy (required for accurate IP behind proxies/load balancers)
app.set('trust proxy', 1);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});

// Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

// CORS: support multiple origins via CORS_ORIGINS or single FRONTEND_URL.
// In production also allow any *.pilloto.com subdomain and admin.pilloto.com.
const allowedOriginsEnv = (process.env.CORS_ORIGINS || process.env.FRONTEND_URL || 'http://localhost:3000')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const isPillotoSubdomain = (origin: string): boolean => {
  try {
    const url = new URL(origin);
    return url.hostname === 'pilloto.com' || url.hostname.endsWith('.pilloto.com');
  } catch {
    return false;
  }
};

// Allow any *.localhost origin in development (e.g. hotel.localhost:3000)
const isLocalhostSubdomain = (origin: string): boolean => {
  try {
    const url = new URL(origin);
    return url.hostname.endsWith('.localhost');
  } catch {
    return false;
  }
};

const allowedOrigins = allowedOriginsEnv;

app.use(cors({
  origin: (origin, callback) => {
    // Allow non-browser requests (no origin) like curl or server-to-server
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    if (isProd && isPillotoSubdomain(origin)) return callback(null, true);
    if (!isProd && isLocalhostSubdomain(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Tenant-Slug'],
}));

// Session configuration
app.use(cookieParser());
const isProd = process.env.NODE_ENV === 'production';
// Use persistent session store in production (MongoDB Atlas)
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/pilloto_pms';
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-super-secret-session-key-change-this-in-production',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: MONGO_URI,
    collectionName: 'sessions',
    ttl: 24 * 60 * 60, // 1 day
    autoRemove: 'native',
  }),
  cookie: {
    secure: isProd, // HTTPS only in production
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    // In production, allow cross-site cookie for Vercel -> Render requests
    sameSite: isProd ? 'none' : 'lax'
  },
  name: 'sessionId' // Don't use default session name
}));

app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static files for media uploads — serve per-tenant directory when tenantId prefix is present
// e.g. GET /uploads/6612abc.../image.jpg => uploads/<tenantId>/image.jpg
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '../uploads');
app.use('/uploads', (req, res, next) => {
  // Validate that the requested path stays within the uploads dir (path traversal guard)
  const requestedPath = path.join(UPLOADS_DIR, req.path);
  if (!requestedPath.startsWith(UPLOADS_DIR)) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }
  express.static(UPLOADS_DIR)(req, res, next);
});
// Static files for seed data images (serve from frontend public directory)
app.use('/images', express.static(path.join(__dirname, '../../frontend/public/images')));

// ── Tenant resolution middleware (runs before all API routes) ─────────────────
// Must come after cookie-parser and body-parser but before routes
app.use('/api', resolveTenant);

// Routes
app.use('/api/platform', platformRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/reservations', reservationRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/amenities', amenityRoutes);
app.use('/api/event-types', eventTypeRoutes);
app.use('/api/pricing', pricingRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/companies', companyRoutes);
app.use('/api/guests', guestRoutes);
app.use('/api/credit-accounts', creditAccountRoutes);
app.use('/api/cashier-closures', cashierClosureRoutes);

// Public endpoint: returns tenant info from the Host/X-Tenant-Slug header (no auth required)
app.get('/api/tenant/info', async (req, res) => {
  const host   = req.headers.host || '';
  const xSlug  = (req.headers['x-tenant-slug'] as string | undefined)?.trim().toLowerCase();

  // Resolve slug
  let slug: string | undefined = xSlug;
  if (!slug) {
    const hostname = host.split(':')[0];
    const parts = hostname.split('.');
    if (parts.length >= 3) slug = parts[0].toLowerCase();
    // local: slug.localhost
    else if (parts.length === 2 && parts[1] === 'localhost') slug = parts[0].toLowerCase();
  }
  if (!slug) slug = process.env.TENANT_SLUG;

  if (!slug || slug === 'admin') {
    return res.status(200).json({ success: true, data: null, isPlatform: true });
  }

  const tenant = await Tenant.findOne({ slug, isActive: true })
    .select('name slug plan settings isActive')
    .lean();

  if (!tenant) {
    return res.status(404).json({ success: false, message: 'Tenant not found.' });
  }

  res.status(200).json({ success: true, data: tenant });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    message: 'Pilloto API is running',
    timestamp: new Date().toISOString()
  });
});

app.use((req, res, next) => {
  if (req.path === '/health') return next();
  limiter(req, res, next);
})
//app.use(limiter);

// Render health check compatibility (alias)
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    message: 'Pilloto API is running',
    timestamp: new Date().toISOString()
  });
});

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({
    status: 'error',
    message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    status: 'error',
    message: 'Route not found'
  });
});

// Database connection
const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/pilloto_pms';
    await mongoose.connect(mongoURI);
    console.log('✅ MongoDB connected successfully');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
};

// Graceful shutdown — closes MongoDB connection before the process exits.
// Triggered by: SIGTERM (Render/Docker stop), SIGINT (Ctrl+C in dev).
const gracefulShutdown = (signal: string, server: ReturnType<typeof app.listen>) => {
  console.log(`\n${signal} received — shutting down gracefully…`);
  server.close(async () => {
    try {
      await mongoose.connection.close();
      console.log('MongoDB connection closed.');
    } catch (e) {
      console.error('Error closing MongoDB connection:', e);
    }
    process.exit(0);
  });
};

// Start server
const startServer = async () => {
  await connectDB();

  // Sync any files in uploads/ into Media collection so the library reflects all files
  try {
    const { created } = await syncUploadsToMedia();
    if (created > 0) {
      console.log(`🗂️  Synced ${created} media file(s) from uploads folder`);
    }
  } catch (e) {
    console.warn('Media sync skipped:', e);
  }

  const server = app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`📚 API Documentation: http://localhost:${PORT}/api/health`);
  });

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM', server));
  process.on('SIGINT',  () => gracefulShutdown('SIGINT',  server));
};

startServer().catch(console.error);

export default app;
