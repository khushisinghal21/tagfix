# Build from the repo root:  docker build -f agent/Dockerfile -t tagfix-agent .
FROM python:3.13-slim
WORKDIR /app
COPY agent/requirements.txt agent/requirements.txt
RUN pip install --no-cache-dir -r agent/requirements.txt
COPY data data
COPY agent agent
WORKDIR /app/agent
ENV PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "uvicorn tagfix_agent.service:app --host 0.0.0.0 --port ${PORT}"]
