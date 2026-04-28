/// <reference types="vite/client" />

declare module "lucide-react" {
  import type { ComponentType, SVGProps } from "react";

  export type LucideIcon = ComponentType<
    SVGProps<SVGSVGElement> & {
      absoluteStrokeWidth?: boolean;
      color?: string;
      size?: number | string;
      strokeWidth?: number | string;
    }
  >;

  export const Bot: LucideIcon;
  export const CircleStop: LucideIcon;
  export const Github: LucideIcon;
  export const PlayCircle: LucideIcon;
  export const RefreshCw: LucideIcon;
  export const ShieldCheck: LucideIcon;
}
