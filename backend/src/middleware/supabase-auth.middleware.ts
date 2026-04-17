import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

/**
 * Supabase JWT payload shape (minimal fields we care about).
 * Tokens are signed with the SUPABASE_JWT_SECRET from Supabase project settings.
 */
interface SupabaseJWTPayload {
  sub: string;       // user id
  email?: string;
  phone?: string;
  role?: string;     // always 'authenticated' for signed-in users
  aud?: string;      // 'authenticated'
  iat?: number;
  exp?: number;
}

export interface SupabaseAuthRequest extends Request {
  supabaseUser?: {
    id: string;
    email?: string;
    phone?: string;
  };
}

/**
 * Require a valid Supabase JWT in the Authorization header.
 * Does NOT enforce role (driver vs dispatcher) — that's a later concern.
 * Verifies signature + expiry using SUPABASE_JWT_SECRET.
 */
export const requireSupabaseAuth = async (
  req: SupabaseAuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      res.status(401).json({ error: 'No authorization header' });
      return;
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      res.status(401).json({ error: 'Malformed authorization header. Expected: Bearer <token>' });
      return;
    }

    const token = parts[1];
    const secret = process.env.SUPABASE_JWT_SECRET;
    if (!secret) {
      console.error('[supabase-auth] SUPABASE_JWT_SECRET is not set');
      res.status(500).json({ error: 'Server configuration error' });
      return;
    }

    const payload = jwt.verify(token, secret) as SupabaseJWTPayload;

    req.supabaseUser = {
      id: payload.sub,
      email: payload.email,
      phone: payload.phone,
    };

    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: 'Token expired' });
      return;
    }
    if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }
    res.status(401).json({ error: 'Authentication failed' });
  }
};
