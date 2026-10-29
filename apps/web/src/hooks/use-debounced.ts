import { useState, useEffect } from 'react';
export function useDebounced<T>(value: T, delay = 250) {
  const [state, setState] = useState(value);
  useEffect(() => {
    const timeout = setTimeout(() => setState(value), delay);
    return () => clearTimeout(timeout);
  }, [value, delay]);
  return state;
}
