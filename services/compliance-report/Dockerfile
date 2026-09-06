FROM python:3.12-slim
WORKDIR /app
RUN pip install --no-cache-dir -r requirements.txt 2>/dev/null || true
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY generate_report.py .
CMD ["python", "generate_report.py"]
