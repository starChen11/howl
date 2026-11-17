// noImplicitOverride：开启时覆写基类方法必须写 override 关键字。
class Base {
  greet(): string {
    return 'base';
  }
}

export class Derived extends Base {
  greet(): string {
    return 'derived';
  }
}
