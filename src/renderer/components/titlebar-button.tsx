import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface TitlebarButtonProps extends React.ComponentProps<typeof Button> {
  /** the accessible name, and the tooltip text unless tooltip={false} */
  label: string;
  tooltip?: boolean;
}

/** A titlebar control: ghost button, opted out of the drag region.
 * The whole header drags the window, so every interactive child inside it has
 * to carve itself out with -webkit-app-region: no-drag or the click never
 * reaches it. */
export function TitlebarButton({
  label,
  tooltip = true,
  className,
  children,
  ...props
}: TitlebarButtonProps) {
  const button = (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      className={cn('size-6 rounded-md [-webkit-app-region:no-drag]', className)}
      {...props}
    >
      {children}
    </Button>
  );

  if (!tooltip) return button;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
