# Straylight delegation-loop research

Straylight is the live instrument for exploring a better way to direct software
agents. It is not the proposed final product.

The working model has three coupled thirds:

1. **Harness** — capable models, safe tools, persistent environments, reliable
   execution, and enough evidence to trust what happened.
2. **Intent expression** — letting an engineer steer at the right level, from a
   principle or sketch to a precise instruction, without flattening everything
   into chat.
3. **Attention management** — letting many agents work without turning their
   operator into a shared blocking resource or an alarm console.

Linear is the current control surface and durable work graph. Subscription-backed
Claude Code is now the default runner; Pi is the explicit fallback and later
route for model/provider experiments. These are replaceable parts: semantic
capabilities such as attention requests must survive another harness change.

## Research rule

Use this system for real work. Let repeated friction earn changes. Prefer one
small falsifiable experiment over another broad framework, and keep deployment
separate from local implementation.

For each experiment record:

- the observed failure;
- the hypothesis;
- the smallest change;
- what happened in real tasks;
- keep, revise, or remove.

## Current experiment — rationalized attention

**Observed failure:** an ordinary clarification tool gives an agent an open bar
to interrupt its operator, offers no fleet-level distinction between urgency and
normal review, and often asks for QA before presenting a reviewable artifact.

**Hypothesis:** forcing every loopback into a small Steering/QA contract will
reduce unnecessary interruptions and re-entry cost while creating enough
structured state for an eventual attention queue.

The request must answer:

1. What exact human action is necessary?
2. What original intent is relevant?
3. What new information or artifact changed the state?
4. What does the agent recommend?
5. What happens if the request waits, and how long can it safely wait?

It must also choose `interrupt` or `queue`, native Linear priority, and whether
the human response truly blocks the parent run. The broker turns it into a child
issue assigned to the sponsoring engineer, labelled Steering or QA and Blocking
or FYI. Blocking replies resume the parent; FYIs require acknowledgement while
the parent keeps working. QA is invalid without a preview,
Document, pull request, screenshot, report, or similarly reviewable HTTPS
artifact. The child issue and its Agent Session remain the visible source of
truth; the controller stores only minimal routing and queue metadata.

### Signals to observe

- unnecessary interruptions;
- queued requests that later proved unnecessary;
- time from request to useful response;
- time needed to regain context;
- QA requests missing a usable artifact;
- number of review rounds before ownership;
- unclassified access or blocker waits that deserve their own contract.

## Next hypotheses, not commitments

- An intent packet can preserve the chosen level of expression and make any
  attempted level-switch explicit.
- A visual review packet can bind a preview URL, state/viewport, screenshot or
  annotation, checks, and the last accepted intent.
- Observe whether the in-process Straylight MCP tools are narrow enough to keep
  Claude's authenticated capsule separate from each writable task jail.
- A fleet attention view should project current Linear Agent Sessions and issue
  priority, not become a second task database.
