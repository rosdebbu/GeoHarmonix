import type { ReactNode } from 'react';

/** The title block of a major workbench section: an icon tile, a large title, a readable subtitle. */
export function SectionHeading({
  id,
  icon,
  title,
  subtitle,
  actions,
}: {
  id: string;
  icon: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="flex min-w-0 items-start gap-3">
        <span aria-hidden="true" className="border-line-strong bg-chip text-fire text-title grid size-9 shrink-0 place-items-center rounded-md border">
          {icon}
        </span>
        <div className="min-w-0">
          <h2 id={id} className="text-display font-semibold">
            {title}
          </h2>
          {subtitle && <p className="text-body text-ink-muted mt-0.5 max-w-3xl">{subtitle}</p>}
        </div>
      </div>
      {actions}
    </div>
  );
}
