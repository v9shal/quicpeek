import { Request, Response, NextFunction } from "express";

/**
 * Wraps an async route handler so thrown errors are forwarded to Express error middleware.
 */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
