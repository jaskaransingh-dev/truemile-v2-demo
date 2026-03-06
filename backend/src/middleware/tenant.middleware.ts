import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth.middleware';

export const tenantScope = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  if (!req.user) {
    return res.status(403).json({
      success: false,
      error: 'Authentication required',
    });
  }

  if (!req.user.carrierId) {
    return res.status(403).json({
      success: false,
      error: 'No carrier context',
    });
  }

  // Make carrierId easily accessible
  (req as any).carrierId = req.user.carrierId;

  next();
};
