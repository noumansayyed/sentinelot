"""Status workflow for alerts — every change is logged to alerts_status_log."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from uuid import UUID
import asyncpg, os

router = APIRouter()
DATABASE_URL = os.environ["DATABASE_URL"]
from db import write_audit


class ActionBody(BaseModel):
    action: str          # acknowledge | resolve | false_positive | escalate | reopen
    actor:  str
    reason: str | None = None
    escalation_ref: str | None = None


VALID = {
    "acknowledge":   ("acknowledged", {"open", "escalated"}),
    "resolve":       ("resolved",     {"open", "acknowledged", "escalated"}),
    "false_positive":("false_positive", {"open", "acknowledged", "escalated"}),
    "escalate":      ("escalated",    {"open", "acknowledged"}),
    "reopen":        ("open",         {"acknowledged", "resolved", "false_positive"}),
}


@router.post("/v1/alerts/{alert_id}/action")
async def take_action(alert_id: UUID, body: ActionBody, _: dict = Depends(lambda: None)):
    if body.action not in VALID:
        raise HTTPException(400, f"invalid action; must be one of {list(VALID)}")
    if not body.actor or len(body.actor) < 2:
        raise HTTPException(400, "actor required (operator name)")
    to_status, allowed_from = VALID[body.action]

    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=2)
    try:
        async with pool.acquire() as conn:
            async with conn.transaction():
                row = await conn.fetchrow(
                    "SELECT id, time, status FROM alerts WHERE id = $1 FOR UPDATE", alert_id,
                )
                if not row:
                    raise HTTPException(404, "alert not found")
                if row["status"] not in allowed_from:
                    raise HTTPException(409, f"cannot {body.action} an alert that is {row['status']}")

                # Apply
                if body.action == "escalate":
                    await conn.execute(
                        """UPDATE alerts
                           SET status='escalated', escalated_at=now(),
                               escalated_by=$1, escalation_ref=$2
                           WHERE id=$3""",
                        body.actor, body.escalation_ref, alert_id,
                    )
                elif body.action == "acknowledge":
                    await conn.execute(
                        """UPDATE alerts
                           SET status='acknowledged', acknowledged_by=$1, acknowledged_at=now()
                           WHERE id=$2""",
                        body.actor, alert_id,
                    )
                else:
                    await conn.execute(
                        "UPDATE alerts SET status=$1 WHERE id=$2",
                        to_status, alert_id,
                    )

                # Log transition
                await conn.execute("""
                    INSERT INTO alerts_status_log
                      (alert_id, alert_time, from_status, to_status, actor, reason)
                    VALUES ($1, $2, $3, $4, $5, $6)
                """, alert_id, row["time"], row["status"], to_status, body.actor, body.reason)

                # Log to canonical audit trail
                _alert_row = await conn.fetchrow(
                    "SELECT tenant_id, site_id FROM alerts WHERE id = $1", alert_id
                )
                if _alert_row and _alert_row["tenant_id"]:
                    await write_audit(
                        conn,
                        tenant_id=_alert_row["tenant_id"],
                        site_id=_alert_row["site_id"],
                        actor=body.actor,
                        action=f"alert.{body.action}",
                        target=str(alert_id),
                        target_type="alert",
                        target_id=alert_id,
                        detail=body.reason,
                        details={
                            "from_status": row["status"],
                            "to_status": to_status,
                        },
                    )

                return {"alert_id": str(alert_id),
                        "from": row["status"], "to": to_status, "actor": body.actor}
    finally:
        await pool.close()
