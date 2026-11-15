"use client";
import { useState } from "react";

/** Lightweight SVG charts — no chart library, themed with CSS variables. */
export function Sparkline({ series, labels, height = 200 }: { series: { name: string; color: string; values: number[] }[]; labels: string[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const w = 720;
  const padL = 36, padR = 12, padT = 12, padB = 28;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const n = Math.max(1, labels.length - 1);
  const x = (i: number) => padL + (i / n) * (w - padL - padR);
  const y = (v: number) => padT + (1 - v / max) * (height - padT - padB);
  const ticks = [0, 0.5, 1].map((t) => Math.round(max * t));
  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${w} ${height}`} className="h-auto w-full" onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeDasharray="3 4" />
            <text x={padL - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--text-3)">{t}</text>
          </g>
        ))}
        {series.map((s) => {
          const d = s.values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(v)}`).join(" ");
          const area = `${d} L${x(s.values.length - 1)},${y(0)} L${x(0)},${y(0)} Z`;
          return (
            <g key={s.name}>
              <path d={area} fill={s.color} opacity="0.06" />
              <path d={d} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            </g>
          );
        })}
        {labels.map((l, i) => (i % Math.ceil(labels.length / 8) === 0 ? <text key={l + i} x={x(i)} y={height - 8} textAnchor="middle" fontSize="11" fill="var(--text-3)">{l}</text> : null))}
        {labels.map((_, i) => <rect key={i} x={x(i) - (w - padL - padR) / n / 2} y={padT} width={(w - padL - padR) / n} height={height - padT - padB} fill="transparent" onMouseEnter={() => setHover(i)} />)}
        {hover !== null ? (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={padT} y2={height - padB} stroke="var(--border-strong)" />
            {series.map((s) => <circle key={s.name} cx={x(hover)} cy={y(s.values[hover] ?? 0)} r="4" fill={s.color} stroke="var(--surface)" strokeWidth="2" />)}
          </g>
        ) : null}
      </svg>
      <div className="mt-2 flex flex-wrap items-center gap-4 text-[12px] text-text-2">
        {series.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: s.color }} />{s.name}{hover !== null ? <strong className="text-text">{s.values[hover]}</strong> : null}</span>
        ))}
        {hover !== null ? <span className="ml-auto text-text-3">{labels[hover]}</span> : null}
      </div>
    </div>
  );
}

export function Bars({ data, color = "var(--primary)", height = 160, format }: { data: { label: string; value: number }[]; color?: string; height?: number; format?: (v: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="space-y-2" style={{ minHeight: height }}>
      {data.map((d) => (
        <div key={d.label} className="flex items-center gap-3 text-[13px]">
          <span className="w-32 truncate text-text-2" title={d.label}>{d.label}</span>
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full transition-all" style={{ width: `${(d.value / max) * 100}%`, background: color }} /></div>
          <span className="w-16 text-right font-medium text-text">{format ? format(d.value) : d.value}</span>
        </div>
      ))}
      {!data.length ? <div className="text-[13px] text-text-3">No data</div> : null}
    </div>
  );
}

export function Donut({ parts, size = 140 }: { parts: { label: string; value: number; color: string }[]; size?: number }) {
  const total = parts.reduce((a, b) => a + b.value, 0) || 1;
  let acc = 0;
  const r = 44, c = 2 * Math.PI * r;
  return (
    <div className="flex items-center gap-5">
      <svg width={size} height={size} viewBox="0 0 110 110">
        <circle cx="55" cy="55" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="14" />
        {parts.map((p) => {
          const len = (p.value / total) * c;
          const el = <circle key={p.label} cx="55" cy="55" r={r} fill="none" stroke={p.color} strokeWidth="14" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-acc} transform="rotate(-90 55 55)" />;
          acc += len;
          return el;
        })}
        <text x="55" y="59" textAnchor="middle" fontSize="16" fontWeight="600" fill="var(--text)">{total === 1 && !parts.some((p) => p.value) ? 0 : total}</text>
      </svg>
      <ul className="space-y-1.5 text-[13px]">
        {parts.map((p) => <li key={p.label} className="flex items-center gap-2 text-text-2"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: p.color }} />{p.label}<span className="ml-auto pl-3 font-medium text-text">{p.value}</span></li>)}
      </ul>
    </div>
  );
}
