import { h } from '../lib/ui.ts';

/** The Nestly mark: a smiling house. */
export function LogoGlyph(props: { size?: number; color?: string }) {
  const s = props.size ?? 40;
  const c = props.color ?? '#8a55f2';
  return (
    <svg width={s} height={s} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path d="M24 7.5 8.5 19.2c-.95.72-1.5 1.84-1.5 3.03V37a4 4 0 0 0 4 4h26a4 4 0 0 0 4-4V22.23c0-1.19-.55-2.31-1.5-3.03L24 7.5Z" fill="#fff" />
      <path d="M15.5 30.5c2.2 3.2 5.2 4.8 8.5 4.8s6.3-1.6 8.5-4.8" stroke={c} stroke-width="3.6" stroke-linecap="round" />
      <circle cx="18" cy="24.5" r="2.4" fill={c} />
      <circle cx="30" cy="24.5" r="2.4" fill={c} />
    </svg>
  );
}
