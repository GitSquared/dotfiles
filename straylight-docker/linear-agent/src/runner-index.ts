import { loadRunnerConfig, publicRunnerConfig } from "./config.js";
import { PiHarness } from "./pi.js";
import { createRunnerServer, RUNNER_MAX_BODY_BYTES } from "./runner-server.js";

const config = loadRunnerConfig(process.env);
const pi = new PiHarness(config);
const server = Bun.serve({
  hostname: config.host,
  port: config.port,
  maxRequestBodySize: RUNNER_MAX_BODY_BYTES,
  fetch: createRunnerServer(pi, config.authToken),
});
console.log("Straylight Pi runner listening", publicRunnerConfig(config));

async function stop(signal: string): Promise<void> {
  console.log("Stopping Straylight Pi runner", { signal });
  await server.stop();
}

process.once("SIGINT", () => { void stop("SIGINT"); });
process.once("SIGTERM", () => { void stop("SIGTERM"); });
