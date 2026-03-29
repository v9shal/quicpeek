// Endpoints routes
import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { asyncHandler } from '../utils/asyncHandler'
import {
    createEndpoint,
    getEndpoints,
    getEndpoint,
    updateEndpoint,
    deleteEndpoint,
    pauseEndpoint,
    resumeEndpoint,
    getEndpointMetrics,
} from '../services/endpointService'

const router = Router()

router.use(authenticate)

router.get('/',                        asyncHandler(getEndpoints))
router.post('/',                       asyncHandler(createEndpoint))
router.get('/:id',                     asyncHandler(getEndpoint))
router.put('/:id',                     asyncHandler(updateEndpoint))
router.delete('/:id',                  asyncHandler(deleteEndpoint))
router.patch('/:id/pause',             asyncHandler(pauseEndpoint))
router.patch('/:id/resume',            asyncHandler(resumeEndpoint))
router.get('/:id/metrics',             asyncHandler(getEndpointMetrics))

export default router
