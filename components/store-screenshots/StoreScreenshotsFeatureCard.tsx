import Link from "next/link";
import { SmartPhone01Icon } from "hugeicons-react";

export function StoreScreenshotsFeatureCard(): React.JSX.Element {
  return (
    <Link
      href="/store-screenshots"
      className="group mb-3 block overflow-hidden rounded-md border border-foreground/15 bg-foreground/[0.045] p-3 transition-[border-color,background-color] hover:border-foreground/25 hover:bg-foreground/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/25"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-foreground text-background shadow-sm">
          <SmartPhone01Icon size={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold text-foreground">
            App Store screenshots
          </span>
          <span className="mt-1 block whitespace-nowrap text-[9px] leading-snug text-muted-foreground">
            Ready for App Store Connect.
          </span>
        </span>
      </div>
    </Link>
  );
}
