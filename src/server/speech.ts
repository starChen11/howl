/**
 * 发言规则（服务端入口）。
 *
 * 实现在 `src/shared/speech.ts`：前端限制与后端校验必须共用同一份判据（SEC-4），
 * 而客户端不许 import 服务端代码（ARCH 的依赖方向）。
 */
export {
  SPEECH_MAX_CHARS,
  SPEECH_TIMEOUT_MS,
  charCount,
  isWithinLimit,
  normalizeInput,
  remainingSeconds,
} from '@shared/speech';
