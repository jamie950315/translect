const MAX_ASPECT_RATIO_DELTA = 0.03;

export function imageSourceUrl(imageElement) {
  const source = String(imageElement?.currentSrc || imageElement?.src || "");
  if (/^https?:\/\//i.test(source) || /^data:image\//i.test(source)) {
    return source;
  }

  return "";
}

export function canUseDirectImageSource(imageElement) {
  const source = imageSourceUrl(imageElement);
  const naturalWidth = Number(imageElement?.naturalWidth) || 0;
  const naturalHeight = Number(imageElement?.naturalHeight) || 0;
  const rect = imageElement?.getBoundingClientRect?.();
  const renderedWidth = Number(rect?.width) || 0;
  const renderedHeight = Number(rect?.height) || 0;

  if (!source || naturalWidth <= 0 || naturalHeight <= 0 || renderedWidth <= 0 || renderedHeight <= 0) {
    return false;
  }

  const naturalRatio = naturalWidth / naturalHeight;
  const renderedRatio = renderedWidth / renderedHeight;
  return Math.abs(naturalRatio - renderedRatio) / naturalRatio <= MAX_ASPECT_RATIO_DELTA;
}
