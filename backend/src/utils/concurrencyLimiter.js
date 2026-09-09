export function createConcurrencyLimiter(maxConcurrency) {
  const limit = Math.max(1, Math.floor(Number(maxConcurrency) || 1));
  const queue = [];
  let activeCount = 0;

  const schedule = () => {
    while (activeCount < limit && queue.length > 0) {
      const { task, resolve, reject } = queue.shift();
      activeCount += 1;

      Promise.resolve()
        .then(task)
        .then(resolve, reject)
        .finally(() => {
          activeCount -= 1;
          schedule();
        });
    }
  };

  return function runWithConcurrencyLimit(task) {
    if (typeof task !== "function") {
      return Promise.reject(new TypeError("Concurrency-limited task must be a function"));
    }

    return new Promise((resolve, reject) => {
      queue.push({ task, resolve, reject });
      schedule();
    });
  };
}

