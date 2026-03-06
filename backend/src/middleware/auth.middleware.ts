import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

interface JWTPayload {
  sub: string;       // userId
  email: string;
  carrierId: string; // CRITICAL for multi-tenant isolation
  iat?: number;
  exp?: number;
}

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    carrierId: string;
  };
}

export const authenticateToken = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
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
    const secret = process.env.JWT_SECRET;

    if (!secret) {
      console.error('JWT_SECRET is not set');
      res.status(500).json({ error: 'Server configuration error' });
      return;
    }

    const payload = jwt.verify(token, secret) as JWTPayload;

    if (!payload.carrierId) {
      res.status(401).json({ error: 'Token missing carrierId — cannot determine tenant' });
      return;
    }

    req.user = {
      id: payload.sub,
      email: payload.email,
      carrierId: payload.carrierId,
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
