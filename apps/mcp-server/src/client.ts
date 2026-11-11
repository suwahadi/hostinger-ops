export class ApiError extends Error {}

export type ApiClient = { get(path: string, query?: Record<string, string | undefined>): Promise<unknown> };

export function createApiClient(opts: { apiUrl: string; apiKey: string; fetch?: typeof fetch }): ApiClient {
  const doFetch = opts.fetch ?? fetch;
  return {
    async get(path, query = {}) {
      const params = new URLSearchParams(
        Object.entries(query).filter((entry): entry is [string, string] => entry[1] !== undefined),
      );
      const url = `${opts.apiUrl}${path}${params.size > 0 ? `?${params}` : ""}`;
      let response: Response;
      try {
        response = await doFetch(url, { headers: { "x-api-key": opts.apiKey }, signal: AbortSignal.timeout(10_000) });
      } catch (error) {
        if (error instanceof Error && error.name === "TimeoutError") {
          throw new ApiError("Hostinger Ops API did not respond within 10 seconds");
        }
        throw new ApiError("Hostinger Ops API is not running. Start it with: pnpm dev:api");
      }
      if (response.status === 401) throw new ApiError("Hostinger Ops API rejected the internal key");
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const code = (body as { error?: unknown } | null)?.error;
        throw new ApiError(`Hostinger Ops API error (${response.status})${typeof code === "string" ? `: ${code}` : ""}`);
      }
      return body;
    },
  };
}
