import { Router, type IRouter } from "express";
import healthRouter from "./health";
import dashboardRouter from "./dashboard";
import vesselsRouter from "./vessels";
import ledgerRouter from "./ledger";
import emissionsRouter from "./emissions";
import regulatoryRouter from "./regulatory";
import alertsRouter from "./alerts";
import auditorRouter from "./auditor";
import keyRegistryRouter from "./keyRegistry";

const router: IRouter = Router();

router.use(healthRouter);
router.use(dashboardRouter);
router.use(vesselsRouter);
router.use(ledgerRouter);
router.use(emissionsRouter);
router.use(regulatoryRouter);
router.use(alertsRouter);
router.use(auditorRouter);
router.use(keyRegistryRouter);

export default router;
