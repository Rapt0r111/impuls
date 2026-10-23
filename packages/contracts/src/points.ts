import { z } from "zod";

// Points for one task, bonuses included (ADR-0041). The server and the database enforce the same cap.
export const TASK_POINTS_MAX = 100;
export const taskPointsSchema = z.number().int().min(0).max(TASK_POINTS_MAX);
