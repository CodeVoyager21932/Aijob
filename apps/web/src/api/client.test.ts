import { afterEach, describe, expect, it, vi } from "vitest";
import {
  apiDownload,
  apiRequest,
  cookieValue,
  createAlphaSession,
  getSessionStatus,
  subscribeToSessionBoundary,
} from "./client";

const sessionStatus = {
  authenticated: true as const,
  owner: {
    id: "owner-local",
    status: "active" as const,
    epoch: 1,
    retentionMode: "anonymous_ttl" as const,
    retentionExpiresAt: "2026-09-11T00:00:00.000Z",
    accountId: null,
    createdAt: "2026-08-12T00:00:00.000Z",
    lastSeenAt: "2026-08-12T00:00:00.000Z",
    deletedAt: null,
  },
  session: {
    id: "session-local",
    ownerEpoch: 1,
    expiresAt: "2026-09-11T00:00:00.000Z",
  },
};

describe("product API client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads an exact decoded cookie without accepting prefix collisions", () => {
    expect(cookieValue("aijob_csrf_shadow=x; aijob_csrf=token%3A123", "aijob_csrf")).toBe(
      "token:123",
    );
    expect(cookieValue("aijob_csrf_shadow=x", "aijob_csrf")).toBeNull();
  });

  it("sends same-origin credentials, CSRF and idempotency headers for mutations", async () => {
    let captured: RequestInit | undefined;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured = init;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("document", { cookie: "aijob_csrf=csrf-token" });
    vi.stubGlobal("fetch", fetchMock);

    await apiRequest<{ ok: boolean }>("/v1/example", {
      method: "POST",
      body: { value: 1 },
      idempotencyKey: "test:one",
    });

    const headers = new Headers(captured?.headers);
    expect(captured?.credentials).toBe("same-origin");
    expect(headers.get("x-csrf-token")).toBe("csrf-token");
    expect(headers.get("Idempotency-Key")).toBe("test:one");
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("serializes the first browser session bootstrap before parallel API reads", async () => {
    const documentState = { cookie: "" };
    let sessionRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/v1/session")) {
        sessionRequests += 1;
        await new Promise((resolve) => setTimeout(resolve, 0));
        documentState.cookie = "aijob_csrf=bootstrapped-token";
        return new Response(JSON.stringify(sessionStatus), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("document", documentState);
    vi.stubGlobal("fetch", fetchMock);

    await Promise.all([apiRequest("/v1/first"), apiRequest("/v1/second")]);

    expect(sessionRequests).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("surfaces stable problem details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              detail: "资料修订已经变化",
              code: "REVISION_CONFLICT",
              correlationId: "request-1",
            }),
            { status: 409, headers: { "Content-Type": "application/problem+json" } },
          ),
      ),
    );

    await expect(apiRequest("/v1/profile/facts")).rejects.toMatchObject({
      message: "资料修订已经变化",
      status: 409,
      code: "REVISION_CONFLICT",
      correlationId: "request-1",
    });
  });

  it("checks session state without creating a mutation", async () => {
    let captured: RequestInit | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        captured = init;
        return new Response(JSON.stringify({ authenticated: false }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    await expect(getSessionStatus()).resolves.toEqual({ authenticated: false });
    expect(captured?.method).toBe("GET");
    expect(captured?.credentials).toBe("same-origin");
  });

  it("downloads an owner-protected DOCX without treating it as JSON", async () => {
    let captured: RequestInit | undefined;
    vi.stubGlobal("document", { cookie: "aijob_csrf=csrf-token" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        captured = init;
        return new Response(new Uint8Array([0x50, 0x4b]), {
          status: 200,
          headers: {
            "Content-Type":
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "Content-Disposition":
              "attachment; filename*=UTF-8''Aijob-%E5%B2%97%E4%BD%8D%E7%AE%80%E5%8E%86.docx",
          },
        });
      }),
    );

    const download = await apiDownload("/v1/resume-documents/document/docx");
    expect(download.fileName).toBe("Aijob-岗位简历.docx");
    expect(Array.from(new Uint8Array(await download.blob.arrayBuffer()))).toEqual([0x50, 0x4b]);
    expect(captured?.method).toBe("GET");
    expect(captured?.credentials).toBe("same-origin");
    expect(new Headers(captured?.headers).get("x-csrf-token")).toBeNull();
  });

  it("creates an Alpha session without requiring a pre-existing CSRF cookie", async () => {
    let captured: RequestInit | undefined;
    vi.stubGlobal("document", { cookie: "" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        captured = init;
        return new Response(JSON.stringify(sessionStatus), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    await expect(createAlphaSession("alpha-private-invite-code")).resolves.toEqual(sessionStatus);
    const headers = new Headers(captured?.headers);
    expect(captured?.method).toBe("POST");
    expect(captured?.credentials).toBe("same-origin");
    expect(headers.get("x-csrf-token")).toBeNull();
    expect(captured?.body).toBe(JSON.stringify({ inviteCode: "alpha-private-invite-code" }));
  });

  it("recovers a read once across a session boundary", async () => {
    const documentState = { cookie: "aijob_csrf=stale-token" };
    let protectedReads = 0;
    vi.stubGlobal("document", documentState);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith("/v1/session")) {
          documentState.cookie = "aijob_csrf=fresh-token";
          return new Response(JSON.stringify(sessionStatus), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        protectedReads += 1;
        if (protectedReads === 1) {
          return new Response(JSON.stringify({ detail: "会话已失效", code: "SESSION_REQUIRED" }), {
            status: 401,
            headers: { "Content-Type": "application/problem+json" },
          });
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    await expect(apiRequest<{ ok: boolean }>("/v1/protected-read")).resolves.toEqual({ ok: true });
    expect(protectedReads).toBe(2);
  });

  it("recovers a download read once across a session boundary", async () => {
    const documentState = { cookie: "aijob_csrf=stale-token" };
    let protectedReads = 0;
    vi.stubGlobal("document", documentState);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith("/v1/session")) {
          documentState.cookie = "aijob_csrf=fresh-token";
          return new Response(JSON.stringify(sessionStatus), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        protectedReads += 1;
        if (protectedReads === 1) {
          return new Response(JSON.stringify({ detail: "会话已失效", code: "SESSION_REQUIRED" }), {
            status: 401,
            headers: { "Content-Type": "application/problem+json" },
          });
        }
        return new Response(new Uint8Array([0x50, 0x4b]), {
          status: 200,
          headers: {
            "Content-Type":
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          },
        });
      }),
    );

    const download = await apiDownload("/v1/resume-documents/document/docx");
    expect(Array.from(new Uint8Array(await download.blob.arrayBuffer()))).toEqual([0x50, 0x4b]);
    expect(protectedReads).toBe(2);
  });

  it("notifies an owner boundary even when a local read succeeds", async () => {
    const documentState = { cookie: "aijob_csrf=current-token" };
    let boundaryNotifications = 0;
    let requestCount = 0;
    const unsubscribe = subscribeToSessionBoundary(() => {
      boundaryNotifications += 1;
    });
    vi.stubGlobal("document", documentState);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        requestCount += 1;
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "x-aijob-owner-context":
              requestCount === 1 ? "first-owner-boundary:1" : "replacement-owner-boundary:1",
          },
        });
      }),
    );

    await apiRequest("/v1/first-owner-read");
    boundaryNotifications = 0;
    await apiRequest("/v1/replacement-owner-read");
    unsubscribe();
    expect(boundaryNotifications).toBe(1);
  });

  it("never replays a mutation after rebuilding the local session", async () => {
    const documentState = { cookie: "aijob_csrf=stale-token" };
    let mutationRequests = 0;
    let boundaryNotifications = 0;
    const unsubscribe = subscribeToSessionBoundary(() => {
      boundaryNotifications += 1;
    });
    vi.stubGlobal("document", documentState);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith("/v1/session")) {
          documentState.cookie = "aijob_csrf=fresh-token";
          return new Response(JSON.stringify(sessionStatus), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        mutationRequests += 1;
        return new Response(JSON.stringify({ detail: "安全令牌已失效", code: "CSRF_REJECTED" }), {
          status: 403,
          headers: { "Content-Type": "application/problem+json" },
        });
      }),
    );

    await expect(
      apiRequest("/v1/protected-write", { method: "PUT", body: { draft: "保留" } }),
    ).rejects.toMatchObject({ code: "SESSION_RECOVERED_RETRY_REQUIRED" });
    unsubscribe();
    expect(mutationRequests).toBe(1);
    expect(boundaryNotifications).toBe(1);
  });
});
