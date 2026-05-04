import { ArchitectureOverviewContent } from '@/components/architecture/ArchitectureOverviewContent';
import { DocArticle } from '@/components/architecture/DocArticle';

export default function ArchitecturePage() {
  return (
    <DocArticle
      title="Platform architecture"
      subtitle="End-to-end view of PullVault: how the web app, realtime server, Postgres, and Redis work together, plus links to deep dives for Part B (B1–B5)."
    >
      <ArchitectureOverviewContent />
    </DocArticle>
  );
}
