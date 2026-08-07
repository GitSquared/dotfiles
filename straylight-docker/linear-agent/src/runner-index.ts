import { loadRunnerConfig, publicRunnerConfig } from "./config.js";
import { PiHarness } from "./pi.js";
import { createRunnerServer } from "./runner-server.js";

const config = loadRunnerConfig(process.env);
const pi = new PiHarness(config);
const server = createRunnerServer(pi);

server.listen(config.port, config.host, () => {
  console.log("Straylight Pi runner listening", publicRunnerConfig(config));
});

function stop(signal: string): void {
  console.log("Stopping Straylight Pi runner", { signal });
  server.close((error) => {
    if (error) {
      console.error("Pi runner shutdown failed", { message: error.message });
      process.exitCode = 1;
    }
  });
}

process.once("SIGINT", () => stop("SIGINT"));
process.once("SIGTERM", () => stop("SIGTERM"));
