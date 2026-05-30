/**
 * Simple performance benchmark utility.
 */
export function benchmark(name: string, fn: () => void, iterations = 1000): number {
  // Warm up
  for (let i = 0; i < Math.min(10, iterations); i++) {
    fn();
  }

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    fn();
  }
  const duration = performance.now() - start;

  console.log(`Benchmark: ${name}`);
  console.log(`  Iterations: ${iterations}`);
  console.log(`  Total: ${duration.toFixed(2)}ms`);
  console.log(`  Average: ${(duration / iterations).toFixed(4)}ms`);

  return duration;
}

export function benchmarkAsync(name: string, fn: () => Promise<void>, iterations = 100): Promise<number> {
  return new Promise(async (resolve) => {
    // Warm up
    for (let i = 0; i < Math.min(3, iterations); i++) {
      await fn();
    }

    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      await fn();
    }
    const duration = performance.now() - start;

    console.log(`Benchmark: ${name}`);
    console.log(`  Iterations: ${iterations}`);
    console.log(`  Total: ${duration.toFixed(2)}ms`);
    console.log(`  Average: ${(duration / iterations).toFixed(4)}ms`);

    resolve(duration);
  });
}
