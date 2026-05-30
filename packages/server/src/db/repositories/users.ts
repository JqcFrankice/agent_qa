import { eq } from "drizzle-orm";
import type { AppDb } from "../client.js";
import { users } from "../schema.js";

export class UserRepository {
  constructor(private readonly db: AppDb) {}

  async create(username: string, passwordHash: string) {
    const [user] = await this.db.insert(users).values({ username, passwordHash }).returning();
    return user;
  }

  async findByUsername(username: string) {
    const [user] = await this.db.select().from(users).where(eq(users.username, username)).limit(1);
    return user ?? null;
  }

  async findById(id: number) {
    const [user] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return user ?? null;
  }

  async list() {
    return this.db.select().from(users).orderBy(users.createdAt);
  }

  async deleteByUsername(username: string) {
    await this.db.delete(users).where(eq(users.username, username));
  }

  async updatePassword(username: string, passwordHash: string) {
    await this.db.update(users).set({ passwordHash }).where(eq(users.username, username));
  }
}
