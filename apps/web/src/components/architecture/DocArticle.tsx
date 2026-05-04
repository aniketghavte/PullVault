import type { ReactNode } from 'react';

type Props = {
  title: string;
  subtitle?: string;
  children: ReactNode;
};

export function DocArticle({ title, subtitle, children }: Props) {
  return (
    <article className="min-w-0">
      <header className="border-b border-borderLight pb-8">
        <h1 className="font-display text-sectionHeading text-ink">{title}</h1>
        {subtitle ? <p className="mt-4 max-w-3xl text-body text-slate">{subtitle}</p> : null}
      </header>
      <div className="doc-prose mt-10 space-y-10 text-body text-ink [&_h2]:mt-12 [&_h2]:scroll-mt-24 [&_h2]:border-t [&_h2]:border-borderLight [&_h2]:pt-10 [&_h2]:font-display [&_h2]:text-featureHeading [&_h2]:text-ink [&_h3]:mt-8 [&_h3]:font-semibold [&_h3]:text-bodyLarge [&_h4]:mt-6 [&_h4]:font-semibold [&_h4]:text-caption [&_li]:text-slate [&_ol_ul]:mt-2 [&_p]:leading-relaxed [&_p]:text-slate [&_strong]:text-ink [&_table]:mt-4 [&_table]:w-full [&_table]:border-collapse [&_table]:overflow-hidden [&_table]:rounded-md [&_table]:border [&_table]:border-borderLight [&_th]:bg-stone/60 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-micro [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wide [&_td]:border-t [&_td]:border-borderLight [&_td]:px-3 [&_td]:py-2 [&_td]:text-caption [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-5 [&_code]:rounded [&_code]:bg-stone [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-caption [&_pre]:mt-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-borderLight [&_pre]:bg-nearBlack [&_pre]:p-4 [&_pre]:font-mono [&_pre]:text-micro [&_pre]:leading-relaxed [&_pre]:text-canvas/90">
        {children}
      </div>
    </article>
  );
}

export function DocCallout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <aside className="rounded-lg border border-coral/25 bg-paleBlueWash/80 p-5">
      <div className="font-semibold text-caption text-ink">{title}</div>
      <div className="mt-2 text-caption leading-relaxed text-slate">{children}</div>
    </aside>
  );
}
