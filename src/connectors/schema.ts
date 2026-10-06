import { z } from 'zod';
import { symbolIdSchema } from '../symbols/schema';
export const connectorEndpointSchema = z.strictObject({kind:z.literal('symbol_port'),symbolEntityId:symbolIdSchema,portId:symbolIdSchema});
