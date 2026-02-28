export function createConcurrencyLimiter(maxConcurrent: number) {
  let activeCount = 0;
  const queue: Array<() => void> = [];

  const next = (): void => {
    if (activeCount >= maxConcurrent) {
      return;
    }
    const job = queue.shift();
    if (!job) {
      return;
    }
    activeCount += 1;
    job();
  };

  return async function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn()
          .then(resolve)
          .catch(reject)
          .finally(() => {
            activeCount -= 1;
            next();
          });
      });
      next();
    });
  };
}
