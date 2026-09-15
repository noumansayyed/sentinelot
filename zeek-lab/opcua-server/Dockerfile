FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1
RUN pip install --no-cache-dir asyncua
COPY server.py .
CMD ["python", "server.py"]
