import type { Actor } from "../common/actor";

declare global {
  namespace Express {
    interface Request {
      /** Set by ActorMiddleware when the request is authenticated. */
      actor?: Actor;
    }
  }
}

declare module "express-session" {
  interface SessionData {
    userId?: number;
    /**
     * WebAuthn ceremony in progress: its challenge and purpose, the origin it
     * runs on and, for a registration, the user handle given to the
     * authenticator.
     */
    webauthn?: { challenge: string; purpose: "login" | "register"; origin: string; userHandle?: string; context?: string };
    /** GitHub OAuth flow in progress. */
    github?: { state: string; next: string | null; link: boolean };
  }
}
