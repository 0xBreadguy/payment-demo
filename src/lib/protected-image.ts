export const PROTECTED_IMAGE_COUNT = 100;
export const PROTECTED_IMAGE_SIZE = 512;

export type ProtectedImage = {
  alt: string;
  height: typeof PROTECTED_IMAGE_SIZE;
  src: string;
  width: typeof PROTECTED_IMAGE_SIZE;
};

function imageName(index: number): string {
  return `fluffle-${String(index).padStart(2, "0")}`;
}

export const PROTECTED_IMAGES: ProtectedImage[] = Array.from(
  { length: PROTECTED_IMAGE_COUNT },
  (_, index) => {
    const name = imageName(index + 1);
    return {
      alt: `Protected image ${name}`,
      height: PROTECTED_IMAGE_SIZE,
      src: `/512x512/${name}.png`,
      width: PROTECTED_IMAGE_SIZE,
    };
  },
);

export function getRandomProtectedImage(
  random: () => number = Math.random,
): ProtectedImage {
  const index = Math.min(
    PROTECTED_IMAGES.length - 1,
    Math.max(0, Math.floor(random() * PROTECTED_IMAGES.length)),
  );
  return PROTECTED_IMAGES[index];
}
