import { useEffect, useState } from 'react';

/**
 * 回合倒计时（视觉用）。
 *
 * 说明：M2 是本地热座、引擎不带时钟（Q-033 在 v1 不做托管），所以倒计时**只是显示**：
 * 到 0 之后停在 0，不会自动代打。M3 联机时由服务端计时并广播，这里换成服务端时间即可。
 *
 * @param turnKey 一旦变化就重新计时（用「局号 + 墩号 + 座位 + 日志长度」拼）
 * @param seconds 总时长
 */
export function useCountdown(turnKey: string, seconds: number): number {
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    setRemaining(seconds);
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const left = Math.max(0, seconds - Math.floor((Date.now() - startedAt) / 1000));
      setRemaining(left);
      if (left <= 0) clearInterval(timer);
    }, 250);
    return () => clearInterval(timer);
  }, [turnKey, seconds]);

  return remaining;
}
