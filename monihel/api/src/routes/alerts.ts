// Alerts routes
import { Router } from 'express';

const router = Router();

// GET /alerts
router.get('/', (_req, res) => {
  res.json({ alerts: [] });
});

export default router;
