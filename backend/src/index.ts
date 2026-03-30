// src/index.ts
import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.routes';
import syncRoutes from './routes/sync.routes';
import brokerIntelligenceRoutes from './routes/broker-intelligence.routes';
import outreachRoutes from './routes/outreach.routes';
import profitEngineRoutes from './routes/profit-engine.routes';
import loadOptimizerRoutes from './routes/load-optimizer.routes';
import expenseRoutes from './routes/expense.routes';
import fleetFinancialsRoutes from './routes/fleet-financials';
import rankLoadsRouter from './routes/dispatch.routes';
import dispatchEngineRoutes from './routes/dispatch-engine.routes';
import dispatchDevRouter from './routes/dispatch-dev.routes';
import { authenticateToken } from './middleware/auth.middleware';
import { tenantScope } from './middleware/tenant.middleware';
// Rigby routes
import rigbyRoutes from './routes/rigby';
import fleetRoutes from './routes/fleet';
import uploadRoutes from './routes/upload';
import { PollingScheduler } from './services/scheduler/polling.service';

dotenv.config();

const app: Express = express();
const PORT = process.env.PORT || 3000;

// ============ Middleware (PROPER ORDER!) ============
app.use(helmet());

// Dev-only: OPTIONS preflight for /api/dev/* must be intercepted before the
// general CORS middleware (which hardcodes a single allowed origin).
if (process.env.NODE_ENV !== 'production') {
  app.options('/api/dev/*', (_req: Request, res: Response) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    res.sendStatus(200);
  });
}

// CORS - MUST come before routes!
app.use(cors({
  origin: (origin, callback) => {
    // Allow file:// (origin is null/undefined), any localhost, and the configured frontend URL
    if (!origin || origin === 'null' || origin.startsWith('http://localhost') || origin === process.env.FRONTEND_URL) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Extension-Key'],
}));

// Additional CORS headers for compatibility
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin || origin === 'null' || origin.startsWith('http://localhost') || origin === process.env.FRONTEND_URL) {
    res.header('Access-Control-Allow-Origin', origin || '*');
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS'); // ADD PATCH
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Extension-Key');
  res.header('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Body parsers
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Request logging
app.use((req: Request, res: Response, next: NextFunction) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// ============ Routes ============
app.get('/', (req: Request, res: Response) => {
  res.json({
    name: 'TrueMile.AI API',
    version: '1.0.0',
    status: 'running'
  });
});

app.get('/health', (req: Request, res: Response) => {
  res.json({ 
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

// API routes (after CORS!)
app.use('/api/auth', authRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/broker-intelligence', brokerIntelligenceRoutes);
app.use('/api/outreach', outreachRoutes);
app.use('/api/profit-engine', profitEngineRoutes);
app.use('/api/optimizer', loadOptimizerRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/profit', expenseRoutes);
app.use('/api/fleet-financials', fleetFinancialsRoutes);

// Rigby routes
app.use('/api/rigby', rigbyRoutes);
app.use('/api/fleet', fleetRoutes);
app.use('/api/upload', uploadRoutes);

// Dispatch routes
app.use('/api/dispatch', authenticateToken, tenantScope, rankLoadsRouter);
app.use('/api', dispatchEngineRoutes);

// Dev-only unauthenticated dispatch route (CORS: *)
if (process.env.NODE_ENV !== 'production') {
  app.use('/api/dev/dispatch', (_req: Request, res: Response, next: NextFunction) => {
    res.header('Access-Control-Allow-Origin', '*');
    next();
  }, dispatchDevRouter);
}

// ============ Error Handling ============
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Route not found' });
});

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// ============ Server Startup ============
const server = app.listen(PORT, () => {
  console.log(`\n🚀 TrueMile.AI API Server`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health\n`);
  
  PollingScheduler.start();
});

// ============ Graceful Shutdown ============
const gracefulShutdown = (signal: string) => {
  console.log(`\n${signal} received, shutting down gracefully...`);
  
  PollingScheduler.stop();
  
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
  
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export default app;