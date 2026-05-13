'use client';

import * as React from 'react';
import { TrendingDown, TrendingUp, Minus } from 'lucide-react';

import { cn } from '@/lib/utils';

type Tone = 'default' | 'primary' | 'success' | 'warning' | 'danger';
type Size = 'sm' | 'md' | 'lg';
type Trend = 'up' | 'down' | 'flat';

export type KpiCardProps = {
	label: string;
	value: string | number;
	delta?: number | string;
	trend?: Trend;
	caption?: string;
	icon?: React.ReactNode;
	tone?: Tone;
	size?: Size;
	compact?: boolean;
	className?: string;
};

const toneMap: Record<
	Tone,
	{ card: string; value: string; deltaUp: string; deltaDown: string }
> = {
	default: {
		card: 'bg-zinc-100 dark:bg-zinc-900/50 ring-1 ring-zinc-200 dark:ring-zinc-800',
		value: 'text-zinc-950 dark:text-zinc-50',
		deltaUp: 'text-emerald-600 dark:text-emerald-400',
		deltaDown: 'text-rose-600 dark:text-rose-400',
	},
	primary: {
		card: 'bg-blue-100 dark:bg-blue-900/30 ring-1 ring-blue-200 dark:ring-blue-800/60',
		value: 'text-blue-700 dark:text-blue-200',
		deltaUp: 'text-emerald-600 dark:text-emerald-400',
		deltaDown: 'text-rose-600 dark:text-rose-400',
	},
	success: {
		card: 'bg-emerald-100 dark:bg-emerald-900/30 ring-1 ring-emerald-200 dark:ring-emerald-800/60',
		value: 'text-emerald-700 dark:text-emerald-200',
		deltaUp: 'text-emerald-700 dark:text-emerald-300',
		deltaDown: 'text-rose-600 dark:text-rose-400',
	},
	warning: {
		card: 'bg-amber-100 dark:bg-amber-900/30 ring-1 ring-amber-200 dark:ring-amber-800/60',
		value: 'text-amber-700 dark:text-amber-200',
		deltaUp: 'text-emerald-600 dark:text-emerald-400',
		deltaDown: 'text-rose-600 dark:text-rose-400',
	},
	danger: {
		card: 'bg-rose-100 dark:bg-rose-900/30 ring-1 ring-rose-200 dark:ring-rose-800/60',
		value: 'text-rose-700 dark:text-rose-200',
		deltaUp: 'text-emerald-600 dark:text-emerald-400',
		deltaDown: 'text-rose-700 dark:text-rose-300',
	},
};

const sizeMap: Record<
	Size,
	{ pad: string; label: string; value: string; caption: string; icon: string }
> = {
	sm: {
		pad: 'p-3',
		label: 'text-xs',
		value: 'text-xl',
		caption: 'text-[11px]',
		icon: 'h-4 w-4',
	},
	md: {
		pad: 'p-4',
		label: 'text-sm',
		value: 'text-2xl',
		caption: 'text-xs',
		icon: 'h-5 w-5',
	},
	lg: {
		pad: 'p-6',
		label: 'text-sm',
		value: 'text-3xl',
		caption: 'text-sm',
		icon: 'h-6 w-6',
	},
};

export function KpiCard({
	label,
	value,
	delta,
	trend = 'flat',
	caption,
	icon,
	tone = 'primary',
	size = 'md',
	compact = false,
	className,
}: KpiCardProps) {
	const t = toneMap[tone];
	const s = sizeMap[size];

	const deltaValue =
		typeof delta === 'number' ? `${delta > 0 ? '+' : ''}${delta}%` : delta;

	const isUp = trend === 'up';
	const isDown = trend === 'down';
	const DeltaIcon = isUp ? TrendingUp : isDown ? TrendingDown : Minus;

	return (
		<div
			className={cn(
				'kpi-card relative overflow-hidden rounded-xl shadow-sm',
				`kpi-card--${tone}`,
				t.card,
				s.pad,
				!compact && 'min-h-[92px]',
				className,
			)}
		>
			<span className="pointer-events-none absolute -right-6 -top-6 inline-flex h-16 w-16 rounded-full bg-black/[0.04] dark:bg-white/5" />
			<span className="pointer-events-none absolute -right-2 -top-2 inline-flex h-8 w-8 rounded-full bg-black/[0.04] dark:bg-white/5" />

			<div className="flex items-start justify-between gap-3">
				<div className="space-y-1">
					<div
						className={cn(
							'kpi-card__label font-medium text-zinc-700 dark:text-zinc-300',
							s.label,
						)}
					>
						{label}
					</div>
					<div className={cn('kpi-card__value font-semibold tracking-tight', t.value, s.value)}>
						{typeof value === 'number' ? value.toLocaleString() : value}
					</div>
					{caption ? (
						<div className={cn('kpi-card__caption text-zinc-500 dark:text-zinc-400', s.caption)}>
							{caption}
						</div>
					) : null}
				</div>

				<div className="flex items-center gap-2">
					{typeof deltaValue !== 'undefined' && (
						<div
							className={cn(
								'flex items-center gap-1 text-sm font-medium',
								isUp
									? t.deltaUp
									: isDown
										? t.deltaDown
										: 'text-zinc-500 dark:text-zinc-400',
							)}
						>
							<DeltaIcon className="h-4 w-4" aria-hidden />
							{deltaValue}
						</div>
					)}
					{icon ? (
						<div
							className={cn(
								'kpi-card__icon rounded-full bg-white p-1 shadow-sm dark:bg-white/10 dark:shadow-none',
								s.icon,
							)}
						>
							{icon}
						</div>
					) : null}
				</div>
			</div>

			<div className="kpi-card__bar mt-3 h-0.5 w-16 rounded bg-current/40 opacity-60" />
		</div>
	);
}
