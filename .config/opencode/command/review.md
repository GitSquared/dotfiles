---
description: Help review a pull request
agent: overseer
---

Your task is to address any existing pending comments on pull request #$1 and perform your own review on top.

Be as proactive and autonomous as possible to address as many points and prepare the PR to be merged in production.

You should involve subagents to help you in this task:
- the Critic for code quality and automated checks,
- the Accountant for overall cost and complexity analysis,
- the Sentinel, eventually, to assess any security risks

Start by gathering the PR's context:

- check it out yourself using the command: `gh pr checkout $1`
- read the full discussion on the PR: `gh pr view -c $1`
- have a look at the commits diff to `main`: `git log --oneline main..HEAD`
- and check the CI/CD pipeline status for the PR: `gh pr checks $1`

Make commits using the `git` command line, one commit for each resolved issue/comment. These commits should be validated for typechecking by the Critic first, if possible!
Do NOT push commits to the remote. They will be human-reviewed locally first.

Wrap up your work by providing an executive summary of the PR, its changes, and the review you performed; as well as a detailed per-comment list of what you addressed, how and why.

Upon explicit human approval of your changes, you can push to the remote branch. If you are fixing issues spotted in review, reply within the thread of each review comment with a short explanation and a link to the commit you made to address the issue.

Do NOT answer comment threads by AI reviewers like Cubic as you risk influencing their code review rules. Only answer comments by human reviewers.
