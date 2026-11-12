export class ApiError extends Error {}

export type ApiClient = {
  get(path: string, query?: Record<string, string | undefined>): Promise<unknown>;
  post(path: string, opts?: { timeoutMs?: number; body?: object }): Promise<unknown>;
};

const DEFAULT_TIMEOUT_MS = 10_000;

export function createApiClient(opts: { apiUrl: string; apiKey: string; fetch?: typeof fetch }): ApiClient {
  const doFetch = opts.fetch ?? fetch;

  async function request(
    method: "GET" | "POST",
    path: string,
    query: Record<string, string | undefined>,
    timeoutMs: number,
    jsonBody?: object,
  ) {
    const params = new URLSearchParams(
      Object.entries(query).filter((entry): entry is [string, string] => entry[1] !== undefined),
    );
    const url = `${opts.apiUrl}${path}${params.size > 0 ? `?${params}` : ""}`;
    const headers: Record<string, string> = { "x-api-key": opts.apiKey };
    if (jsonBody) headers["content-type"] = "application/json";
    let response: Response;
    try {
      response = await doFetch(url, {
        method,
        headers,
        body: jsonBody ? JSON.stringify(jsonBody) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new ApiError(`Hostinger Ops API did not respond within ${timeoutMs / 1000} seconds`);
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
  }

  return {
    get: (path, query = {}) => request("GET", path, query, DEFAULT_TIMEOUT_MS),
    post: (path, postOpts = {}) => request("POST", path, {}, postOpts.timeoutMs ?? DEFAULT_TIMEOUT_MS, postOpts.body),
  };
}
