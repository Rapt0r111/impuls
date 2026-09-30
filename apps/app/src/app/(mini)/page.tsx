import { AccessScreen } from "@/features/auth/access-screen";
import { TaskList } from "@/features/tasks/task-list";

export default function EntryPage() {
  return (
    <AccessScreen>
      <TaskList />
    </AccessScreen>
  );
}
