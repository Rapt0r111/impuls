import { describe, expect, it } from "vitest";
import {
  openTaskListResponseSchema,
  taskClaimRequestSchema,
  taskSubmissionHeadersSchema,
  taskSubmissionRequestSchema,
  taskSubmissionResponseSchema,
  taskStartRequestSchema,
  taskStartResponseSchema,
} from "./tasks";

const taskId = "550e8400-e29b-41d4-a716-446655440000";
const submissionId = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";
const scopeId = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const now = "2026-09-29T12:00:00.000Z";

const taskDetail = {
  id: taskId,
  title: "Проверить гипотезу",
  status: "in_review",
  priority: "normal",
  dueAt: now,
  fundXp: 10,
  fundPoints: 2,
  ruleVersion: 1,
  version: 2,
  updatedAt: now,
  criteria: "Краткий отчёт с результатами",
  latestSubmission: {
    id: submissionId,
    text: "Результаты проверки",
    version: 1,
    createdAt: now,
  },
  scope: { id: scopeId, kind: "group", name: "Синтетическая группа" },
} as const;

describe("task submission contracts", () => {
  it("accepts a UUID idempotency key and rejects malformed keys", () => {
    expect(
      taskSubmissionHeadersSchema.safeParse({
        idempotencyKey: submissionId,
      }).success,
    ).toBe(true);
    expect(
      taskSubmissionHeadersSchema.safeParse({ idempotencyKey: "not-a-uuid" })
        .success,
    ).toBe(false);
    expect(
      taskSubmissionHeadersSchema.safeParse({
        idempotencyKey: submissionId,
        extra: true,
      }).success,
    ).toBe(false);
  });

  it("trims report text and enforces strict fields and boundaries", () => {
    expect(
      taskSubmissionRequestSchema.parse({
        expectedVersion: 1,
        text: "  Отчёт  ",
      }),
    ).toEqual({ expectedVersion: 1, text: "Отчёт" });
    expect(
      taskSubmissionRequestSchema.safeParse({
        expectedVersion: 1,
        text: " \n ",
      }).success,
    ).toBe(false);
    expect(
      taskSubmissionRequestSchema.safeParse({
        expectedVersion: 1,
        text: "x".repeat(4001),
      }).success,
    ).toBe(false);
    expect(
      taskSubmissionRequestSchema.safeParse({
        expectedVersion: 0,
        text: "Отчёт",
      }).success,
    ).toBe(false);
    expect(
      taskSubmissionRequestSchema.safeParse({
        expectedVersion: 1,
        text: "Отчёт",
        extra: true,
      }).success,
    ).toBe(false);
  });

  it("validates the 201 response with its refreshed assigned task detail", () => {
    expect(
      taskSubmissionResponseSchema.safeParse({
        submission: {
          id: submissionId,
          taskId,
          text: "Результаты проверки",
          version: 1,
          createdAt: now,
        },
        task: taskDetail,
      }).success,
    ).toBe(true);

    expect(
      taskSubmissionResponseSchema.safeParse({
        submission: {
          id: submissionId,
          taskId,
          text: "Результаты проверки",
          version: 1,
          createdAt: now,
        },
        task: { ...taskDetail, latestSubmission: null },
      }).success,
    ).toBe(true);
  });
});

describe("task start contracts", () => {
  it("accepts only a positive expected version and the start action", () => {
    expect(
      taskStartRequestSchema.safeParse({
        expectedVersion: 1,
        action: "start",
      }).success,
    ).toBe(true);
    expect(
      taskStartRequestSchema.safeParse({
        expectedVersion: 0,
        action: "start",
      }).success,
    ).toBe(false);
    expect(
      taskStartRequestSchema.safeParse({
        expectedVersion: 1,
        action: "pause",
      }).success,
    ).toBe(false);
    expect(
      taskStartRequestSchema.safeParse({
        expectedVersion: 1,
        action: "start",
        extra: true,
      }).success,
    ).toBe(false);
  });

  it("validates the refreshed assigned task detail response", () => {
    expect(
      taskStartResponseSchema.safeParse({ task: taskDetail }).success,
    ).toBe(true);
    expect(
      taskStartResponseSchema.safeParse({
        task: { ...taskDetail, latestSubmission: null },
      }).success,
    ).toBe(true);
  });

  it("validates free task lists and the claim request strictly", () => {
    const open = {
      id: taskId,
      title: "Free",
      criteria: "Do it",
      priority: "normal",
      dueAt: "2035-01-01T00:00:00.000Z",
      fundXp: 10,
      fundPoints: 5,
      version: 1,
      updatedAt: "2026-10-12T08:00:00.000Z",
      scope: { id: scopeId, kind: "group", name: "Scope" },
    };
    expect(
      openTaskListResponseSchema.safeParse({ items: [open] }).success,
    ).toBe(true);
    expect(
      openTaskListResponseSchema.safeParse({ items: Array(51).fill(open) })
        .success,
    ).toBe(false);
    expect(
      taskClaimRequestSchema.safeParse({ action: "claim", expectedVersion: 1 })
        .success,
    ).toBe(true);
    for (const bad of [
      { action: "start", expectedVersion: 1 },
      { action: "claim", expectedVersion: 0 },
      { action: "claim", expectedVersion: 1, assigneeId: taskId },
    ])
      expect(taskClaimRequestSchema.safeParse(bad).success).toBe(false);
  });
});
