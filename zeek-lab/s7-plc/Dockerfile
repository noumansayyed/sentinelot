FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1
RUN pip install --no-cache-dir python-snap7==3.0.0
COPY s7_server.py .
CMD ["python", "s7_server.py"]
