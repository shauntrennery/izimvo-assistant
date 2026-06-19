import type { LoaderConfig } from "./types.js";

/**
 * Mint a private session via our backend (PLAN §7.2). The browser only ever
 * receives a short-lived session token + URL — never the Speechify API key or
 * agent id. The backend binds this to the request Origin.
 */
export interface SessionResponse {
  sessionToken: string;
  sessionUrl: string;
  /** Conversation id used to poll for product cards. */
  conversationId: string | null;
}

export class SessionError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "SessionError";
  }
}

export async function fetchSession(opts: {
  apiBase: string;
  config: LoaderConfig;
  pageUrl: string;
  fetchImpl?: typeof fetch;
}): Promise<SessionResponse> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(`${opts.apiBase}/v1/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // The browser sends Origin automatically; the backend binds against it.
    body: JSON.stringify({
      siteKey: opts.config.siteKey,
      category: opts.config.category,
      userIdentity: opts.config.userId,
      locale: opts.config.locale,
      pageUrl: opts.pageUrl,
    }),
  });

  if (!res.ok) {
    throw new SessionError(`session request failed: ${res.status}`, res.status);
  }
  const json = (await res.json()) as Partial<SessionResponse>;
  if (!json.sessionToken || !json.sessionUrl) {
    throw new SessionError("malformed session response");
  }
  return {
    sessionToken: json.sessionToken,
    sessionUrl: json.sessionUrl,
    conversationId: json.conversationId ?? null,
  };
}
