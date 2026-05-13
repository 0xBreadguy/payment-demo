export type ProtectedImageLayout = "full" | "compact";

const baseFrameClassName =
  "overflow-hidden rounded-lg border border-white/10 bg-black/30";

export function getProtectedImageFrameClassName(
  layout: ProtectedImageLayout = "full",
): string {
  if (layout === "compact") {
    return `${baseFrameClassName} w-full max-w-md`;
  }

  return `${baseFrameClassName} w-full`;
}
