import { useRef } from 'react';
import { api } from '../../lib/api';
// Keeps the same operation key after network failure; edited payloads receive a new key.
export function useFinancialWrite() {
  const attempt = useRef<{ signature: string; key: string } | null>(null);
  return async <T>(path: string, body: unknown, method = 'POST'): Promise<T> => {
    const encoded = JSON.stringify(body),
      signature = `${method}:${path}:${encoded}`;
    if (attempt.current?.signature !== signature)
      attempt.current = { signature, key: crypto.randomUUID() };
    const current = attempt.current;
    const result = await api<T>(path, {
      method,
      body: encoded,
      headers: { 'Idempotency-Key': current.key },
    });
    if (attempt.current === current) attempt.current = null;
    return result;
  };
}
