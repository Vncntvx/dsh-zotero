# AGENTS.md

## Git commit conventions

Follow [Conventional Commits](https://www.conventionalcommits.org/): `<type>(<scope>): <subject>`, types lowercase (`feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `style`, `build`, `ci`, `revert`), subject in imperative mood, header under 72 chars. Optionally place an emoji matching the type right after the colon, before the subject. Body: blank line, bullet points only, each item wraps at 72, what and why.

## Typecheck

Run `npm run typecheck` (tsc --noEmit) after changing TypeScript code.
