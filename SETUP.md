![alt text](image-1.png)

To start Postgres:

```
cd /home/anas/Development/Dakar/twilio-media-phone
docker compose up -d db
NEXT_PUBLIC_VOICE_AGENT_URL=http://localhost:8000 pnpm dev
```

# Environment Variables to put in .env

```
# ── Voice Agent (your local ai-voice-agent) ────────────────
NEXT_PUBLIC_VOICE_AGENT_URL=http://localhost:8000
VOICE_AGENT_URL=http://localhost:8000

# ── Database (PostgreSQL) ──────────────────────────────────
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/twiliomediaphone

# ── Auth ───────────────────────────────────────────────────
NEXTAUTH_SECRET=dev-local-secret-change-in-production
NEXTAUTH_URL=http://localhost:3000
SUPER_ADMIN_EMAIL=admin@example.com
SUPER_ADMIN_PASSWORD=admin123

# ── AI Core ────────────────────────────────────────────────
AI_CORE_URL=http://ai-api.anas31.qzz.io
AI_CORE_API_KEY=dev-secret
```

