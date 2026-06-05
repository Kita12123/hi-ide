import os
import asyncio
import uuid
from typing import Dict, Any
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Configuration
API_KEY = os.environ.get('HI_IDE_API_KEY')  # optional API key for protecting agent endpoints
BACKEND_BIND_ADDR = os.environ.get('BACKEND_BIND_ADDR', '127.0.0.1')
COPILOT_CMD = os.environ.get('COPILOT_CMD', 'copilot')
MAX_PROMPT_LENGTH = int(os.environ.get('MAX_PROMPT_LENGTH', '20000'))

app = FastAPI(title="hi-ide Backend")

# Enable CORS for frontend development (restrict in production)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get('/health')
async def health():
    return JSONResponse({'status': 'ok'})

@app.get('/api/v1/obsidian/notes')
async def list_notes():
    # Placeholder: integrate Obsidian Vault sync here
    return JSONResponse({'notes': []})

# In-memory job store: job_id -> { queue: asyncio.Queue, status: 'running'|'done'|'failed' }
_jobs: Dict[str, Dict[str, Any]] = {}

class AgentStartRequest(BaseModel):
    prompt: str

def _authorize(request: Request):
    if API_KEY:
        header = request.headers.get('x-api-key')
        if not header or header != API_KEY:
            raise HTTPException(status_code=401, detail='Unauthorized')

def _sanitize_prompt(prompt: str) -> str:
    # Basic sanitation: strip nulls and enforce length limit
    if '\x00' in prompt:
        prompt = prompt.replace('\x00', '')
    if len(prompt) > MAX_PROMPT_LENGTH:
        raise HTTPException(status_code=400, detail=f'Prompt too long (max {MAX_PROMPT_LENGTH} chars)')
    return prompt

async def _run_copilot_background(job_id: str, prompt: str):
    """Spawn copilot process and stream stdout lines into the job queue.

    Uses non-interactive mode (-p) with streaming enabled where supported.
    On platforms where asyncio subprocess APIs are not available, falls back to
    running subprocess in a thread and pushing output back into the asyncio queue.
    """
    job = _jobs.get(job_id)
    if not job:
        return
    queue: asyncio.Queue = job['queue']
    job['status'] = 'running'

    loop = asyncio.get_event_loop()

    async def _put_line(line: str):
        await queue.put(line)

    try:
        # Try asyncio subprocess (preferred)
        proc = await asyncio.create_subprocess_exec(
            COPILOT_CMD, '-p', prompt, '--silent', '--stream', 'on',
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT
        )

        while True:
            line = await proc.stdout.readline()
            if not line:
                break
            text = line.decode('utf-8', errors='replace')
            await queue.put(text)

        await proc.wait()
        job['status'] = 'done'
        await queue.put(None)
        return
    except NotImplementedError:
        # Fall through to threaded fallback
        pass
    except Exception as e:
        # Other exceptions: record and finish
        job['status'] = 'failed'
        await queue.put(f"[agent error] {repr(e)}\n")
        await queue.put(None)
        return

    # Threaded fallback for environments where asyncio subprocess isn't available
    def _thread_target():
        try:
            import subprocess as _sub
            import shlex
            p = None
            # First try direct exec
            try:
                p = _sub.Popen([COPILOT_CMD, '-p', prompt, '--silent', '--stream', 'on'], stdout=_sub.PIPE, stderr=_sub.STDOUT)
            except FileNotFoundError:
                # Try to invoke via pwsh/powershell with command string
                cmd_str = f"{COPILOT_CMD} -p {shlex.quote(prompt)} --silent --stream on"
                tried = []
                for shell_bin in ('pwsh', 'powershell'):
                    try:
                        p = _sub.Popen([shell_bin, '-Command', cmd_str], stdout=_sub.PIPE, stderr=_sub.STDOUT)
                        break
                    except Exception as e:
                        tried.append((shell_bin, str(e)))
                if p is None:
                    # last resort: shell True
                    try:
                        p = _sub.Popen(cmd_str, stdout=_sub.PIPE, stderr=_sub.STDOUT, shell=True)
                    except Exception as e:
                        raise FileNotFoundError(f"Unable to execute copilot via direct call or shell: {e}; tried: {tried}")

            for raw in iter(p.stdout.readline, b""):
                try:
                    text = raw.decode('utf-8', errors='replace')
                except Exception:
                    text = str(raw)
                # push into asyncio queue thread-safely
                loop.call_soon_threadsafe(lambda t=text: asyncio.create_task(queue.put(t)))
            p.wait()
            loop.call_soon_threadsafe(lambda: asyncio.create_task(queue.put(None)))
            loop.call_soon_threadsafe(lambda: asyncio.create_task(_set_status_done(job_id)))
        except Exception as e:
            loop.call_soon_threadsafe(lambda: asyncio.create_task(queue.put(f"[agent error] {repr(e)}\n")))
            loop.call_soon_threadsafe(lambda: asyncio.create_task(queue.put(None)))
            loop.call_soon_threadsafe(lambda: asyncio.create_task(_set_status_failed(job_id)))

    async def _set_status_done(jid: str):
        j = _jobs.get(jid)
        if j:
            j['status'] = 'done'

    async def _set_status_failed(jid: str):
        j = _jobs.get(jid)
        if j:
            j['status'] = 'failed'

    import threading
    t = threading.Thread(target=_thread_target, daemon=True)
    t.start()
    return

@app.post('/api/v1/agent/start')
async def start_agent(request: Request, body: AgentStartRequest):
    _authorize(request)
    prompt = _sanitize_prompt(body.prompt)

    job_id = str(uuid.uuid4())
    q: asyncio.Queue = asyncio.Queue()
    _jobs[job_id] = {'queue': q, 'status': 'pending'}

    # start background task
    asyncio.create_task(_run_copilot_background(job_id, prompt))

    return JSONResponse({'success': True, 'job_id': job_id})

@app.get('/api/v1/agent/stream/{job_id}')
async def stream_agent(request: Request, job_id: str):
    # Stream output as Server-Sent Events (SSE)
    if job_id not in _jobs:
        raise HTTPException(status_code=404, detail='job_id not found')

    q: asyncio.Queue = _jobs[job_id]['queue']

    async def event_generator():
        # If client disconnects, exit
        try:
            while True:
                item = await q.get()
                if item is None:
                    # completion sentinel
                    yield 'event: done\ndata: \n\n'
                    break
                # SSE event per line
                # Escape data newlines
                data = item.rstrip('\n')
                for chunk in data.split('\n'):
                    yield f'data: {chunk}\n\n'
        except asyncio.CancelledError:
            return

    return StreamingResponse(event_generator(), media_type='text/event-stream')

@app.get('/api/v1/agent/status/{job_id}')
async def agent_status(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail='job_id not found')
    return JSONResponse({'job_id': job_id, 'status': job['status']})

@app.post('/api/v1/agent')
async def run_agent_sync(request: Request, body: AgentStartRequest):
    # Convenience endpoint: start job and wait for completion (not recommended for long runs)
    _authorize(request)
    prompt = _sanitize_prompt(body.prompt)
    job_id = str(uuid.uuid4())
    q: asyncio.Queue = asyncio.Queue()
    _jobs[job_id] = {'queue': q, 'status': 'pending'}
    # run and wait
    await _run_copilot_background(job_id, prompt)
    # collect all output
    out_lines = []
    while True:
        item = await q.get()
        if item is None:
            break
        out_lines.append(item)
    return JSONResponse({'success': True, 'job_id': job_id, 'text': ''.join(out_lines)})