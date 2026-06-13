import { cn } from '../lib/utils';

type BrandLogoProps = {
  compact?: boolean;
  className?: string;
};

export function BrandLogo({ compact = false, className }: BrandLogoProps) {
  if (compact) {
    return (
      <img
        src="/brand/eminentai-mark.svg"
        alt="EminentAi"
        className={cn('h-9 w-9 object-contain', className)}
      />
    );
  }

  return (
    <span className={cn('block h-10 w-[185px]', className)}>
      <img
        src="/brand/eminentai-wordmark-light.svg"
        alt="EminentAi"
        className="h-full w-full object-contain dark:hidden"
      />
      <img
        src="/brand/eminentai-wordmark-dark.svg"
        alt="EminentAi"
        className="hidden h-full w-full object-contain dark:block"
      />
    </span>
  );
}
