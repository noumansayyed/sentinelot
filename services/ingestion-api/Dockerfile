FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py db.py ./
COPY protocols.py .
COPY operations.py .
COPY playbook.py .
COPY classify_devices.py .
COPY alert_actions.py .
COPY tenant.py .
COPY site_admin.py .
COPY asset_admin.py .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
