// Endpoints routes
import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { asyncHandler } from '../utils/asyncHandler'
import { createEndpoint } from '../services/endpointService'

const router = Router()

router.use(authenticate)

router.post('/', asyncHandler(createEndpoint))

export default router
