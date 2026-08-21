import http from "node:http";

export type DockerContainer = {
  Id: string;
  Names?: string[];
  State?: string;
  Labels?: Record<string, string>;
};

export type DockerContainerInspection = {
  Id: string;
  Name?: string;
  State?: {
    Status?: string;
    Running?: boolean;
    ExitCode?: number;
    Error?: string;
    Health?: { Status?: string };
  };
};

export type DockerContainerSpec = {
  Image: string;
  Cmd: string[];
  Env: string[];
  User?: string;
  WorkingDir?: string;
  Labels: Record<string, string>;
  ExposedPorts?: Record<string, Record<string, never>>;
  Healthcheck?: {
    Test: string[];
    Interval?: number;
    Timeout?: number;
    Retries?: number;
    StartPeriod?: number;
  };
  HostConfig: {
    AutoRemove: boolean;
    Binds: string[];
    CapDrop: string[];
    Init: boolean;
    Memory: number;
    NanoCpus: number;
    NetworkMode: string;
    PidsLimit: number;
    ReadonlyRootfs: boolean;
    SecurityOpt: string[];
    Tmpfs: Record<string, string>;
    ShmSize?: number;
  };
};

export type DockerNetwork = { Id: string; Name?: string; Labels?: Record<string, string> };

export interface ContainerEngine {
  create(name: string, spec: DockerContainerSpec): Promise<string>;
  start(id: string): Promise<void>;
  stop(id: string, seconds?: number): Promise<void>;
  remove(id: string): Promise<void>;
  listByLabel(label: string): Promise<DockerContainer[]>;
  inspect(id: string): Promise<DockerContainerInspection>;
  logs(id: string, tail?: number): Promise<string>;
  pull(image: string): Promise<void>;
  createNetwork(name: string, labels: Record<string, string>): Promise<string>;
  connectNetwork(networkId: string, containerId: string, aliases?: string[]): Promise<void>;
  removeNetwork(networkId: string): Promise<void>;
  listNetworksByLabel(label: string): Promise<DockerNetwork[]>;
}

type DockerError = { message?: string };

// Most Docker Engine API calls (create/start/stop/inspect/list/...) are local, in-memory
// operations against dockerd and should return in milliseconds; 30s is generous headroom
// for a busy daemon while still failing fast on a wedged one.
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
// Image pulls legitimately take minutes over the network on a cold cache. This only
// guards against a fully hung daemon, not a slow-but-progressing pull.
const PULL_REQUEST_TIMEOUT_MS = 10 * 60_000;

export class DockerEngine implements ContainerEngine {
  constructor(
    private readonly socketPath: string,
    private readonly requestTimeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS,
  ) {}

  async create(name: string, spec: DockerContainerSpec): Promise<string> {
    const result = await this.request<{ Id?: string }>("POST", `/containers/create?name=${encodeURIComponent(name)}`, spec, [201]);
    if (!result.Id) throw new Error("Docker created a task container without returning its id");
    return result.Id;
  }

  async start(id: string): Promise<void> {
    await this.request("POST", `/containers/${encodeURIComponent(id)}/start`, undefined, [204, 304]);
  }

  async stop(id: string, seconds = 2): Promise<void> {
    await this.request("POST", `/containers/${encodeURIComponent(id)}/stop?t=${seconds}`, undefined, [204, 304, 404]);
  }

  async remove(id: string): Promise<void> {
    await this.request("DELETE", `/containers/${encodeURIComponent(id)}?force=true&v=true`, undefined, [204, 404]);
  }

  listByLabel(label: string): Promise<DockerContainer[]> {
    const filters = encodeURIComponent(JSON.stringify({ label: [label] }));
    return this.request<DockerContainer[]>("GET", `/containers/json?all=true&filters=${filters}`, undefined, [200]);
  }

  inspect(id: string): Promise<DockerContainerInspection> {
    return this.request<DockerContainerInspection>("GET", `/containers/${encodeURIComponent(id)}/json`, undefined, [200]);
  }

  async logs(id: string, tail = 200): Promise<string> {
    const raw = await this.requestBuffer(
      "GET",
      `/containers/${encodeURIComponent(id)}/logs?stdout=true&stderr=true&timestamps=true&tail=${Math.max(1, Math.min(tail, 1000))}`,
      undefined,
      [200],
    );
    return decodeDockerStream(raw).slice(-64 * 1024);
  }

  async pull(image: string): Promise<void> {
    const raw = await this.requestBuffer(
      "POST",
      `/images/create?fromImage=${encodeURIComponent(image)}`,
      undefined,
      [200],
      PULL_REQUEST_TIMEOUT_MS,
    );
    for (const line of raw.toString("utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as { error?: string };
        if (event.error) throw new Error(`Docker image pull failed: ${event.error}`);
      } catch (error) {
        if (error instanceof SyntaxError) continue;
        throw error;
      }
    }
  }

  async createNetwork(name: string, labels: Record<string, string>): Promise<string> {
    const result = await this.request<{ Id?: string }>("POST", "/networks/create", {
      Name: name,
      Driver: "bridge",
      Internal: false,
      CheckDuplicate: true,
      Labels: labels,
    }, [201]);
    if (!result.Id) throw new Error("Docker created a session network without returning its id");
    return result.Id;
  }

  async connectNetwork(networkId: string, containerId: string, aliases: string[] = []): Promise<void> {
    await this.request("POST", `/networks/${encodeURIComponent(networkId)}/connect`, {
      Container: containerId,
      EndpointConfig: aliases.length ? { Aliases: aliases } : {},
    }, [200]);
  }

  async removeNetwork(networkId: string): Promise<void> {
    await this.request("DELETE", `/networks/${encodeURIComponent(networkId)}`, undefined, [204, 404]);
  }

  listNetworksByLabel(label: string): Promise<DockerNetwork[]> {
    const filters = encodeURIComponent(JSON.stringify({ label: [label] }));
    return this.request<DockerNetwork[]>("GET", `/networks?filters=${filters}`, undefined, [200]);
  }

  private request<T = Record<string, never>>(
    method: string,
    requestPath: string,
    body: unknown,
    expected: number[],
    timeoutMs?: number,
  ): Promise<T> {
    return this.requestBuffer(method, requestPath, body, expected, timeoutMs).then((raw) => {
      if (!raw.length) return {} as T;
      try { return JSON.parse(raw.toString("utf8")) as T; }
      catch { return { message: raw.toString("utf8") } as T; }
    });
  }

  private requestBuffer(
    method: string,
    requestPath: string,
    body: unknown,
    expected: number[],
    timeoutMs: number = this.requestTimeoutMs,
  ): Promise<Buffer> {
    const encoded = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    return new Promise<Buffer>((resolve, reject) => {
      const controller = new AbortController();
      let settled = false;
      const settleResolve = (value: Buffer) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const settleReject = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      };

      const request = http.request({
        socketPath: this.socketPath,
        path: requestPath,
        method,
        headers: encoded ? {
          "content-type": "application/json",
          "content-length": encoded.length,
        } : undefined,
      }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          const status = response.statusCode ?? 500;
          if (!expected.includes(status)) {
            let parsed: DockerError = {};
            try { parsed = JSON.parse(raw) as DockerError; } catch { parsed = { message: raw }; }
            const message = parsed.message ?? `HTTP ${status}`;
            settleReject(new Error(`Docker Engine request failed: ${message}`));
            return;
          }
          settleResolve(Buffer.concat(chunks));
        });
      });
      const timeoutError = () => new Error(`Docker Engine request timed out after ${timeoutMs}ms: ${method} ${requestPath}`);
      // Bun's node:http compat neither honors a `signal` request option nor reliably emits
      // 'error' from destroy() over a Unix domain socket (confirmed empirically against a real
      // socket server; Node's own ClientRequest does both). So the timer itself - not an event -
      // is the sole authority for a timeout: it settles the promise directly via the AbortSignal
      // it flags, then destroys the request purely to release the underlying socket. Relying on
      // any event here (abort/'error'/'close') risks the same hang this is meant to fix, on
      // whichever runtime or failure shape doesn't happen to emit that event.
      const timer = setTimeout(() => {
        controller.abort();
        settleReject(timeoutError());
        request.destroy();
      }, timeoutMs);
      request.on("error", (error) => settleReject(controller.signal.aborted ? timeoutError() : error));
      if (encoded) request.write(encoded);
      request.end();
    });
  }
}

export function decodeDockerStream(raw: Buffer): string {
  const chunks: Buffer[] = [];
  let offset = 0;
  while (offset + 8 <= raw.length) {
    const stream = raw[offset];
    const length = raw.readUInt32BE(offset + 4);
    if ((stream !== 0 && stream !== 1 && stream !== 2) || offset + 8 + length > raw.length) {
      return raw.toString("utf8");
    }
    chunks.push(raw.subarray(offset + 8, offset + 8 + length));
    offset += 8 + length;
  }
  if (offset !== raw.length) return raw.toString("utf8");
  return Buffer.concat(chunks).toString("utf8");
}
