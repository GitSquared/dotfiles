import http from "node:http";

export type DockerContainer = {
  Id: string;
  Names?: string[];
  State?: string;
  Labels?: Record<string, string>;
};

export type DockerContainerSpec = {
  Image: string;
  Cmd: string[];
  Env: string[];
  User: string;
  WorkingDir: string;
  Labels: Record<string, string>;
  ExposedPorts: Record<string, Record<string, never>>;
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
  };
};

export interface ContainerEngine {
  create(name: string, spec: DockerContainerSpec): Promise<string>;
  start(id: string): Promise<void>;
  stop(id: string, seconds?: number): Promise<void>;
  remove(id: string): Promise<void>;
  listByLabel(label: string): Promise<DockerContainer[]>;
}

type DockerError = { message?: string };

export class DockerEngine implements ContainerEngine {
  constructor(private readonly socketPath: string) {}

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

  private request<T = Record<string, never>>(
    method: string,
    requestPath: string,
    body: unknown,
    expected: number[],
  ): Promise<T> {
    const encoded = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    return new Promise<T>((resolve, reject) => {
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
          let parsed: unknown = {};
          if (raw) {
            try { parsed = JSON.parse(raw); } catch { parsed = { message: raw }; }
          }
          if (!expected.includes(status)) {
            const message = (parsed as DockerError).message ?? `HTTP ${status}`;
            reject(new Error(`Docker Engine request failed: ${message}`));
            return;
          }
          resolve(parsed as T);
        });
      });
      request.on("error", reject);
      if (encoded) request.write(encoded);
      request.end();
    });
  }
}
