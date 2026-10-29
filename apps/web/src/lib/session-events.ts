// Notify other tabs without storing identity, tokens or personal data.
export function broadcastSessionChange() {
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel('bnature-session');
  channel.postMessage('changed');
  channel.close();
}
