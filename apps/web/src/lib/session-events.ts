// Notify other tabs without storing identity, tokens or personal data.
export function broadcastSessionChange(reason: 'changed' | 'logout' = 'changed') {
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel('bnature-session');
  channel.postMessage(reason);
  channel.close();
}
