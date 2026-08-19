export type CommandOptions = {
  cwd?: string;
  env?: Record<string, string | undefined>;
  input?: string;
  maxBuffer?: number;
  signal?: AbortSignal;
  timeout?: number;
};

export type CommandResult = {
  exitCode: number;
  stderr: string;
  stdout: string;
};

export async function captureCommand(
  command: string,
  args: string[],
  options: CommandOptions = {},
): Promise<CommandResult> {
  const subprocess = Bun.spawn([command, ...args], {
    ...(options.cwd ? { cwd: options.cwd } : {}),
    env: options.env ?? process.env,
    stdin: options.input === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
    ...(options.maxBuffer === undefined ? {} : { maxBuffer: options.maxBuffer }),
  });
  if (options.input !== undefined) {
    if (!subprocess.stdin) throw new Error("subprocess stdin pipe was unavailable");
    subprocess.stdin.write(options.input);
    subprocess.stdin.end();
  }
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
    subprocess.exited,
  ]);
  return { exitCode, stdout, stderr };
}

export async function runCommand(
  command: string,
  args: string[],
  options: CommandOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  const result = await captureCommand(command, args, options);
  if (result.exitCode !== 0) {
    const diagnostic = result.stderr.trim() || result.stdout.trim() || "no diagnostic";
    throw new Error(`${command} exited ${result.exitCode}: ${diagnostic}`);
  }
  return result;
}
