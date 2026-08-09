import assert from "node:assert/strict";
import test from "node:test";
import { documentCreateInput, graphqlErrorMessage } from "../src/linear.js";

test("creates an issue-backed Linear document without an invalid optional icon", () => {
  assert.deepEqual(documentCreateInput("issue-id", "document-id", "Review", "# Hello"), {
    id: "document-id",
    issueId: "issue-id",
    title: "Review",
    content: "# Hello",
  });
});

test("surfaces safe Linear argument validation details", () => {
  assert.equal(graphqlErrorMessage({
    message: "Argument Validation Error",
    extensions: {
      code: "INVALID_INPUT",
      validationErrors: [{ constraints: { isValid: "icon must be a supported icon name" } }],
    },
  }, 200), "Argument Validation Error: icon must be a supported icon name");
});
