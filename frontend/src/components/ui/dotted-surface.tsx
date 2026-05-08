import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useTheme } from 'next-themes';
import { cn } from '@/lib/utils';
import './dotted-surface.css';

type DottedSurfaceProps = Omit<React.ComponentProps<'div'>, 'ref'>;

export function DottedSurface({ className, ...props }: DottedSurfaceProps) {
	const { resolvedTheme, theme } = useTheme();
	const containerRef = useRef<HTMLDivElement>(null);
	const sceneRef = useRef<{
		scene: THREE.Scene;
		renderer: THREE.WebGLRenderer;
		geometry: THREE.BufferGeometry;
		material: THREE.PointsMaterial;
		resizeObserver: ResizeObserver;
		animationId: number;
	} | null>(null);
	const activeTheme = resolvedTheme || theme || 'dark';

	useEffect(() => {
		const container = containerRef.current;
		if (!container) {
			return undefined;
		}

		const SEPARATION = 125;
		const AMOUNTX = 54;
		const AMOUNTY = 42;

		const scene = new THREE.Scene();
		scene.fog = new THREE.FogExp2(0x000000, 0.00015);

		const camera = new THREE.PerspectiveCamera(58, 1, 1, 12000);
		camera.position.set(0, 430, 1760);
		camera.rotation.x = -0.18;

		const renderer = new THREE.WebGLRenderer({
			alpha: true,
			antialias: true,
			powerPreference: 'high-performance',
		});
		renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
		renderer.setClearColor(0x000000, 0);
		container.appendChild(renderer.domElement);

		const positions: number[] = [];
		const colors: number[] = [];
		const geometry = new THREE.BufferGeometry();

		for (let ix = 0; ix < AMOUNTX; ix += 1) {
			for (let iy = 0; iy < AMOUNTY; iy += 1) {
				const x = ix * SEPARATION - (AMOUNTX * SEPARATION) / 2;
				const y = -120;
				const z = iy * SEPARATION - (AMOUNTY * SEPARATION) / 2;
				const softVariance = Math.sin(ix * 0.8) * 0.035;
				const isDark = activeTheme === 'dark';

				positions.push(x, y, z);
				colors.push(
					isDark ? 0.92 + softVariance : 0.28,
					isDark ? 0.92 + softVariance : 0.28,
					isDark ? 0.95 + softVariance : 0.3,
				);
			}
		}

		geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
		geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

		const material = new THREE.PointsMaterial({
			size: 5.35,
			vertexColors: true,
			transparent: true,
			opacity: 0.62,
			sizeAttenuation: true,
			depthWrite: false,
		});

		const points = new THREE.Points(geometry, material);
		scene.add(points);

		let animationId = 0;
		let count = 0;

		const resize = () => {
			const width = container.clientWidth || window.innerWidth;
			const height = container.clientHeight || window.innerHeight;

			camera.aspect = width / height;
			camera.updateProjectionMatrix();
			renderer.setSize(width, height, false);
		};

		const animate = () => {
			animationId = requestAnimationFrame(animate);

			const positionAttribute = geometry.attributes.position;
			const positionArray = positionAttribute.array as Float32Array;
			let pointIndex = 0;

			for (let ix = 0; ix < AMOUNTX; ix += 1) {
				for (let iy = 0; iy < AMOUNTY; iy += 1) {
					const index = pointIndex * 3;
					positionArray[index + 1] =
						Math.sin((ix + count) * 0.28) * 34 +
						Math.sin((iy + count) * 0.42) * 24 -
						140;
					pointIndex += 1;
				}
			}

			positionAttribute.needsUpdate = true;
			points.rotation.y = Math.sin(count * 0.018) * 0.035;
			points.rotation.x = -0.02 + Math.sin(count * 0.012) * 0.015;
			renderer.render(scene, camera);
			count += 0.028;
		};

		const resizeObserver = new ResizeObserver(resize);
		resizeObserver.observe(container);
		resize();
		animate();

		sceneRef.current = {
			scene,
			renderer,
			geometry,
			material,
			resizeObserver,
			animationId,
		};

		return () => {
			resizeObserver.disconnect();
			cancelAnimationFrame(animationId);
			geometry.dispose();
			material.dispose();
			renderer.dispose();

			if (renderer.domElement.parentNode === container) {
				container.removeChild(renderer.domElement);
			}

			sceneRef.current = null;
		};
	}, [activeTheme]);

	return <div ref={containerRef} className={cn('dotted-surface', className)} {...props} />;
}

export default DottedSurface;
