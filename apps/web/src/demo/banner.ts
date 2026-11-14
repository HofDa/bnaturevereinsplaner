import { currentRole, resetDemo, setRole, type DemoRole } from './mock';

// Small fixed badge outside React: makes clear that nothing is real and lets testers switch role.
export function mountDemoBanner() {
  const box = document.createElement('aside');
  box.className = 'demo-badge';
  box.setAttribute('aria-label', 'Demo-Hinweis');
  const label = document.createElement('span');
  label.innerHTML =
    '<strong>Demo</strong><span class="demo-badge-note"> · erfundene Daten · Änderungen bleiben nur in diesem Tab</span>';
  box.append(label);
  const switcher = document.createElement('span');
  switcher.className = 'demo-badge-roles';
  const roleButtons: [DemoRole, HTMLButtonElement][] = [];
  for (const [value, text] of [
    ['admin', 'Admin'],
    ['member', 'Mitglied'],
  ] as [DemoRole, string][]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    roleButtons.push([value, button]);
    button.addEventListener('click', () => {
      setRole(value);
      window.location.assign(import.meta.env.BASE_URL);
    });
    switcher.append(button);
  }
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.textContent = 'Zurücksetzen';
  reset.title = 'Alle Änderungen verwerfen und die Beispieldaten neu laden';
  reset.addEventListener('click', () => {
    resetDemo();
    window.location.assign(import.meta.env.BASE_URL);
  });
  switcher.append(reset);
  box.append(switcher);
  const sync = () => {
    const role = currentRole();
    for (const [value, button] of roleButtons)
      button.setAttribute('aria-pressed', String(role === value));
  };
  sync();
  window.addEventListener('bnature-demo-role', sync);
  document.body.append(box);
}
