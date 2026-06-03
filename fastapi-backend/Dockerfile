FROM python:3.12-slim

RUN apt-get update && apt-get install -y \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY fastapi-backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY fastapi-backend/ .

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
