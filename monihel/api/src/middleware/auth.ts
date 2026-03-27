import { Request, Response, NextFunction } from "express";
import { verifyAccessToken, AccessTokenPayload } from "../services/authService";
import { UnauthorizedError } from "../utils/errors";

// Extend Express Request to include the authenticated user
declare global {
  namespace Express {
    interface Request {
      user?: AccessTokenPayload;
    }
  }
}

/**
 * Middleware that protects routes by requiring a valid access token.
 * Reads the token from:
 *   1. Authorization: Bearer <token> header
 *   2. access_token cookie (httpOnly)
 */
export function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const token = extractToken(req);

  if (!token) {
    throw new UnauthorizedError("Authentication required");
  }

  const payload = verifyAccessToken(token);
  req.user = payload;
  next();
}

function extractToken(req: Request): string | null {
  // 1. Check Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  // 2. Check cookie
  if (req.cookies?.access_token) {
    return req.cookies.access_token;
  }

  return null;
}
