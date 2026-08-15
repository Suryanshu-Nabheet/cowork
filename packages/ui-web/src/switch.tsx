import * as SwitchPrimitive from "@radix-ui/react-switch";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "./lib/utils.js";

export function Switch({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root className={cn("rk-switch", className)} {...props}>
      <SwitchPrimitive.Thumb className="rk-switch-thumb" />
    </SwitchPrimitive.Root>
  );
}
