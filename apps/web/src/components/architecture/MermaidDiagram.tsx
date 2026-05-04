'use client';

import mermaid from 'mermaid';
import { useEffect, useId, useRef, useState } from 'react';

type MermaidDiagramProps = {
  chart: string;
};

let isMermaidInitialized = false;

function ensureMermaidInitialized() {
  if (isMermaidInitialized) return;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'neutral',
  });
  isMermaidInitialized = true;
}

export function MermaidDiagram({ chart }: MermaidDiagramProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const diagramId = useId().replace(/[:]/g, '');

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        ensureMermaidInitialized();
        const uniqueId = `diagram-${diagramId}-${Math.random().toString(36).slice(2)}`;
        const { svg } = await mermaid.render(uniqueId, chart);
        if (cancelled || !hostRef.current) return;
        hostRef.current.innerHTML = svg;
        setRenderError(null);
      } catch (error) {
        if (cancelled) return;
        setRenderError(error instanceof Error ? error.message : 'Failed to render diagram');
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [chart, diagramId]);

  if (renderError) {
    return (
      <div className="rounded-lg border border-coral/40 bg-coral/10 p-4">
        <p className="text-caption font-semibold text-coral">Diagram render failed</p>
        <p className="mt-2 text-micro text-coral/90">{renderError}</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-borderLight bg-canvas p-4">
      <div ref={hostRef} className="[&_svg]:h-auto [&_svg]:max-w-none [&_svg]:min-w-full" />
    </div>
  );
}
