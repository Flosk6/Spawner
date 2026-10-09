import { createServer, request } from "http";
import type { AddressInfo } from "net";
import { PassThrough } from "stream";
import { IoAdapter } from "@nestjs/platform-socket.io";
import { GATEWAY_OPTIONS } from "@nestjs/websockets/constants";
import { TERMINAL_INPUT_CHUNK } from "@spawner/core";
import type { Namespace, Server, ServerOptions, Socket } from "socket.io";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AccessService } from "../../common/access.service";
import { sessionActor, type Actor } from "../../common/actor";
import type { PrismaService } from "../../common/prisma.service";
import { WsTicketsService } from "../auth/ws-tickets.service";
import { TERMINAL_SOCKET_OPTIONS, TerminalGateway } from "./terminal.gateway";

interface Peer {
  socket: WebSocket;
  next: () => Promise<string>;
  closed: Promise<number>;
}

const GRACE = { id: 7, name: "Grace", role: "member", isActive: true };

/**
 * Opens a raw Engine.IO WebSocket, as an attacker would, and reads its
 * packets one by one.
 */
async function connect(port: number, query = ""): Promise<Peer> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/socket.io/?EIO=4&transport=websocket${query}`);
  const queue: string[] = [];
  const waiters: ((message: string) => void)[] = [];
  socket.addEventListener("message", (event) => {
    const waiter = waiters.shift();
    if (waiter) {
      waiter(String(event.data));
    } else {
      queue.push(String(event.data));
    }
  });
  const closed = new Promise<number>((resolve) => socket.addEventListener("close", (event) => resolve(event.code)));
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve);
    socket.addEventListener("error", reject);
  });
  const next = () => (queue.length > 0 ? Promise.resolve(queue.shift()) : new Promise<string>((resolve) => waiters.push(resolve)));
  return { socket, next, closed };
}

/**
 * Asks for a WebSocket upgrade: 101 when the WebSocket opens, otherwise
 * engine.io's refusal (always a 400) and its reason.
 */
function upgrade(port: number, query: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const attempt = request({
      host: "127.0.0.1",
      port,
      path: `/socket.io/?EIO=4&transport=websocket${query}`,
      headers: { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==", ...headers },
    });
    attempt.on("upgrade", (response, socket) => {
      socket.destroy();
      resolve({ status: response.statusCode ?? 0, body: "" });
    });
    attempt.on("response", (response) => {
      let body = "";
      response.on("data", (chunk) => (body += chunk));
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
    });
    attempt.on("error", reject);
    attempt.end();
  });
}

describe("TerminalGateway on its Socket.IO server", () => {
  const tickets = new WsTicketsService();
  const gateway = new TerminalGateway(
    { user: { findUnique: async ({ where }) => (where.id === GRACE.id ? GRACE : null) } } as never,
    tickets,
    {} as never,
    { dashboardOrigins: ["http://spawner.localtest.me"] } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  let io: Server;
  let port: number;

  beforeAll(async () => {
    const http = createServer();
    const { namespace, ...options } = TERMINAL_SOCKET_OPTIONS;
    const settings: Partial<ServerOptions> = options;
    io = new IoAdapter(http).create(0, settings as ServerOptions);
    const terminal: Namespace = io.of(`/${namespace}`);
    gateway.afterInit(terminal);
    terminal.on("connection", (client) => client.on("terminal-input", (data) => gateway.input(client, data)));
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    port = (http.address() as AddressInfo).port;
  });

  const ticket = () => tickets.issue({ user: GRACE, via: "session", scopes: ["envs:exec"], tokenId: null, tokenName: null, projectId: null } as Actor).ticket;

  afterAll(async () => {
    gateway.onModuleDestroy();
    await new Promise((resolve) => io.close(resolve));
  });

  it("gives Nest the hardened options through its decorator", () => {
    expect(Reflect.getMetadata(GATEWAY_OPTIONS, TerminalGateway)).toEqual(TERMINAL_SOCKET_OPTIONS);
    expect(TERMINAL_SOCKET_OPTIONS).toMatchObject({ transports: ["websocket"], serveClient: false, maxHttpBufferSize: 64 * 1024 });
  });

  it("serves neither long-polling nor the client bundle", async () => {
    const polling = await fetch(`http://127.0.0.1:${port}/socket.io/?EIO=4&transport=polling`);
    expect(polling.status).toBe(400);
    expect(await polling.json()).toMatchObject({ message: "Transport unknown" });
    expect((await fetch(`http://127.0.0.1:${port}/socket.io/socket.io.js`)).status).toBe(400);
  });

  it("opens no WebSocket without a valid ticket, twice with the same one, or from another origin", async () => {
    const unauthorized = { status: 400, body: "Unauthorized: invalid or expired ticket" };
    expect(await upgrade(port, "")).toEqual(unauthorized);
    expect(await upgrade(port, "&token=forged")).toEqual(unauthorized);
    const once = ticket();
    expect((await upgrade(port, `&token=${once}`)).status).toBe(101);
    expect(await upgrade(port, `&token=${once}`)).toEqual(unauthorized);
    expect(await upgrade(port, `&token=${ticket()}`, { Origin: "http://feat--blog.localtest.me" })).toEqual({
      status: 400,
      body: "terminals open from the dashboard or the CLI only",
    });
    expect((await upgrade(port, `&token=${ticket()}`, { Origin: "http://spawner.localtest.me" })).status).toBe(101);
  });

  it("refuses the main namespace, and closes the connection after the refusal", async () => {
    const peer = await connect(port, `&token=${ticket()}`);
    expect(JSON.parse((await peer.next()).slice(1))).toMatchObject({ upgrades: [], maxPayload: 64 * 1024 });
    peer.socket.send("40");
    expect(await peer.next()).toBe('44{"message":"terminals are in the /terminal namespace"}');
    expect(await peer.closed).toBe(1005);
  });

  it("takes the largest input piece a client sends, and closes the connection on a larger message", async () => {
    const peer = await connect(port, `&token=${ticket()}`);
    await peer.next();
    peer.socket.send("40/terminal,");
    expect(await peer.next()).toMatch(/^40\/terminal,\{"sid":/);

    const worst = { input: "\u0001".repeat(TERMINAL_INPUT_CHUNK), resourceName: "a".repeat(63) };
    peer.socket.send(`42/terminal,${JSON.stringify(["terminal-input", worst])}`);
    expect(await peer.next()).toBe('42/terminal,["terminal-error","No active terminal session"]');

    peer.socket.send(`42/terminal,${JSON.stringify(["terminal-input", { input: "x".repeat(64 * 1024), resourceName: "app" }])}`);
    expect(await peer.closed).toBe(1009);
  });
});

describe("TerminalGateway sessions", () => {
  const users = { 7: { id: 7, name: "Grace", role: "admin", isActive: true } };
  const prisma = {
    user: { findUnique: async ({ where }: { where: { id: number } }) => users[where.id as 7] ?? null },
    environment: { findFirst: async () => ({ id: "e1", slug: "feat", ownerId: 1, projectId: "p1", project: { slug: "blog" } }) },
  };
  const ended: string[] = [];
  const access = new AccessService(prisma as unknown as PrismaService);
  const gateway = new TerminalGateway(
    prisma as never,
    new WsTicketsService(),
    {
      findServiceContainer: async () => ({ Id: "c1", State: "running" }),
      execInteractive: async () => ({ stream: new PassThrough(), exitCode: async () => 0, resize: async () => undefined }),
    } as never,
    { dashboardOrigins: [] } as never,
    { record: async () => undefined } as never,
    { open: async () => ({ sessionId: "s1", write: () => undefined, close: async (reason: string) => void ended.push(reason) }) } as never,
    { touch: () => undefined } as never,
    access,
  );
  const client = (actor: Actor) => {
    const events: unknown[][] = [];
    const socket = { id: `socket-${Math.random()}`, data: { actor }, connected: true, emit: (...event: unknown[]) => events.push(event), disconnect: () => (socket.connected = false) };
    return { socket: socket as unknown as Socket & { connected: boolean }, events };
  };

  afterAll(() => {
    gateway.onModuleDestroy();
    access.onModuleDestroy();
  });

  it("closes an open terminal once its user may no longer open it, and reads the user again at each start", async () => {
    const { socket, events } = client(sessionActor({ id: 7, name: "Grace", role: "admin" }));
    await gateway.start(socket, { environmentId: "e1", resourceName: "app" });
    expect(events.at(-1)?.[1]).toContain("Connected to app");

    users[7].role = "member";
    await access.changed(7);
    expect(events.at(-1)).toEqual(["terminal-error", "Closed: only the owner of the environment or an admin can do this"]);
    expect(ended).toEqual(["revoked"]);

    await gateway.start(socket, { environmentId: "e1", resourceName: "app" });
    expect(events.at(-1)).toEqual(["terminal-error", "only the owner of the environment or an admin can do this"]);

    users[7].isActive = false;
    await gateway.start(socket, { environmentId: "e1", resourceName: "app" });
    expect(events.at(-1)).toEqual(["terminal-error", "Unauthorized: access revoked or expired"]);
    expect(socket.connected).toBe(false);
  });
});
