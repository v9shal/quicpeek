import { Router, Request, Response } from "express";
import {
  register,
  login,
  refreshAccessToken,
  logout,
  logoutAll,
  getMe,
} from "../services/authService";
import { authenticate } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { BadRequestError } from "../utils/errors";
import { env } from "../config/env";

const router = Router();

// ─── Cookie helpers ──────────────────────────────────────────────────

const REFRESH_COOKIE = "refresh_token";
const ACCESS_COOKIE = "access_token";

function setTokenCookies(res: Response, accessToken: string, refreshToken: string) {
  // Access token: short-lived, httpOnly, secure in prod
  res.cookie(ACCESS_COOKIE, accessToken, {
    httpOnly: true,
    secure: env.isProd,
    sameSite: "strict",
    maxAge: 15 * 60 * 1000, // 15 minutes
    path: "/",
  });

  // Refresh token: long-lived, httpOnly, secure in prod, restricted path
  res.cookie(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    secure: env.isProd,
    sameSite: "strict",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: "/api/auth", // only sent to auth routes
  });
}

function clearTokenCookies(res: Response) {
  res.clearCookie(ACCESS_COOKIE, { path: "/" });
  res.clearCookie(REFRESH_COOKIE, { path: "/api/auth" });
}

// ─── POST /api/auth/register ─────────────────────────────────────────

router.post(
  "/register",
  asyncHandler(async (req: Request, res: Response) => {
    const { email, username, password, name } = req.body;

    if (!email || !username || !password) {
      throw new BadRequestError("email, username, and password are required");
    }

    const result = await register({ email, username, password, name });

    setTokenCookies(res, result.tokens.accessToken, result.tokens.refreshToken);

    res.status(201).json({
      success: true,
      data: {
        user: result.user,
        accessToken: result.tokens.accessToken,
      },
    });
  })
);

// ─── POST /api/auth/login ────────────────────────────────────────────

router.post(
  "/login",
  asyncHandler(async (req: Request, res: Response) => {
    const { login: loginField, password } = req.body;

    if (!loginField || !password) {
      throw new BadRequestError("login (email or username) and password are required");
    }

    const result = await login({ login: loginField, password });

    setTokenCookies(res, result.tokens.accessToken, result.tokens.refreshToken);

    res.status(200).json({
      success: true,
      data: {
        user: result.user,
        accessToken: result.tokens.accessToken,
      },
    });
  })
);

// ─── POST /api/auth/refresh ─────────────────────────────────────────

router.post(
  "/refresh",
  asyncHandler(async (req: Request, res: Response) => {
    const refreshToken =
      req.cookies?.[REFRESH_COOKIE] || req.body?.refreshToken;

    if (!refreshToken) {
      throw new BadRequestError("Refresh token is required");
    }

    const tokens = await refreshAccessToken(refreshToken);

    setTokenCookies(res, tokens.accessToken, tokens.refreshToken);

    res.status(200).json({
      success: true,
      data: {
        accessToken: tokens.accessToken,
      },
    });
  })
);

// ─── POST /api/auth/logout ──────────────────────────────────────────

router.post(
  "/logout",
  asyncHandler(async (req: Request, res: Response) => {
    const refreshToken =
      req.cookies?.[REFRESH_COOKIE] || req.body?.refreshToken;

    if (refreshToken) {
      await logout(refreshToken);
    }

    clearTokenCookies(res);

    res.status(200).json({
      success: true,
      message: "Logged out successfully",
    });
  })
);

// ─── POST /api/auth/logout-all ───────────────────────────────────────

router.post(
  "/logout-all",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    await logoutAll(req.user!.sub);

    clearTokenCookies(res);

    res.status(200).json({
      success: true,
      message: "Logged out from all devices",
    });
  })
);

// ─── GET /api/auth/me (protected) ────────────────────────────────────

router.get(
  "/me",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const user = await getMe(req.user!.sub);

    res.status(200).json({
      success: true,
      data: { user },
    });
  })
);

export default router;
