import { h, useMemo } from '../lib/ui.ts';
import type { Child } from '../lib/ui.ts';
import { qrMatrix, qrSvgPath } from '../lib/qr.ts';

export interface Slice {
  key: string;
  value: number;
  color: string;
}

/** Donut chart drawn with stroke-dasharray segments. */
export function Donut(props: { slices: Slice[]; size?: number; thickness?: number; center?: Child }) {
  const size = props.size ?? 132;
  const th = props.thickness ?? 18;
  const r = (size - th) / 2;
  const c = 2 * Math.PI * r;
  const total = props.slices.reduce((a, s) => a + s.value, 0) || 1;
  const gap = props.slices.length > 1 ? 3 : 0;
  let offset = 0;
  return (
    <div style={{ position: 'relative', width: size + 'px', height: size + 'px', flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--fill)" stroke-width={th} />
        {props.slices.map((s) => {
          const len = (s.value / total) * c;
          const seg = (
            <circle
              key={s.key}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={s.color}
              stroke-width={th}
              stroke-linecap="round"
              stroke-dasharray={`${Math.max(0, len - gap)} ${c}`}
              stroke-dashoffset={-offset}
            />
          );
          offset += len;
          return seg;
        })}
      </svg>
      {props.center ? (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
          {props.center}
        </div>
      ) : null}
    </div>
  );
}

export function BarChart(props: { bars: { key: string; label: string; value: number; current?: boolean; display?: string }[] }) {
  const max = Math.max(1, ...props.bars.map((b) => b.value));
  return (
    <div class="bars">
      {props.bars.map((b) => (
        <div key={b.key} class={b.current ? 'col cur' : 'col'}>
          <span class="val">{b.display ?? ''}</span>
          <div class="b" style={{ height: `${Math.max(4, (b.value / max) * 100)}%` }} />
          <span class="l">{b.label}</span>
        </div>
      ))}
    </div>
  );
}

export function QrCode(props: { text: string; size?: number; color?: string }) {
  const { path, size } = useMemo(() => qrSvgPath(qrMatrix(props.text, 'M'), 2), [props.text]);
  const px = props.size ?? 200;
  return (
    <svg width={px} height={px} viewBox={`0 0 ${size} ${size}`} shape-rendering="crispEdges" role="img" aria-label="QR code">
      <path d={path} fill={props.color ?? '#15131f'} />
    </svg>
  );
}
