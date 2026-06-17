# Zhiqun Schedule Backend

FastAPI backend for the MVP version of the shared schedule and timetable mini program.

## Stack

- FastAPI
- SQLAlchemy 2 async
- Alembic
- MySQL 8 for production
- SQLite for local prototype defaults
- Redis for later WebSocket fan-out

## Local Development

```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
uvicorn app.main:app --reload
```

By default, `.env.example` points to a local SQLite database so the API can be brought up before MySQL is configured.

## DeepSeek NLP

Natural language parsing can use DeepSeek before falling back to the local rule parser. Keep the API key on the backend only.

```powershell
DEEPSEEK_NLP_ENABLED=true
DEEPSEEK_API_KEY=your-api-key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
```

If DeepSeek is not configured, times out, or returns invalid JSON, `/api/nlp/parse` automatically uses the local parser.
