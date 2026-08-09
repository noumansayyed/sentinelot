"""
SentinelOT — Ingestion API
Receives batched protocol-event telemetry from on-prem edge agents over mTLS,
validates and normalizes it, and publishes it to Kafka/Redpanda for downstream
stream processing.
"""

import json
import logging
import os
from datetime import datetime, timezone
from typing import Literal, Optional
from uuid import UUID

from confluent_kafka import Producer
from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from pydantic import BaseModel, Field, field_validator

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("sentinelot.ingestion")

app = FastAPI(
    title="SentinelOT Ingestion API",
    version="1.0.0",
    description="Receives OT/IIoT protocol telemetry from edge sensors.",
)

# DEV-ONLY: wide-open CORS so the static dashboard (served from a different
# origin/port) can call this API directly. Before any real deployment this
# must be locked down to the actual dashboard's origin -- flagged here
# explicitly, same as the JWT-verification gap noted earlier.
from fastapi.middleware.cors import CORSMiddleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

KAFKA_BOOTSTRAP_SERVERS = os.environ["KAFKA_BOOTSTRAP_SERVERS"]
KEYCLOAK_ISSUER_URL = os.environ["KEYCLOAK_ISSUER_URL"]
PROTOCOL_EVENTS_TOPIC = "protocol-events"

producer = Producer({"bootstrap.servers": KAFKA_BOOTSTRAP_SERVERS})

bearer_scheme = HTTPBearer(auto_error=False)


class ProtocolEvent(BaseModel):
    timestamp: datetime
    zeek_uid: str = Field(..., description="Zeek connection UID for forensic correlation")
    protocol: Literal["modbus_tcp", "dnp3", "s7comm", "opcua", "enip", "bacnet"]
    src_mac: Optional[str] = None
    dst_mac: Optional[str] = None
    src_ip: str
    dst_ip: str
    function_code: Optional[str] = None
    payload_summary: dict = Field(default_factory=dict)

    @field_validator("timestamp")
    @classmethod
    def _reject_future_timestamps(cls, v: datetime) -> datetime:
        now = datetime.now(timezone.utc)
        if v.tzinfo is None:
            v = v.replace(tzinfo=timezone.utc)
        if v > now.replace(microsecond=0) and (v - now).total_seconds() > 300:
            raise ValueError("event timestamp is more than 5 minutes in the future")
        return v


class IngestBatch(BaseModel):
    sensor_id: UUID
    site_id: UUID
    events: list[ProtocolEvent] = Field(..., max_length=5000)


class IngestResponse(BaseModel):
    accepted: int
    rejected: int


async def verify_sensor(request: Request) -> UUID:
    fingerprint = request.headers.get("X-Client-Cert-Fingerprint")
    if not fingerprint:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="missing mTLS client certificate",
        )
    sensor_id = await lookup_sensor_id_by_fingerprint(fingerprint)
    if sensor_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="unrecognized sensor certificate",
        )
    return sensor_id


async def lookup_sensor_id_by_fingerprint(fingerprint: str) -> Optional[UUID]:
    from db import get_sensor_by_fingerprint

    sensor = await get_sensor_by_fingerprint(fingerprint)
    return sensor.id if sensor else None


async def verify_user_jwt(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> dict:
    if creds is None:
        raise HTTPException(status_code=401, detail="missing bearer token")
    try:
        claims = jwt.get_unverified_claims(creds.credentials)
        if claims.get("iss") != KEYCLOAK_ISSUER_URL:
            raise HTTPException(status_code=401, detail="invalid token issuer")
        return claims
    except JWTError as exc:
        raise HTTPException(status_code=401, detail="invalid token") from exc


@app.post("/v1/ingest/events", response_model=IngestResponse, status_code=202)
async def ingest_events(
    batch: IngestBatch,
    sensor_id: UUID = Depends(verify_sensor),
):
    if batch.sensor_id != sensor_id:
        raise HTTPException(
            status_code=403,
            detail="sensor_id in payload does not match authenticated certificate",
        )

    accepted, rejected = 0, 0
    for event in batch.events:
        try:
            key = str(batch.site_id).encode()
            # Embed sensor_id/site_id into the message body itself -- the
            # stream processor needs both, and protocol_events.sensor_id is
            # NOT NULL, so it must never be omitted here.
            payload = event.model_dump(mode="json")
            payload["sensor_id"] = str(batch.sensor_id)
            payload["site_id"] = str(batch.site_id)
            value = json.dumps(payload).encode()
            producer.produce(PROTOCOL_EVENTS_TOPIC, key=key, value=value)
            accepted += 1
        except BufferError:
            logger.warning("Kafka producer queue full; event dropped, will be retried by edge agent buffer")
            rejected += 1
    producer.poll(0)

    logger.info(
        "ingest sensor=%s site=%s accepted=%d rejected=%d",
        sensor_id, batch.site_id, accepted, rejected,
    )
    return IngestResponse(accepted=accepted, rejected=rejected)


@app.get("/v1/sensors/{sensor_id}/health")
async def sensor_health(sensor_id: UUID, _: dict = Depends(verify_user_jwt)):
    from db import get_sensor_by_id

    sensor = await get_sensor_by_id(sensor_id)
    if sensor is None:
        raise HTTPException(status_code=404, detail="sensor not found")
    return {
        "sensor_id": str(sensor.id),
        "status": sensor.status,
        "last_heartbeat_at": sensor.last_heartbeat_at,
        "software_version": sensor.software_version,
    }


class RegisterSensorRequest(BaseModel):
    site_id: UUID
    label: str
    mtls_cert_fingerprint: str


class RegisterSensorResponse(BaseModel):
    sensor_id: UUID
    status: str


@app.post("/v1/sensors/register", response_model=RegisterSensorResponse, status_code=201)
async def register_sensor(req: RegisterSensorRequest, _: dict = Depends(verify_user_jwt)):
    from db import register_sensor as db_register_sensor, site_exists

    if not await site_exists(req.site_id):
        raise HTTPException(status_code=404, detail="site not found")

    sensor_id = await db_register_sensor(req.site_id, req.label, req.mtls_cert_fingerprint)
    return RegisterSensorResponse(sensor_id=sensor_id, status="provisioned")


@app.get("/v1/sites/{site_id}/assets")
async def list_assets(site_id: UUID):
    # NOTE: no auth check yet -- same known, flagged gap as verify_user_jwt
    # elsewhere in this file. Must be locked down (require verify_user_jwt
    # AND check the user's tenant owns this site) before any real deployment.
    from db import list_assets_for_site

    assets = await list_assets_for_site(site_id)
    return {"site_id": str(site_id), "assets": assets}


@app.get("/v1/sites/{site_id}/alerts")
async def list_alerts(site_id: UUID):
    from db import list_alerts_for_site

    alerts = await list_alerts_for_site(site_id)
    return {"site_id": str(site_id), "alerts": alerts}


@app.get("/healthz")
async def healthz():
    return {"status": "ok"}
