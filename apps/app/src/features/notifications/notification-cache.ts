import type { QueryClient, QueryKey } from "@tanstack/react-query";

const prefixes = new Set([
  "notification-status",
  "notification-events",
  "notification-attempts",
]);
// Avoid cancelling the rejecting query itself; cancellation suppresses its denial.
export async function clearNotificationCaches(
  client: QueryClient,
  current: QueryKey,
) {
  await client.cancelQueries({
    predicate: (query) =>
      prefixes.has(String(query.queryKey[0])) &&
      !(
        query.queryKey.length === current.length &&
        query.queryKey.every((part, index) => part === current[index])
      ),
  });
  for (const prefix of prefixes)
    client.setQueriesData({ queryKey: [prefix] }, () => null);
}
