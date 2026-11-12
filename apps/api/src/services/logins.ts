import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@ops/database";

export function defaultTokenRef(alias: string): string {
  return `HOSTINGER_TOKEN_${alias.toUpperCase().replaceAll("-", "_")}`;
}

export async function assertNewAlias(db: PrismaClient, alias: string): Promise<void> {
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(alias)) throw new Error("Alias must be lowercase letters, digits, or dashes");
  if (await db.hostingerLogin.findUnique({ where: { alias } })) throw new Error(`Login "${alias}" already exists`);
}

export async function addLogin(db: PrismaClient, input: { alias: string; tokenRef: string }): Promise<void> {
  await assertNewAlias(db, input.alias);
  await db.$transaction([
    db.hostingerLogin.create({ data: { alias: input.alias, tokenRef: input.tokenRef } }),
    db.auditLog.create({
      data: {
        requestId: randomUUID(),
        actor: "CLI_HUMAN",
        action: "LOGIN_ADD",
        resource: "hostinger_login",
        resourceId: input.alias,
        result: "created",
      },
    }),
  ]);
}
