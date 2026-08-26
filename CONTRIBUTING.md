# Contributing

Thanks for helping improve Create Schematic Viewer. Focused bug fixes,
documentation, tests, and well-scoped features are welcome.

## Before you start

- Search existing issues and pull requests before opening a duplicate.
- Open a feature request before making a large change or changing a public
  interface.
- Keep pull requests focused on one concern.
- Do not commit Minecraft, Create, mod, resource-pack, or third-party assets.
  Use original or synthetic fixtures that can be redistributed.
- Do not include secrets, personal information, private server data, or player
  data in code, fixtures, screenshots, logs, commits, or issue reports.

## Set up the project

Install Node.js 22 or newer and Python 3.10 or newer, then run:

```shell
npm run setup
npm start
```

Open <http://localhost:4173> to exercise the browser UI.

## Make a change

1. Create a descriptively named feature or fix branch.
2. Make the smallest coherent change that solves the issue.
3. Add or update tests for changed behavior.
4. Update user-facing documentation when behavior changes.
5. Verify the complete local check set.

```shell
npm run check
npm test
npm run check:converter
```

Converter tests use synthetic NBT fixtures and do not require Minecraft.

## Open a pull request

Complete the pull request template and explain both the need and the observable
result. Include screenshots for meaningful UI changes and note any behavior
that could affect schematic compatibility. Maintainers may ask for a smaller
scope or additional tests before review.

By submitting a contribution, you agree that it may be distributed under this
project's [MIT License](LICENSE).

## Community expectations

Participation in this project is governed by the
[Code of Conduct](CODE_OF_CONDUCT.md). Report security issues through the
process in [SECURITY.md](SECURITY.md), not through a public bug report.
