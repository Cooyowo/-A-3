/**
 * @a3/core —— 葵A葵3 规则引擎
 *
 * 纯函数、零依赖、零 IO。所有随机性由调用方注入（Rng）。
 */

export const CORE_VERSION = '0.1.0';

export * from './cards';
export * from './types';
export * from './patterns';
export * from './compare';
export * from './teams';
export * from './settle';
export * from './legality';
export * from './state';
export * from './selfplay';
