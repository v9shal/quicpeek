// Endpoints routes
import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { asyncHandler } from '../utils/asyncHandler'
import { createEndpoint, getEndpoints } from '../services/endpointService'

const router = Router()

router.use(authenticate)

router.get('/', asyncHandler(getEndpoints))
router.post('/', asyncHandler(createEndpoint))

export default router
