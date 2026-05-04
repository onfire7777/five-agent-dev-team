import { IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { Duplex } from "node:stream";
import type { Express } from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

type CapturedResponse = { status: number; contentType: string; body: Record<string, unknown> };
type HeaderValue = number | string | readonly string[];

let app: Express;

beforeAll(async () => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AGENT_TEAM_CONFIG", "__missing_agent_team_config_for_controller_api_contract_tests__.yaml");
  vi.stubEnv("AGENT_TEAM_ALLOW_DEFAULT_CONFIG", "");
  ({ app } = await import("../apps/controller/src/index.js"));
});

afterAll(() => {
  vi.unstubAllEnvs();
});

async function postWorkItem(body: unknown): Promise<CapturedResponse> {
  const payload = JSON.stringify(body);
  const request = new IncomingMessage(createSocket());
  Object.assign(request, {
    method: "POST",
    url: "/api/work-items",
    headers: {
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(payload))
    }
  });
  let response: ServerResponse | undefined;
  const result = new Promise<CapturedResponse>((resolve) => {
    response = createResponseCapture(resolve);
  });

  request.push(payload);
  request.push(null);
  (app as unknown as (request: IncomingMessage, response: ServerResponse) => void)(request, response!);
  return result;
}

function createSocket(): Socket {
  return new Duplex({
    read() {
      return;
    },
    write(_chunk, _encoding, callback) {
      callback();
    }
  }) as unknown as Socket;
}

function createResponseCapture(onEnd: (response: CapturedResponse) => void): ServerResponse {
  const headers = new Map<string, HeaderValue>();
  const chunks: Buffer[] = [];
  const response = {
    statusCode: 200,
    locals: {},
    setHeader(name: string, value: HeaderValue) {
      headers.set(name.toLowerCase(), value);
      return response;
    },
    getHeader(name: string) {
      return headers.get(name.toLowerCase());
    },
    end(chunk?: unknown, encodingOrCallback?: BufferEncoding | (() => void), callback?: () => void) {
      appendChunk(chunks, chunk);
      (typeof encodingOrCallback === "function" ? encodingOrCallback : callback)?.();
      onEnd({
        status: response.statusCode,
        contentType: String(headers.get("content-type") || ""),
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>
      });
      return response;
    }
  };
  return response as unknown as ServerResponse;
}

function appendChunk(chunks: Buffer[], chunk: unknown): void {
  if (chunk === undefined || chunk === null) return;
  chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk instanceof Uint8Array ? chunk : String(chunk)));
}

describe("controller work item API contract", () => {
  it("returns documented problem statuses for setup and validation failures", async () => {
    const missingProject = await postWorkItem({ title: "Add a release smoke check" });

    expect(missingProject.status).toBe(422);
    expect(missingProject.contentType).toContain("application/problem+json");
    expect(missingProject.body).toMatchObject({
      type: "https://five-agent-dev-team.local/problems/request-failed",
      title: "Request failed",
      status: 422,
      detail: "Connect a target GitHub repository before starting autonomous work."
    });

    const invalidPayload = await postWorkItem({ title: "" });

    expect(invalidPayload.status).toBe(400);
    expect(invalidPayload.contentType).toContain("application/problem+json");
    expect(invalidPayload.body).toMatchObject({
      type: "https://five-agent-dev-team.local/problems/invalid-request",
      title: "Invalid request",
      status: 400
    });
    expect(String(invalidPayload.body.detail)).toContain("title");
  });
});
