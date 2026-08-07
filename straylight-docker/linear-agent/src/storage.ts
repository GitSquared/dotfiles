import fs from "node:fs/promises";
import path from "node:path";

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(fallback);
    throw error;
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporary, filePath);
  await fs.chmod(filePath, 0o600);
}

export class JsonStore<T> {
  private mutation: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly fallback: T,
  ) {}

  read(): Promise<T> {
    return readJson(this.filePath, this.fallback);
  }

  update<R>(change: (current: T) => R | Promise<R>): Promise<R> {
    let resolveResult: (value: R) => void;
    let rejectResult: (reason?: unknown) => void;
    const result = new Promise<R>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });

    this.mutation = this.mutation
      .catch(() => undefined)
      .then(async () => {
        try {
          const current = await this.read();
          const changed = await change(current);
          await writeJson(this.filePath, current);
          resolveResult(changed);
        } catch (error) {
          rejectResult(error);
        }
      });

    return result;
  }
}
