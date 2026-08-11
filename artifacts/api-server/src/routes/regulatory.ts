import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, regulatoryProfilesTable } from "@workspace/db";
import {
  GetRegulatoryProfilesResponse,
  CreateRegulatoryProfileBody,
  GetRegulatoryProfileResponse,
} from "@workspace/api-zod";
import { requireApiKey } from "../middleware/auth";

const router: IRouter = Router();

router.get("/regulatory-profiles", async (req, res): Promise<void> => {
  const profiles = await db.select().from(regulatoryProfilesTable).orderBy(regulatoryProfilesTable.effectiveDate);
  const serialized = profiles.map((p) => ({
    ...p,
    createdAt: p.createdAt.toISOString(),
  }));
  res.json(GetRegulatoryProfilesResponse.parse(serialized));
});

router.post("/regulatory-profiles", requireApiKey, async (req, res): Promise<void> => {
  const parsed = CreateRegulatoryProfileBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [profile] = await db.insert(regulatoryProfilesTable).values(parsed.data).returning();
  res.status(201).json({ ...profile, createdAt: profile.createdAt.toISOString() });
});

router.get("/regulatory-profiles/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [profile] = await db.select().from(regulatoryProfilesTable).where(eq(regulatoryProfilesTable.id, id));
  if (!profile) { res.status(404).json({ error: "Not found" }); return; }
  res.json(GetRegulatoryProfileResponse.parse({ ...profile, createdAt: profile.createdAt.toISOString() }));
});

export default router;
