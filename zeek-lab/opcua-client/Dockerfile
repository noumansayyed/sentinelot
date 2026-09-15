FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1
RUN pip install --no-cache-dir asyncua
COPY client.py .
CMD ["python", "client.py"]
