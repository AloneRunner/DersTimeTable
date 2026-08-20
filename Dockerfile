FROM python:3.10-slim

WORKDIR /app

COPY server/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server/ .

CMD ["sh", "-c", "if [ -n \"$DATABASE_URL\" ]; then python run_migrations.py || exit 1; fi; exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
