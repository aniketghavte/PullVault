interface MetricCardProps {
  label: string;
  value: string | number;
  note?: string;
  alert?: boolean;
}

export function MetricCard({ label, value, note, alert }: MetricCardProps) {
  return (
    <article
      className={[
        'rounded-lg border p-4 space-y-1',
        alert ? 'border-coral/60 bg-coral/10' : 'border-cardBorder bg-canvas/60',
      ].join(' ')}
    >
      <div className="font-display text-sectionHeading font-semibold text-ink tabular-nums leading-tight">
        {value}
      </div>
      <div className="text-micro font-semibold text-mutedSlate">{label}</div>
      {note ? <div className="text-micro text-ink/70">{note}</div> : null}
    </article>
  );
}
