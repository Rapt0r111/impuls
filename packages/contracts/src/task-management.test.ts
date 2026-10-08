import { describe, expect, it } from "vitest";
import {
  managementTaskSchema,
  taskAssignRequestSchema,
  taskEditRequestSchema,
  taskCancelRequestSchema,
  taskCreateRequestSchema,
  taskManagementListQuerySchema,
  taskManagementListResponseSchema,
  taskManagementOptionsResponseSchema,
} from "./task-management";

const ids = {
  task: "11111111-1111-4111-8111-111111111111",
  scope: "22222222-2222-4222-8222-222222222222",
  rules: "33333333-3333-4333-8333-333333333333",
  assignee: "44444444-4444-4444-8444-444444444444",
};

const task = {
  id: ids.task,
  title: "Task title",
  criteria: "Acceptance criteria",
  categoryCode: "maintenance",
  priority: "normal",
  status: "draft",
  dueAt: "2026-10-01T12:00:00.000Z",
  fundXp: 100,
  fundPoints: 50,
  ruleSetId: ids.rules,
  ruleVersion: 1,
  version: 1,
  updatedAt: "2026-09-30T12:00:00.000Z",
  scope: { id: ids.scope, kind: "group", name: "Group" },
  assignee: null,
};

const createBody = {
  scopeId: ids.scope,
  ruleSetId: ids.rules,
  title: " Task title ",
  criteria: " Acceptance criteria ",
  categoryCode: " maintenance ",
  priority: "normal",
  dueAt: "2026-10-01T12:00:00.000Z",
  fundXp: 100,
  fundPoints: 50,
};

describe("task management contracts", () => {
  it("requires a reason/version for changes and rejects scope/rule/assignee changes", () => {
    const { scopeId: _scope, ruleSetId: _rule, ...fields } = createBody;
    expect([_scope, _rule]).toEqual([ids.scope, ids.rules]);
    const edit = { ...fields, expectedVersion: 1, reason: " Correction " };
    expect(taskEditRequestSchema.parse(edit).reason).toBe("Correction");
    for (const patch of [
      { reason: " " },
      { reason: "x".repeat(2001) },
      { expectedVersion: 0 },
      { scopeId: ids.scope },
      { ruleSetId: ids.rules },
      { assigneeId: ids.assignee },
    ])
      expect(
        taskEditRequestSchema.safeParse({ ...edit, ...patch }).success,
      ).toBe(false);
    expect(
      taskCancelRequestSchema.safeParse({
        expectedVersion: 1,
        reason: "Cancel",
      }).success,
    ).toBe(true);
    for (const body of [
      { expectedVersion: 1 },
      { expectedVersion: 1, reason: " " },
      { expectedVersion: 1, reason: "Cancel", fundXp: 0 },
    ])
      expect(taskCancelRequestSchema.safeParse(body).success).toBe(false);
  });
  it("trims create fields and strictly rejects unknown fields or blank text", () => {
    expect(taskCreateRequestSchema.parse(createBody)).toMatchObject({
      title: "Task title",
      criteria: "Acceptance criteria",
      categoryCode: "maintenance",
    });
    for (const body of [
      { ...createBody, unexpected: true },
      { ...createBody, title: "   " },
      { ...createBody, criteria: "  " },
      { ...createBody, categoryCode: " " },
    ])
      expect(taskCreateRequestSchema.safeParse(body).success).toBe(false);
  });

  it("bounds integer funds and requires valid UUIDs and UTC ISO dates", () => {
    expect(taskCreateRequestSchema.safeParse(createBody).success).toBe(true);
    for (const patch of [
      { fundXp: 2_147_483_648 },
      { fundPoints: 1.25 },
      { fundXp: -1 },
      { scopeId: "not-a-uuid" },
      { ruleSetId: "not-a-uuid" },
      { dueAt: "2026-02-30T12:00:00.000Z" },
      { dueAt: "2026-10-01T12:00:00" },
      { dueAt: "2026-10-01T12:00:00+03:00" },
    ])
      expect(
        taskCreateRequestSchema.safeParse({ ...createBody, ...patch }).success,
      ).toBe(false);
  });

  it("validates management task detail and assignment concurrency fields", () => {
    expect(managementTaskSchema.safeParse(task).success).toBe(true);
    expect(
      managementTaskSchema.parse({ ...task, title: "  Task title  " }).title,
    ).toBe("Task title");
    expect(
      managementTaskSchema.safeParse({ ...task, status: "unknown" }).success,
    ).toBe(false);
    expect(
      taskAssignRequestSchema.safeParse({
        assigneeId: ids.assignee,
        expectedVersion: 1,
      }).success,
    ).toBe(true);
    for (const body of [
      { assigneeId: ids.assignee, expectedVersion: 0 },
      { assigneeId: "bad", expectedVersion: 1 },
      { assigneeId: ids.assignee, expectedVersion: 1, taskId: ids.task },
    ])
      expect(taskAssignRequestSchema.safeParse(body).success).toBe(false);
  });

  it("defaults bounded pagination and validates UUID cursors and response shape", () => {
    expect(taskManagementListQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(taskManagementListQuerySchema.parse({ limit: "50" }).limit).toBe(50);
    for (const query of [
      { limit: 0 },
      { limit: 51 },
      { limit: "1.5" },
      { cursor: "bad" },
      { extra: true },
    ])
      expect(taskManagementListQuerySchema.safeParse(query).success).toBe(
        false,
      );
    expect(
      taskManagementListResponseSchema.safeParse({
        items: [task],
        nextCursor: ids.task,
      }).success,
    ).toBe(true);
    expect(
      taskManagementListResponseSchema.safeParse({
        items: [],
        nextCursor: "bad",
      }).success,
    ).toBe(false);
  });

  it("validates scope permissions and rule set options", () => {
    const response = {
      scopes: [
        {
          id: ids.scope,
          kind: "group",
          name: "Group",
          canCreate: true,
          canAssign: false,
          assignees: [{ id: ids.assignee, displayName: "Member" }],
        },
      ],
      ruleSets: [{ id: ids.rules, version: 1 }],
    };
    expect(
      taskManagementOptionsResponseSchema.safeParse(response).success,
    ).toBe(true);
    expect(
      taskManagementOptionsResponseSchema.safeParse({
        ...response,
        ruleSets: [{ id: ids.rules, version: 0 }],
      }).success,
    ).toBe(false);
  });
});
