from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="hi-ide Backend")

# Enable CORS for frontend development (restrict in production)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health():
    return JSONResponse({"status": "ok"})

@app.get("/api/v1/obsidian/notes")
async def list_notes():
    # Placeholder: integrate Obsidian Vault sync here
    return JSONResponse({"notes": []})
