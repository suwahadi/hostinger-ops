import type { PrismaClient } from "@ops/database";
import {
  createHostingerClient,
  createTokenProvider,
  probeCapabilities,
  TokenUnavailableError,
  type RateLimiter,
  type Sleep,
} from "@ops/hostinger-adapter";
import { CapabilitySummary, LoginSummary } from "@ops/shared";

export type VerifyDeps = {
  db: PrismaClient;
  masterKey: Buffer;
  limiter: RateLimiter;
  fetch?: typeof fetch;
  sleep?: Sleep;
  requestId: string;
};

export type VerifyResult = { login: LoginSummary; capabilities: CapabilitySummary[]; hint: string | null };

function hintFor(status: string, tokenRef: string): string | null {
  const storeAgain = `In your own terminal run: corepack pnpm ops:secret:set ${tokenRef}`;
  switch (status) {
    case "NO_TOKEN":
      return `No token is stored for this login. ${storeAgain}`;
    case "SECRET_UNREADABLE":
      return `The stored token cannot be decrypted with the current SECRETS_MASTER_KEY. Restore the previous key in .env, or store the token again. ${storeAgain}`;
    case "TOKEN_INVALID":
      return `Hostinger rejected the token. Create a new API token in hPanel, then store it. ${storeAgain}`;
    case "DEGRADED":
      return "Some probes failed; see the note on each capability.";
    default:
      return null;
  }
}

export async function verifyLogin(deps: VerifyDeps, alias: string): Promise<VerifyResult | null> {
  const { db } = deps;
  const login = await db.hostingerLogin.findUnique({ where: { alias } });
  if (!login) return null;

  const audit = (action: string, result: string, detail?: object) =>
    db.auditLog.create({
      data: { requestId: deps.requestId, actor: "CLAUDE_MCP", action, resource: "hostinger_login", resourceId: alias, result, detail },
    });

  let status: string;
  try {
    const token = await createTokenProvider({ db, masterKey: deps.masterKey }).getToken(login.tokenRef);
    const client = createHostingerClient({
      token,
      limiterKey: login.id,
      limiter: deps.limiter,
      fetch: deps.fetch,
      sleep: deps.sleep,
      onCall: async (call) => {
        await audit("HOSTINGER_API_CALL", String(call.status ?? call.error), {
          path: call.path,
          attempt: call.attempt,
          durationMs: call.durationMs,
        });
      },
    });
    const probes = await probeCapabilities(client);
    const checkedAt = new Date();
    await db.$transaction(
      probes.map(({ name, ...probe }) =>
        db.hostingCapability.upsert({
          where: { loginId_name: { loginId: login.id, name } },
          create: { loginId: login.id, name, ...probe, checkedAt },
          update: { ...probe, checkedAt },
        }),
      ),
    );
    if (probes.some((p) => p.httpStatus === 401)) status = "TOKEN_INVALID";
    else if (probes.find((p) => p.name === "hosting.websites.list")?.available) status = "CONNECTED";
    else status = "DEGRADED";
  } catch (error) {
    if (!(error instanceof TokenUnavailableError)) throw error;
    status = error.reason === "missing" ? "NO_TOKEN" : "SECRET_UNREADABLE";
  }

  const updated = await db.hostingerLogin.update({
    where: { id: login.id },
    data: { status, lastVerifiedAt: new Date() },
    include: { capabilities: { orderBy: { name: "asc" } } },
  });
  await audit("LOGIN_VERIFY", status);

  return {
    login: LoginSummary.parse({ ...updated, lastVerifiedAt: updated.lastVerifiedAt?.toISOString() ?? null }),
    capabilities: updated.capabilities.map((c) => CapabilitySummary.parse({ ...c, checkedAt: c.checkedAt.toISOString() })),
    hint: hintFor(status, login.tokenRef),
  };
}
