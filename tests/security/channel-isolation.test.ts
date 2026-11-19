import { describe, expect, it } from 'vitest';

import { collectTypeScriptFiles, findFilesContaining } from '../helpers/source-scan';

/**
 * RFC-011 §5 AC-9 / AC-10 / AC-14：通道与依赖方向的隔离。
 *
 * 三条都是「谁不许知道谁」：
 * - 引擎不认识通道（ARCH-1）；
 * - 客户端不认识引擎，也不持有可推进的状态机（ARCH-9）；
 * - 引擎仍只依赖 shared（AC-14）。
 */

const engineFiles = (): ReturnType<typeof collectTypeScriptFiles> =>
  collectTypeScriptFiles('src/engine');
const clientFiles = (): ReturnType<typeof collectTypeScriptFiles> =>
  collectTypeScriptFiles('src/client');

describe('AC-9 · 引擎不认识通道', () => {
  it('src/engine 里不出现 InputChannel / OutputChannel', () => {
    expect(findFilesContaining(engineFiles(), 'InputChannel')).toEqual([]);
    expect(findFilesContaining(engineFiles(), 'OutputChannel')).toEqual([]);
  });
});

describe('AC-10 · 客户端不推进状态机', () => {
  it('src/client 不 import 引擎', () => {
    expect(findFilesContaining(clientFiles(), '@engine/')).toEqual([]);
  });

  it('src/client 里不出现 reduce(', () => {
    expect(findFilesContaining(clientFiles(), 'reduce(')).toEqual([]);
  });
});

describe('AC-14 · 引擎只依赖 shared', () => {
  it('src/engine 不 import server / client 的路径', () => {
    expect(findFilesContaining(engineFiles(), '@server/')).toEqual([]);
    expect(findFilesContaining(engineFiles(), '@client/')).toEqual([]);
  });
});
