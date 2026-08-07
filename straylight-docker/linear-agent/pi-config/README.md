# Pi configuration

This directory becomes `/home/node/.pi/agent` inside the agent container.
Provider authentication can live in an untracked `auth.json`, or in one of the
provider variables in `../.env`. Pi settings, models, extensions, skills, and
prompts may also live here.

Only this README is public. Bootstrap and the encrypted configuration backup
preserve the mutable contents without adding them to yadm.
