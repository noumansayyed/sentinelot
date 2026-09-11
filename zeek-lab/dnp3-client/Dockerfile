FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1
RUN pip install --no-cache-dir dnp3py
COPY dnp3_client.py .
CMD ["python", "dnp3_client.py"]
