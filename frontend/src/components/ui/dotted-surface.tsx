import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { cn } from '@/lib/utils';
import './dotted-surface.css';

type DottedSurfaceProps = Omit<React.ComponentProps<'div'>, 'ref'>;

const MAX_PIXEL_RATIO = 1.5;
const SEPARATION = 125;

export function DottedSurface({ className, ...props }: DottedSurfaceProps) {
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const container = containerRef.current;
		if (!container || typeof window === 'undefined') return undefined;

		const isSmallViewport = window.matchMedia('(max-width: 768px)').matches;
		const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		const amountX = isSmallViewport ? 34 : 54;
		const amountY = isSmallViewport ? 28 : 42;
		const scene = new THREE.Scene();
		const camera = new THREE.PerspectiveCamera(58, 1, 1, 12000);
		camera.position.set(0, 430, 1760);
		camera.rotation.x = -0.18;

		let renderer: THREE.WebGLRenderer;
		try {
			renderer = new THREE.WebGLRenderer({
				alpha: true,
				antialias: true,
				powerPreference: 'high-performance',
			});
		} catch (error) {
			// Keep the CSS background visible when WebGL is unavailable.
			console.warn('[DottedSurface] WebGL no disponible', error);
			return undefined;
		}

		renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
		renderer.setClearColor(0x000000, 0);
		container.appendChild(renderer.domElement);

		const positions: number[] = [];
		const colors: number[] = [];
		const isDark = true;

		for (let ix = 0; ix < amountX; ix += 1) {
			for (let iy = 0; iy < amountY; iy += 1) {
				const x = ix * SEPARATION - (amountX * SEPARATION) / 2;
				const z = iy * SEPARATION - (amountY * SEPARATION) / 2;
				const softVariance = Math.sin(ix * 0.8) * 0.035;

				positions.push(x, -140, z);
				colors.push(
					isDark ? 1 + softVariance : 0.28,
					isDark ? 1 + softVariance : 0.28,
					isDark ? 1.04 + softVariance : 0.3,
				);
			}
		}

		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
		geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

		const material = new THREE.PointsMaterial({
			size: 5.7,
			vertexColors: true,
			transparent: true,
			opacity: 0.9,
			sizeAttenuation: true,
			depthWrite: false,
		});
		const points = new THREE.Points(geometry, material);
		scene.add(points);

		let animationId = 0;
		let count = 0;
		let disposed = false;

		const resize = () => {
			if (disposed) return;
			const width = container.clientWidth || window.innerWidth;
			const height = container.clientHeight || window.innerHeight;
			camera.aspect = width / Math.max(height, 1);
			camera.updateProjectionMatrix();
			renderer.setSize(width, height, false);
		};

		const renderFrame = () => {
			if (disposed) return;
			animationId = window.requestAnimationFrame(renderFrame);

			if (document.hidden) return;

			const positionArray = geometry.attributes.position.array as Float32Array;
			let pointIndex = 0;
			for (let ix = 0; ix < amountX; ix += 1) {
				for (let iy = 0; iy < amountY; iy += 1) {
					const index = pointIndex * 3;
					positionArray[index + 1] =
						Math.sin((ix + count) * 0.28) * 34 +
						Math.sin((iy + count) * 0.42) * 24 -
						140;
					pointIndex += 1;
				}
			}

			geometry.attributes.position.needsUpdate = true;
			points.rotation.y = Math.sin(count * 0.018) * 0.035;
			points.rotation.x = -0.02 + Math.sin(count * 0.012) * 0.015;
			renderer.render(scene, camera);
			count += 0.028;
		};

		const resizeObserver = new ResizeObserver(resize);
		resizeObserver.observe(container);
		resize();
		if (prefersReducedMotion) {
			renderer.render(scene, camera);
		} else {
			renderFrame();
		}

		return () => {
			disposed = true;
			resizeObserver.disconnect();
			window.cancelAnimationFrame(animationId);
			geometry.dispose();
			material.dispose();
			renderer.dispose();
			if (renderer.domElement.parentNode === container) {
				container.removeChild(renderer.domElement);
			}
		};
	}, []);

	return <div ref={containerRef} className={cn('dotted-surface', className)} {...props} />;
}

export default DottedSurface;
