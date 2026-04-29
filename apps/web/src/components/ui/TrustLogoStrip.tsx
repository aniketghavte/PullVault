import { cn } from '@/lib/cn';

const defaultLogos = ['Pokemon TCG', 'TCGPlayer', 'CardMarket', 'Collectify', 'MarketPulse'];

export function TrustLogoStrip({
  logos = defaultLogos,
  className,
  ariaLabel = 'Trust logos',
}: {
  logos?: string[];
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div className={cn('w-full overflow-hidden', className)} aria-label={ariaLabel}>
      <div className="mx-auto max-w-7xl px-4">
        <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-4 py-8">
          {logos.map((l) => (
            <div key={l} className="text-micro font-semibold text-nearBlack/70">
              {l}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

