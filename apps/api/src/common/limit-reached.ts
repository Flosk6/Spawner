import { HttpException } from "@nestjs/common";

/**
 * A request refused for lack of room: the person's quota of environments
 * (409), or the memory or disk of the server (503). The body carries a code
 * for machines ("quota" or "capacity"; the CLI exits with 6) and a hint.
 */
export class LimitReachedException extends HttpException {
  constructor(code: "quota" | "capacity", message: string, hint: string) {
    const status = code === "quota" ? 409 : 503;
    super({ statusCode: status, code, message, hint }, status);
  }
}
