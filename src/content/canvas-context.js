export function getCanvasContext2d(canvas, options) {
  const context = canvas.getContext("2d", options);
  if (!context) {
    throw new Error("Could not acquire a 2d canvas context.");
  }
  return context;
}

export function getReadableCanvasContext2d(canvas) {
  return getCanvasContext2d(canvas, { willReadFrequently: true });
}
