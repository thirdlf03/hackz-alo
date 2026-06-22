export function bindApiMethods<T extends object>(
  target: object,
  source: T,
  keys: readonly (keyof T)[]
) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'function') {
      Object.assign(target, {
        [key]: (value as (...args: never[]) => unknown).bind(source),
      });
    }
  }
}
