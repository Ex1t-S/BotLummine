import React from 'react';
import { cn } from '@/lib/utils';
import './dotted-surface.css';

type DottedSurfaceProps = Omit<React.ComponentProps<'div'>, 'ref'>;

export function DottedSurface({ className, ...props }: DottedSurfaceProps) {
	return (
		<div
			className={cn('dotted-surface', className)}
			{...props}
			aria-hidden="true"
		/>
	);
}

export default DottedSurface;
