// noUncheckedIndexedAccess：开启时 first 的返回类型含 undefined，赋值给 number 报错。
export function first(values: readonly number[]): number {
  return values[0];
}
