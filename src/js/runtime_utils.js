'use strict';

// Shared runtime scheduling.
var openHydrationConcurrency = 8;

function getOpenHydrationConcurrency() {
  return openHydrationConcurrency;
}

async function mapWithConcurrency(items, limit, worker) {
  let next = 0;
  const workerCount = Math.min(Math.max(1, Number(limit) || 1), items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (next < items.length) {
      const index = next++;
      await worker(items[index], index);
    }
  }));
}
