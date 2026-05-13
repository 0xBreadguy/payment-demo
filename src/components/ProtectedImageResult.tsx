"use client";

import Image from "next/image";
import type { ProtectedImage } from "@/lib/protected-image";
import {
  getProtectedImageFrameClassName,
  type ProtectedImageLayout,
} from "@/lib/protected-image-layout";

function getProtectedImage(data: unknown): ProtectedImage | null {
  if (!data || typeof data !== "object" || !("image" in data)) {
    return null;
  }

  const image = (data as { image?: unknown }).image;
  if (!image || typeof image !== "object") return null;

  const candidate = image as Partial<ProtectedImage>;
  if (
    typeof candidate.src !== "string" ||
    typeof candidate.alt !== "string" ||
    candidate.width !== 512 ||
    candidate.height !== 512
  ) {
    return null;
  }

  return {
    alt: candidate.alt,
    height: candidate.height,
    src: candidate.src,
    width: candidate.width,
  };
}

export function ProtectedImageResult({
  data,
  layout = "full",
}: {
  data: unknown;
  layout?: ProtectedImageLayout;
}) {
  const image = getProtectedImage(data);
  if (!image) return null;

  return (
    <div className={getProtectedImageFrameClassName(layout)}>
      <Image
        alt={image.alt}
        className="aspect-square w-full object-cover"
        height={image.height}
        src={image.src}
        width={image.width}
      />
    </div>
  );
}
