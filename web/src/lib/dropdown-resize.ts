// Drag the bottom-right corner of any dropdown list (Mantine's combobox dropdown) to make it taller.
// One listener for the whole app, so every Select, Autocomplete and GroupedSelect gets it.

const DROPDOWN = '.m_88b62a41';
const CORNER = 16;

function cornerOf(e: MouseEvent): HTMLElement | null {
  const d = (e.target as HTMLElement | null)?.closest?.<HTMLElement>(DROPDOWN);
  if (!d) return null;
  const r = d.getBoundingClientRect();
  return e.clientX > r.right - CORNER && e.clientY > r.bottom - CORNER ? d : null;
}

export function installDropdownResize() {
  document.addEventListener(
    'mousedown',
    (e) => {
      const d = cornerOf(e);
      if (!d) return;
      // Keep the focus (and the dropdown open) on the field.
      e.preventDefault();
      e.stopPropagation();
      const startY = e.clientY;
      const startH = d.getBoundingClientRect().height;
      const top = d.getBoundingClientRect().top;
      const move = (ev: MouseEvent) => {
        const h = Math.max(60, Math.min(window.innerHeight - top - 8, startH + ev.clientY - startY));
        d.style.height = `${h}px`;
        d.setAttribute('data-resized', '');
      };
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up, true);
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up, true);
    },
    true,
  );
  // The click that ends the drag must not pick the option under the corner.
  document.addEventListener(
    'click',
    (e) => {
      if (cornerOf(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true,
  );
}
