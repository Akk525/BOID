import { z } from "zod";

// Shared serialized values for model, state, and scenario inputs.
export const IdSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/);
export const MicroUsdcSchema = z.string().max(30).regex(/^(0|[1-9][0-9]*)$/);
