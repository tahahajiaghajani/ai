// The full-width Gantt of a project (route projects/:id/gantt), loaded with its page.
import { useParams } from "react-router";
import { PageHeader } from "../../components/layout";
import { GanttChart } from "./Gantt";

export default function GanttPage() {
  const { id = "" } = useParams();
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="برنامهٔ زمانی پروژه" />
      <GanttChart projectId={id} />
    </div>
  );
}
