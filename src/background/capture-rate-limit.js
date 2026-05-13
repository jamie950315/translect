function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createCaptureVisibleTabLimiter({
  minIntervalMs = 1_100,
  now = () => Date.now(),
  sleep = defaultSleep
} = {}) {
  let lastCaptureAt = -Infinity;
  let queue = Promise.resolve();

  return function scheduleCapture(task) {
    const run = async () => {
      const waitMs = Math.max(0, minIntervalMs - (now() - lastCaptureAt));
      if (waitMs > 0) {
        await sleep(waitMs);
      }

      lastCaptureAt = now();
      return task();
    };

    const result = queue.then(run, run);
    queue = result.catch(() => {});
    return result;
  };
}
