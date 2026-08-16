FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1
RUN pip install --no-cache-dir pymodbus==3.7.4
COPY hmi.py .
CMD ["python", "hmi.py"]
