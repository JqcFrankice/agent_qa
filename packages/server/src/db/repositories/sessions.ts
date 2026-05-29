import { and, eq, gt } from "drizzle-orm";
import type { AppDb } from "../client.js";
import { sessions, users } from "../schema.js";

interface CreateSessionInput {
  id: string;
  userId: number;
  expiresAt: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
}

const IDLE_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;

export class SessionRepository {
  constructor(private readonly db: AppDb) {}

  async create(input: CreateSessionInput) {
    const [session] = await this.db.insert(sessions).values({
      id: input.id,
      userId: input.userId,
      expiresAt: input.expiresAt,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null
    }).returning();
    return session;
  }

  async findValid(id: string, now = new Date()) {
    const idleCutoff = new Date(now.getTime() - IDLE_TIMEOUT_MS);
    const [row] = await this.db.select({
      session: sessions,
      user: users
    }).from(sessions).innerJoin(users, eq(sessions.userId, users.id)).where(and(
      eq(sessions.id, id),
      gt(sessions.expiresAt, now),
      gt(sessions.lastSeenAt, idleCutoff)
    )).limit(1);
    if (!row) return null;
    await this.db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, id));
    return row;
  }

  async delete(id: string) {
    await this.db.delete(sessions).where(eq(sessions.id, id));
  }

  async deleteForUser(userId: number) {
    await this.db.delete(sessions).where(eq(sessions.userId, userId));
  }
}
