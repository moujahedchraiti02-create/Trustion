import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, alertsTable, vesselsTable } from "@workspace/db";
import {
  GetAlertsResponse,
  GetAlertsQueryParams,
  AcknowledgeAlertBody,
} from "@workspace/api-zod";
import { requireRole } from "../middleware/auth";
import { writeLimiter } from "../middleware/rateLimiter";

// Alert acknowledgement is an operational action: OPERATOR and ADMIN only.
const requireOperatorOrAdmin = requireRole("OPERATOR", "ADMIN");

const router: IRouter = Router();

router.get("/alerts", async (req, res): Promise<void> => {
  const query = GetAlertsQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }

  const { vesselId, severity, acknowledged } = query.data;
  const conditions = [];
  if (vesselId != null) conditions.push(eq(alertsTable.vesselId, vesselId));
  if (severity != null) conditions.push(eq(alertsTable.severity, severity));
  if (acknowledged != null) conditions.push(eq(alertsTable.acknowledged, acknowledged));

  const alerts = await db
    .select({
      id: alertsTable.id,
      vesselId: alertsTable.vesselId,
      vesselName: vesselsTable.name,
      alertType: alertsTable.alertType,
      severity: alertsTable.severity,
      message: alertsTable.message,
      thresholdPct: alertsTable.thresholdPct,
      currentPct: alertsTable.currentPct,
      acknowledged: alertsTable.acknowledged,
      acknowledgedAt: alertsTable.acknowledgedAt,
      acknowledgedBy: alertsTable.acknowledgedBy,
      createdAt: alertsTable.createdAt,
    })
    .from(alertsTable)
    .leftJoin(vesselsTable, eq(alertsTable.vesselId, vesselsTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(alertsTable.createdAt);

  const serialized = alerts.map((a) => ({
    ...a,
    vesselName: a.vesselName ?? null,
    acknowledgedAt: a.acknowledgedAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
  }));

  res.json(GetAlertsResponse.parse(serialized));
});

router.patch("/alerts/:id/acknowledge", requireOperatorOrAdmin, writeLimiter, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  // Validate the body structure but ignore any caller-supplied identity.
  // The acknowledgedBy value is always derived from the authenticated session,
  // not from the request body, to prevent audit-trail forgery.
  const parsed = AcknowledgeAlertBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const acknowledgedBy = req.auth!.subject;

  const [alert] = await db.update(alertsTable).set({
    acknowledged: true,
    acknowledgedAt: new Date(),
    acknowledgedBy,
  }).where(eq(alertsTable.id, id)).returning();

  if (!alert) { res.status(404).json({ error: "Not found" }); return; }

  const [vessel] = alert.vesselId != null
    ? await db.select({ name: vesselsTable.name }).from(vesselsTable).where(eq(vesselsTable.id, alert.vesselId))
    : [];

  res.json({
    ...alert,
    vesselName: vessel?.name ?? null,
    acknowledgedAt: alert.acknowledgedAt?.toISOString() ?? null,
    createdAt: alert.createdAt.toISOString(),
  });
});

export default router;
