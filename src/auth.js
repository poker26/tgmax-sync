import crypto from "crypto";
import bcrypt from "bcryptjs";
import { config } from "./config.js";
import {
  countUsers,
  createUser,
  createUserSession,
  deleteSessionByTokenHash,
  loadUserByEmail,
  loadUserBySessionTokenHash,
} from "./db/multi-tenant-repository.js";

function hashToken(rawToken) {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

function issueRawToken() {
  return crypto.randomBytes(32).toString("hex");
}

function extractBearerToken(authorizationHeader) {
  if (!authorizationHeader || typeof authorizationHeader !== "string") return "";
  if (!authorizationHeader.startsWith("Bearer ")) return "";
  return authorizationHeader.slice("Bearer ".length).trim();
}

export async function registerFirstUser({ email, password }) {
  const usersCount = await countUsers();
  if (usersCount > 0) {
    throw new Error("Registration is disabled after bootstrap user creation.");
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await createUser({ email, passwordHash });
  return user;
}

export async function loginWithEmailPassword({ email, password, userAgent, ipAddress }) {
  const user = await loadUserByEmail(email);
  if (!user || user.status !== "active") {
    return null;
  }
  const passwordMatches = await bcrypt.compare(password, user.password_hash);
  if (!passwordMatches) return null;

  const rawToken = issueRawToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(
    Date.now() + config.web.sessionTtlHours * 60 * 60 * 1000
  ).toISOString();
  await createUserSession({
    userId: user.id,
    tokenHash,
    expiresAt,
    userAgent,
    ipAddress,
  });
  return {
    token: rawToken,
    user: {
      id: user.id,
      email: user.email,
    },
  };
}

export async function resolveAuthenticatedUser(authorizationHeader) {
  const rawToken = extractBearerToken(authorizationHeader);
  if (!rawToken) return null;
  const tokenHash = hashToken(rawToken);
  const sessionRow = await loadUserBySessionTokenHash(tokenHash);
  if (!sessionRow || !sessionRow.users) return null;
  if (sessionRow.users.status !== "active") return null;
  return {
    sessionId: sessionRow.id,
    user: {
      id: sessionRow.users.id,
      email: sessionRow.users.email,
    },
    tokenHash,
  };
}

export async function logoutByAuthorizationHeader(authorizationHeader) {
  const rawToken = extractBearerToken(authorizationHeader);
  if (!rawToken) return;
  const tokenHash = hashToken(rawToken);
  await deleteSessionByTokenHash(tokenHash);
}

export function readClientIp(request) {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  return request.socket?.remoteAddress ?? "";
}
