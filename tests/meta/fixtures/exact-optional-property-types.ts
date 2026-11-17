// exactOptionalPropertyTypes：开启时显式写入 undefined 不被允许。
interface Options {
  readonly label?: string;
}

export const options: Options = { label: undefined };
