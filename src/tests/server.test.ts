import { describe, expect, it } from "vitest";
import { createServer } from "../server.js";

describe("server health", () => {
  it("keeps /health as a process liveness check", async () => {
    const app = createServer(
      {
        $queryRaw: async () => {
          throw new Error("db unavailable");
        }
      } as any,
      {} as any,
      { handleUpdate: async () => undefined } as any
    );

    const response = await app.inject({ method: "GET", url: "/health" });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it("reports database readiness when the ping succeeds", async () => {
    const app = createServer(
      { $queryRaw: async () => [{ "?column?": 1 }] } as any,
      {} as any,
      { handleUpdate: async () => undefined } as any
    );

    const response = await app.inject({ method: "GET", url: "/ready" });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, database: "ok" });
  });

  it("returns degraded readiness when the database ping fails", async () => {
    const app = createServer(
      {
        $queryRaw: async () => {
          throw new Error("db unavailable");
        }
      } as any,
      {} as any,
      { handleUpdate: async () => undefined } as any
    );

    const response = await app.inject({ method: "GET", url: "/ready" });
    await app.close();

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ ok: false, database: "error" });
  });
});
