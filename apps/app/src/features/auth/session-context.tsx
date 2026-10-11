"use client";

import { createContext, useContext } from "react";
import type { Permission } from "./permission-labels";

export const SessionContext = createContext<{
  csrfToken: string;
  user: { id: string; displayName: string };
  /** `null` — список не удалось загрузить; пустой массив — полномочий нет. */
  permissions: Permission[] | null;
  canReview?: boolean;
  canReadAudit?: boolean;
  canManageRules?: boolean;
  canInspectCatalog?: boolean;
  canReadNotificationStatus?: boolean;
  canDecideRewards?: boolean;
  canFulfillRewards?: boolean;
  canCorrectLedger?: boolean;
  accessScopes?: { id: string; name: string }[];
  canManageTasks?: boolean;
  canSetTasks?: boolean;
  historyScopeIds?: string[];
  reportDirty(dirty: boolean): void;
  confirmLeave(): boolean;
  loseAccess(status: number): void;
} | null>(null);

export function useAuthorizedSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error("Authorized session is required");
  return session;
}
