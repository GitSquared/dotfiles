# Pi configuration

This directory becomes `/home/node/.pi/agent` inside the agent container.
Provider authentication can live in an untracked `auth.json`. Pi settings,
custom providers, models, extensions, skills, and prompts may also live here.

Two reviewed files are public: `model-policy.json` is the ordered model
allowlist and `extensions/rtk.ts` is the pinned RTK integration. Bootstrap and
the encrypted configuration backup preserve all other mutable contents without
adding them to yadm.

The allowlist is ordered from cheapest to strongest. `classifier` chooses the
small model used only to route a new session, `fallback` is used when routing
fails, and each model entry fixes its normal reasoning level. Model names must
be unique lowercase labels.
