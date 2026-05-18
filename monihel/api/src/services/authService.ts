import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import type { StringValue } from "ms";
import crypto from "crypto";
import nodemailer from "nodemailer";
import prisma from "../lib/prisma";
import { env } from "../config/env";
import { logger } from "../lib/logger";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  UnauthorizedError,
} from "../utils/errors";
import {
  validateEmail,
  validatePassword,
  validateUsername,
} from "../utils/validation";

// ─── Email transporter (shared with alert worker config) ─────────────

const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_SECURE,
  auth: {
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
  },
});

function generateVerificationToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

async function sendVerificationEmail(
  email: string,
  token: string
): Promise<void> {
  const verifyUrl = `${env.CLIENT_URL}/verify-email?token=${token}`;
  try {
    await transporter.sendMail({
      from: env.SMTP_FROM,
      to: email,
      subject: "Verify your email — Monihel",
      html: [
        "<h2>Welcome to Monihel!</h2>",
        "<p>Please verify your email address by clicking the link below:</p>",
        `<p><a href="${verifyUrl}">${verifyUrl}</a></p>`,
        "<p>This link expires when you register a new verification token.</p>",
        "<p>If you did not create an account, you can ignore this email.</p>",
      ].join("\n"),
    });
    logger.info({ email }, "verification email sent");
  } catch (err: any) {
    logger.error({ err: err?.message, email }, "failed to send verification email");
  }
}

// ─── Types ───────────────────────────────────────────────────────────

export interface RegisterInput {
  email: string;
  username: string;
  password: string;
  name?: string;
}

export interface LoginInput {
  login: string; // email or username
  password: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface AccessTokenPayload {
  sub: string; // userId
  email: string;
  username: string;
}

interface RefreshTokenPayload {
  sub: string; // userId
  jti: string; // token id
  family: string; // rotation family
}

// ─── Helpers ─────────────────────────────────────────────────────────

function signAccessToken(user: {
  id: string;
  email: string;
  username: string;
}): string {
  const payload: AccessTokenPayload = {
    sub: user.id,
    email: user.email,
    username: user.username,
  };
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_EXPIRY as StringValue,
  });
}

function signRefreshToken(
  userId: string,
  tokenId: string,
  family: string
): string {
  const payload: RefreshTokenPayload = {
    sub: userId,
    jti: tokenId,
    family,
  };
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: env.REFRESH_TOKEN_EXPIRY as StringValue,
  });
}

function parseExpiry(expiry: string): number {
  const match = expiry.match(/^(\d+)([smhd])$/);
  if (!match) return 7 * 24 * 60 * 60 * 1000; // default 7d
  const val = parseInt(match[1]);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  return val * (multipliers[unit] || 1000);
}

// ─── Service ─────────────────────────────────────────────────────────

/**
 * Register a new user.
 */
export async function register(input: RegisterInput): Promise<{
  user: { id: string; email: string; username: string; name: string | null; emailVerified: boolean };
  tokens: TokenPair;
}> {
  // Validate
  if (!validateEmail(input.email)) {
    throw new BadRequestError("Invalid email format");
  }
  if (!validateUsername(input.username)) {
    throw new BadRequestError(
      "Username must be 3-30 characters, start with a letter, and contain only letters, numbers, and underscores"
    );
  }
  const pwCheck = validatePassword(input.password);
  if (!pwCheck.valid) {
    throw new BadRequestError(pwCheck.errors.join(". "));
  }

  // Check uniqueness
  const existing = await prisma.user.findFirst({
    where: {
      OR: [
        { email: input.email.toLowerCase() },
        { username: input.username.toLowerCase() },
      ],
    },
  });
  if (existing) {
    if (existing.email === input.email.toLowerCase()) {
      throw new ConflictError("Email already in use");
    }
    throw new ConflictError("Username already taken");
  }

  // Hash password
  const hashedPassword = await bcrypt.hash(
    input.password,
    env.BCRYPT_SALT_ROUNDS
  );

  const verificationToken = generateVerificationToken();

  // Create user (unverified)
  const user = await prisma.user.create({
    data: {
      email: input.email.toLowerCase(),
      username: input.username.toLowerCase(),
      name: input.name || null,
      password: hashedPassword,
      emailVerified: false,
      verificationToken,
    },
  });

  // Send verification email (fire-and-forget — don't block registration)
  sendVerificationEmail(user.email, verificationToken);

  // Issue tokens (user can browse but can't create endpoints until verified)
  const tokens = await issueTokenPair(user);

  return {
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      name: user.name,
      emailVerified: user.emailVerified,
    },
    tokens,
  };
}

/**
 * Login with email/username + password.
 */
export async function login(input: LoginInput): Promise<{
  user: { id: string; email: string; username: string; name: string | null; emailVerified: boolean };
  tokens: TokenPair;
}> {
  const loginLower = input.login.toLowerCase();

  const user = await prisma.user.findFirst({
    where: {
      OR: [{ email: loginLower }, { username: loginLower }],
    },
  });

  if (!user) {
    throw new UnauthorizedError("Invalid credentials");
  }

  const passwordValid = await bcrypt.compare(input.password, user.password);
  if (!passwordValid) {
    throw new UnauthorizedError("Invalid credentials");
  }

  if (!user.emailVerified) {
    throw new ForbiddenError(
      "Email not verified. Please check your inbox or request a new verification email."
    );
  }

  const tokens = await issueTokenPair(user);

  return {
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      name: user.name,
      emailVerified: user.emailVerified,
    },
    tokens,
  };
}

/**
 * Refresh an access token using a refresh token.
 * Implements refresh token rotation: old token is revoked, new pair issued.
 * If a revoked token is reused, the entire family is revoked (breach detection).
 */
export async function refreshAccessToken(
  rawRefreshToken: string
): Promise<TokenPair> {
  let payload: RefreshTokenPayload;
  try {
    payload = jwt.verify(
      rawRefreshToken,
      env.JWT_REFRESH_SECRET
    ) as RefreshTokenPayload;
  } catch {
    throw new UnauthorizedError("Invalid or expired refresh token");
  }

  const storedToken = await prisma.refreshToken.findUnique({
    where: { id: payload.jti },
    include: { user: true },
  });

  if (!storedToken) {
    throw new UnauthorizedError("Refresh token not found");
  }

  // Breach detection: if a revoked token is reused, revoke the entire family
  if (storedToken.revoked) {
    await prisma.refreshToken.updateMany({
      where: { family: storedToken.family },
      data: { revoked: true },
    });
    throw new UnauthorizedError(
      "Refresh token reuse detected — all sessions in this family have been revoked"
    );
  }

  if (storedToken.expiresAt < new Date()) {
    throw new UnauthorizedError("Refresh token expired");
  }

  // Revoke old token
  await prisma.refreshToken.update({
    where: { id: storedToken.id },
    data: { revoked: true },
  });

  // Issue new pair (same family for rotation tracking)
  const tokens = await issueTokenPair(storedToken.user, storedToken.family);
  return tokens;
}

/**
 * Logout: revoke all tokens in the family of the given refresh token.
 */
export async function logout(rawRefreshToken: string): Promise<void> {
  let payload: RefreshTokenPayload;
  try {
    payload = jwt.verify(
      rawRefreshToken,
      env.JWT_REFRESH_SECRET
    ) as RefreshTokenPayload;
  } catch {
    // Even if token is invalid/expired, still try to clean up by the raw token
    return;
  }

  // Revoke entire family
  await prisma.refreshToken.updateMany({
    where: { family: payload.family },
    data: { revoked: true },
  });
}

/**
 * Logout from all devices: revoke every refresh token for the user.
 */
export async function logoutAll(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId },
    data: { revoked: true },
  });
}

/**
 * Verify an access token and return the payload.
 */
export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
  } catch {
    throw new UnauthorizedError("Invalid or expired access token");
  }
}

/**
 * Get current user profile (strips password).
 */
export async function getMe(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      username: true,
      name: true,
      emailVerified: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!user) throw new UnauthorizedError("User not found");
  return user;
}

/**
 * Verify a user's email with their verification token.
 */
export async function verifyEmail(token: string): Promise<void> {
  if (!token) throw new BadRequestError("Verification token is required");

  const user = await prisma.user.findUnique({
    where: { verificationToken: token },
  });

  if (!user) {
    throw new BadRequestError("Invalid or expired verification token");
  }

  if (user.emailVerified) {
    return; // already verified — idempotent
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerified: true,
      verificationToken: null, // consume the token
    },
  });
}

/**
 * Resend verification email (generates a new token).
 */
export async function resendVerification(email: string): Promise<void> {
  if (!email) throw new BadRequestError("Email is required");

  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });

  // Always return success to prevent email enumeration.
  if (!user || user.emailVerified) return;

  const newToken = generateVerificationToken();

  await prisma.user.update({
    where: { id: user.id },
    data: { verificationToken: newToken },
  });

  await sendVerificationEmail(user.email, newToken);
}

// ─── Internal ────────────────────────────────────────────────────────

/**
 * Issue a new access + refresh token pair.
 * Persists the refresh token in the database for rotation tracking.
 */
async function issueTokenPair(
  user: { id: string; email: string; username: string },
  family?: string
): Promise<TokenPair> {
  const tokenFamily = family || crypto.randomUUID();
  const expiresAt = new Date(
    Date.now() + parseExpiry(env.REFRESH_TOKEN_EXPIRY)
  );

  // Create refresh token record in DB first to get the id (used as jti)
  const refreshRecord = await prisma.refreshToken.create({
    data: {
      token: crypto.randomUUID(), // placeholder, will update
      userId: user.id,
      family: tokenFamily,
      expiresAt,
    },
  });

  // Sign tokens
  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user.id, refreshRecord.id, tokenFamily);

  // Store the actual signed JWT in the record
  await prisma.refreshToken.update({
    where: { id: refreshRecord.id },
    data: { token: refreshToken },
  });

  return { accessToken, refreshToken };
}
