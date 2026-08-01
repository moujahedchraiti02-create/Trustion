import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface HashDisplayProps {
  hash: string;
  maxLength?: number;
  className?: string;
}

export function HashDisplay({ hash, maxLength = 12, className }: HashDisplayProps) {
  if (!hash) return <span className="text-muted-foreground">-</span>;
  
  const truncated = hash.length > maxLength 
    ? `${hash.slice(0, maxLength / 2)}...${hash.slice(-maxLength / 2)}`
    : hash;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn("font-mono text-xs cursor-help border-b border-dashed border-muted-foreground/50", className)}>
            {truncated}
          </span>
        </TooltipTrigger>
        <TooltipContent className="bg-card border-border font-mono text-xs text-foreground p-2 rounded-sm max-w-sm break-all">
          {hash}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
