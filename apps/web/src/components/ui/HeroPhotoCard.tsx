import type { ReactNode } from 'react';
import Image from 'next/image';

import { cn } from '@/lib/cn';

export function HeroPhotoCard({
  className,
  imageSrc,
  imageAlt,
  overlay,
  children,
}: {
  className?: string;
  imageSrc?: string;
  imageAlt?: string;
  overlay?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-lg border border-cardBorder bg-stone',
        className,
      )}
    >
      {imageSrc ? (
        <Image src={imageSrc} alt={imageAlt ?? 'Hero image'} fill className="object-cover" />
      ) : null}

      <div className="relative z-10">{children}</div>

      {overlay ? <div className="absolute inset-0">{overlay}</div> : null}
    </div>
  );
}

