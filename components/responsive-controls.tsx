"use client";
import * as React from "react";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useMobile } from "@/hooks/use-mobile";

/** One set of controls: inline on desktop, accessible modal sheet on phones. */
export function ResponsiveControls({
  children,
  title = "Filters",
  count = 0,
}: {
  children: React.ReactNode;
  title?: string;
  count?: number;
}) {
  const mobile = useMobile();
  const [open, setOpen] = React.useState(false);
  if (!mobile) return <div className="flex flex-wrap items-center gap-2">{children}</div>;
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger className="control-button" aria-label={title}>
        {title}
        {count > 0 && (
          <span className="rounded-full bg-[var(--brand-weak)] px-2 text-[var(--brand)]">
            {count}
          </span>
        )}
      </SheetTrigger>
      <SheetContent
        side="bottom"
        className="mobile-controls max-h-[85dvh] overflow-y-auto rounded-t-2xl p-5 pb-[max(20px,env(safe-area-inset-bottom))]"
      >
        <SheetTitle>{title}</SheetTitle>
        <SheetDescription>Changes apply immediately to this view.</SheetDescription>
        <div className="flex flex-wrap items-center gap-3">{children}</div>
        <SheetClose className="control-button mt-2 w-full justify-center">Done</SheetClose>
      </SheetContent>
    </Sheet>
  );
}
