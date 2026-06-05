Backend scaffold for hi-ide

Run locally:
```shell
# 1. Move to backend directory:
cd backend
# 2. Install Python dependencies using uv (recommended):
uv sync
# 3. Start backend (development):
uv run uvicorn app.main:app --reload --port 8000 --host 127.0.0.1
```

Endpoints:
- GET /health -> health check
- GET /api/v1/obsidian/notes -> placeholder for Obsidian notes
