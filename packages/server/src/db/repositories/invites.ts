import { and, eq, gt, isNull, or } from "drizzle-orm";
import type { AppDb } from "../client.js";
import { inviteCodes } from "../schema.js";

interface CreateInviteInput {
  code: string;
  usesRemaining: number;
  createdBy: string;
  note?: string | null;
  expiresAt?: Date | null;
}

export class InviteRepository {
  constructor(private readonly db: AppDb) {}

  async create(input: CreateInviteInput) {
    const [invite] = await this.db.insert(inviteCodes).values({
      code: input.code,
      usesRemaining: input.usesRemaining,
      createdBy: input.createdBy,
      note: input.note ?? null,
      expiresAt: input.expiresAt ?? null
    }).returning();
    return invite;
  }

  async list() {
    return this.db.select().from(inviteCodes).orderBy(inviteCodes.createdAt);
  }

  async revoke(code: string) {
    await this.db.update(inviteCodes).set({ usesRemaining: 0 }).where(eq(inviteCodes.code, code));
  }

  async consume(code: string, now = new Date()): Promise<boolean> {
    const [invite] = await this.db.select().from(inviteCodes).where(and(
      eq(inviteCodes.code, code),
      gt(inviteCodes.usesRemaining, 0),
      or(isNull(inviteCodes.expiresAt), gt(inviteCodes.expiresAt, now))
    )).limit(1);
    if (!invite) return false;
    await this.db.update(inviteCodes).set({ usesRemaining: invite.usesRemaining - 1 }).where(eq(inviteCodes.code, code));
    return true;
  }
}
