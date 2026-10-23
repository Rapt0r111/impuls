import { z } from "zod";

// Points for one task, bonuses included (ADR-0041). The server and the database enforce the same cap.
export const TASK_POINTS_MAX = 100;
export const taskPointsSchema = z.number().int().min(0).max(TASK_POINTS_MAX);

// XP for one task, bonuses included (ADR-0042): the same 0–100 scale as points.
export const TASK_XP_MAX = 100;
export const taskXpSchema = z.number().int().min(0).max(TASK_XP_MAX);
