import assert from "node:assert/strict";
import test from "node:test";
import { encodeRunnerEvent, parseRunnerEvent } from "../src/runner-protocol.js";

test("round-trips structured runner activity", () => {
  const event = {
    type: "activity" as const,
    content: { type: "action" as const, action: "Running bash", parameter: "npm test" },
    ephemeral: true,
  };
  assert.deepEqual(parseRunnerEvent(encodeRunnerEvent(event).trim()), event);
});

test("rejects an unknown runner event", () => {
  assert.throws(() => parseRunnerEvent('{"type":"surprise"}'), /invalid event/);
});

test("round-trips Pi task-specific plan updates", () => {
  const event = {
    type: "plan" as const,
    steps: [
      { content: "Inspect the Slack source thread", status: "inProgress" as const },
      { content: "Report the relevant context", status: "pending" as const },
    ],
  };
  assert.deepEqual(parseRunnerEvent(encodeRunnerEvent(event).trim()), event);
});

test("round-trips a generic Linear session attachment", () => {
  const event = {
    type: "external_url" as const,
    label: "Review artifact",
    url: "https://example.com/review/42",
  };
  assert.deepEqual(parseRunnerEvent(encodeRunnerEvent(event).trim()), event);
});

test("round-trips a Linear review artifact", () => {
  const event = {
    type: "artifact" as const,
    filename: "screenshot.png",
    contentType: "image/png",
    dataBase64: "aGVsbG8=",
    title: "Updated homepage",
  };
  assert.deepEqual(parseRunnerEvent(encodeRunnerEvent(event).trim()), event);
});

test("round-trips generic native Linear publications", () => {
  const document = {
    type: "linear_publish" as const,
    publication: { kind: "document" as const, id: "document-id", title: "Review", body: "# Review", update: false },
  };
  const attachment = {
    type: "linear_publish" as const,
    publication: { kind: "attachment" as const, title: "Preview", url: "https://example.com/preview", subtitle: "Ready" },
  };
  assert.deepEqual(parseRunnerEvent(encodeRunnerEvent(document).trim()), document);
  assert.deepEqual(parseRunnerEvent(encodeRunnerEvent(attachment).trim()), attachment);
});

test("round-trips a native Linear select signal", () => {
  const event = {
    type: "activity" as const,
    content: { type: "elicitation" as const, body: "Choose a repository" },
    signal: "select" as const,
    signalMetadata: {
      options: [
        { label: "Nemo", value: "GitSquared/nemo" },
        { label: "Dotfiles", value: "GitSquared/dotfiles" },
      ],
    },
  };
  assert.deepEqual(parseRunnerEvent(encodeRunnerEvent(event).trim()), event);
});

test("round-trips a trusted Linear auth signal", () => {
  const event = {
    type: "activity" as const,
    content: { type: "elicitation" as const, body: "Link the connection capsule" },
    signal: "auth" as const,
    signalMetadata: {
      url: "https://straylight.example.ts.net/linear/capsule/auth",
      providerName: "Claude workbench",
    },
  };
  assert.deepEqual(parseRunnerEvent(encodeRunnerEvent(event).trim()), event);
});
