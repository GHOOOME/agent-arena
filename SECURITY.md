# Security

Agent Arena is designed for local machines and trusted LANs. Do not expose it directly to the public internet.

## Secrets

- Never commit real API keys, database passwords, local runtime state, generated assets, or screenshots that show secrets.
- Token Plan keys should be configured in the app sidebar or in local `.env.local`.
- `.env`, `.env.*`, `.arena-local/`, `.codex-runtime/`, and local agent/editor folders are ignored by Git.
- `.env.example` is the only environment file intended to be committed.

Before publishing or pushing changes, run:

```bash
npm run security:check
```

## Local Agent Risk

This project can read and modify files in user-selected local projects. Only bind projects you trust, review tool permissions before enabling write or command execution, and avoid running it as a public multi-user service.
