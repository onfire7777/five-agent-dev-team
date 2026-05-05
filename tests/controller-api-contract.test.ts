import { IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { Duplex } from "node:stream";
import type { Express } from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ControllerStore } from "../apps/controller/src/store";

type CapturedResponse = { status: number; contentType: string; body: Record<string, unknown> };
type HeaderValue = number | string | readonly string[];

let app: Express;
let controllerStore: ControllerStore;

beforeAll(async () => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AGENT_TEAM_CONFIG", "__missing_agent_team_config_for_controller_api_contract_tests__.yaml");
  vi.stubEnv("AGENT_TEAM_ALLOW_DEFAULT_CONFIG", "");
  ({ app, controllerStore } = await import("../apps/controller/src/index.js"));
});

afterAll(() => {
  vi.unstubAllEnvs();
});

async function postWorkItem(body: unknown): Promise<CapturedResponse> {
  return postJson("/api/work-items", body);
}

async function postJson(url: string, body: unknown): Promise<CapturedResponse> {
  const payload = JSON.stringify(body);
  const request = new IncomingMessage(createSocket());
  Object.assign(request, {
    method: "POST",
    url,
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

  it("blocks workflow start for the stopped project while preserving unrelated project starts", async () => {
    await controllerStore.upsertProjectConnection({
      projectId: "api-project-a",
      repoOwner: "api",
      repoName: "project-a",
      localPath: process.cwd(),
      active: true
    });
    await controllerStore.upsertProjectConnection({
      projectId: "api-project-b",
      repoOwner: "api",
      repoName: "project-b",
      localPath: process.cwd(),
      active: true
    });

    await expect(
      postJson("/api/emergency-stop", {
        scope: "project",
        projectId: "api-project-typo",
        reason: "Typo should not create a scoped stop"
      })
    ).resolves.toMatchObject({
      status: 404,
      body: {
        status: 404,
        detail: "Connected project api-project-typo was not found."
      }
    });

    await expect(
      postJson("/api/emergency-stop", {
        scope: "project",
        projectId: "api-project-a",
        reason: "Pause only project A"
      })
    ).resolves.toMatchObject({
      status: 200,
      body: {
        emergencyStop: true,
        scope: "project:api-project-a",
        projectId: "api-project-a",
        reason: "Pause only project A"
      }
    });

    const stoppedProject = await postWorkItem({
      title: "Project A work",
      projectId: "api-project-a",
      repo: "api/project-a"
    });
    expect(stoppedProject).toMatchObject({
      status: 202,
      body: {
        queued: true,
        workflowId: null,
        reason: "Pause only project A"
      }
    });

    const unrelatedProject = await postWorkItem({
      title: "Project B work",
      projectId: "api-project-b",
      repo: "api/project-b"
    });
    expect(unrelatedProject.status).toBe(202);
    expect(unrelatedProject.body).toMatchObject({
      queued: true,
      workflowId: null
    });
    expect(unrelatedProject.body.reason).toBeUndefined();

    await expect(
      postJson("/api/emergency-resume", {
        scope: "project",
        projectId: "api-project-a",
        reason: "Resume project A"
      })
    ).resolves.toMatchObject({
      status: 200,
      body: {
        emergencyStop: false,
        scope: "project:api-project-a",
        projectId: "api-project-a",
        reason: "Resume project A"
      }
    });

    const resumedProject = await postWorkItem({
      title: "Project A work after resume",
      projectId: "api-project-a",
      repo: "api/project-a"
    });
    expect(resumedProject.status).toBe(202);
    expect(resumedProject.body.reason).toBeUndefined();
  });
});
