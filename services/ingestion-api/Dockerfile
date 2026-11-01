FROM python:3.12-slim
COPY --from=docker:27-cli /usr/local/bin/docker /usr/local/bin/docker

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
COPY reports.py .
COPY report_api.py .
COPY site_admin.py .
COPY asset_admin.py .
COPY settings_api.py .
COPY sensor_api.py .
COPY capture_api.py .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
