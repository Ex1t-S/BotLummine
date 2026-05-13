"use client";

import {
	forwardRef,
	useCallback,
	useEffect,
	useState,
	type CSSProperties,
	type MouseEvent,
	type ReactNode,
} from "react";
import {
	AnimatePresence,
	motion,
	useMotionTemplate,
	useMotionValue,
	type MotionStyle,
	type MotionValue,
	type Variants,
} from "framer-motion";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

type StaticImageData = string;

type WrapperStyle = MotionStyle & {
	"--x": MotionValue<string>;
	"--y": MotionValue<string>;
};

interface CardProps {
	bgClass?: string;
}

export interface ImageSet {
	step1img1: StaticImageData;
	step1img2: StaticImageData;
	step2img1: StaticImageData;
	step2img2: StaticImageData;
	step3img: StaticImageData;
	step4img: StaticImageData;
	alt: string;
}

export interface FeatureCarouselStep {
	id: string;
	name: string;
	title: string;
	description: string;
}

interface FeatureCarouselProps extends CardProps {
	step1img1Class?: string;
	step1img2Class?: string;
	step2img1Class?: string;
	step2img2Class?: string;
	step3imgClass?: string;
	step4imgClass?: string;
	image: ImageSet;
	steps?: readonly FeatureCarouselStep[];
}

interface StepImageProps {
	src: StaticImageData;
	alt: string;
	className?: string;
	style?: CSSProperties;
	width?: number;
	height?: number;
}

interface AnimatedStepImageProps extends StepImageProps {
	preset?: AnimationPreset;
	delay?: number;
}

const TOTAL_STEPS = 4;

const defaultSteps: readonly FeatureCarouselStep[] = [
	{
		id: "1",
		name: "Inbox",
		title: "Cada conversación llega al lugar correcto",
		description:
			"Separá atención automática, intervención humana y comprobantes para que el equipo sepa qué mirar primero.",
	},
	{
		id: "2",
		name: "Campañas",
		title: "Lanza seguimientos sin perder trazabilidad",
		description:
			"Prepará plantillas, audiencias y envíos desde una misma vista, con resultados visibles después de salir.",
	},
	{
		id: "3",
		name: "Carritos",
		title: "Recuperá oportunidades antes de que se enfríen",
		description:
			"Detectá carritos abandonados, priorizá los más valiosos y volvé a activar la conversación con contexto.",
	},
	{
		id: "4",
		name: "Operación",
		title: "Mira lo urgente antes de entrar al detalle",
		description:
			"Resumen de chats, comprobantes, automatizaciones y alertas para ordenar la jornada comercial.",
	},
];

const ANIMATION_PRESETS = {
	fadeInScale: {
		initial: { opacity: 0, scale: 0.95 },
		animate: { opacity: 1, scale: 1 },
		exit: { opacity: 0, scale: 0.95 },
		transition: { type: "spring", stiffness: 300, damping: 25, mass: 0.5 },
	},
	slideInRight: {
		initial: { opacity: 0, x: 20 },
		animate: { opacity: 1, x: 0 },
		exit: { opacity: 0, x: -20 },
		transition: { type: "spring", stiffness: 300, damping: 25, mass: 0.5 },
	},
	slideInLeft: {
		initial: { opacity: 0, x: -20 },
		animate: { opacity: 1, x: 0 },
		exit: { opacity: 0, x: 20 },
		transition: { type: "spring", stiffness: 300, damping: 25, mass: 0.5 },
	},
} as const;

type AnimationPreset = keyof typeof ANIMATION_PRESETS;

function useNumberCycler(totalSteps = TOTAL_STEPS, interval = 5200) {
	const [currentNumber, setCurrentNumber] = useState(0);

	useEffect(() => {
		const timerId = window.setTimeout(() => {
			setCurrentNumber((prev) => (prev + 1) % totalSteps);
		}, interval);

		return () => window.clearTimeout(timerId);
	}, [currentNumber, totalSteps, interval]);

	const setStep = useCallback(
		(stepIndex: number) => {
			setCurrentNumber(stepIndex % totalSteps);
		},
		[totalSteps]
	);

	return { currentNumber, setStep };
}

function useIsMobile() {
	const [isMobile, setIsMobile] = useState(false);

	useEffect(() => {
		const mediaQuery = window.matchMedia("(max-width: 768px)");
		const sync = () => setIsMobile(mediaQuery.matches);

		sync();
		mediaQuery.addEventListener("change", sync);
		return () => mediaQuery.removeEventListener("change", sync);
	}, []);

	return isMobile;
}

const stepVariants: Variants = {
	inactive: { scale: 0.94, opacity: 0.74 },
	active: { scale: 1, opacity: 1 },
};

const StepImage = forwardRef<HTMLImageElement, StepImageProps>(({ src, alt, className, style, ...props }, ref) => {
	return (
		<img
			ref={ref}
			alt={alt}
			className={className}
			src={src}
			style={{ position: "absolute", userSelect: "none", maxWidth: "unset", ...style }}
			{...props}
		/>
	);
});
StepImage.displayName = "StepImage";

const MotionStepImage = motion(StepImage);

function AnimatedStepImage({ preset = "fadeInScale", delay = 0, ...props }: AnimatedStepImageProps) {
	const presetConfig = ANIMATION_PRESETS[preset];
	return <MotionStepImage {...props} {...presetConfig} transition={{ ...presetConfig.transition, delay }} />;
}

function FeatureCard({
	children,
	step,
	steps,
}: {
	children: ReactNode;
	step: number;
	steps: readonly FeatureCarouselStep[];
}) {
	const mouseX = useMotionValue(0);
	const mouseY = useMotionValue(0);
	const isMobile = useIsMobile();

	function handleMouseMove({ currentTarget, clientX, clientY }: MouseEvent<HTMLDivElement>) {
		if (isMobile) return;
		const { left, top } = currentTarget.getBoundingClientRect();
		mouseX.set(clientX - left);
		mouseY.set(clientY - top);
	}

	return (
		<motion.div
			className="animated-cards group relative w-full rounded-[1.5rem]"
			onMouseMove={handleMouseMove}
			style={{ "--x": useMotionTemplate`${mouseX}px`, "--y": useMotionTemplate`${mouseY}px` } as WrapperStyle}
		>
			<div className="relative w-full overflow-hidden rounded-[1.75rem] border border-white/12 bg-white/[0.045] shadow-[0_28px_120px_rgba(0,0,0,0.24)] backdrop-blur-xl">
				<div
					className="pointer-events-none absolute inset-y-0 left-0 z-[1] w-[68%] bg-[linear-gradient(90deg,rgba(4,10,25,0.96)_0%,rgba(4,10,25,0.9)_44%,rgba(4,10,25,0.48)_76%,rgba(4,10,25,0)_100%)]"
					aria-hidden="true"
				/>
				<div className="relative min-h-[520px] w-full px-6 py-7 sm:px-8 sm:py-8 lg:px-10 lg:py-10">
					<AnimatePresence mode="wait">
						<motion.div
							key={step}
							className="relative z-10 flex w-full max-w-xl flex-col gap-4 lg:w-[48%]"
							initial={{ opacity: 0, y: 20 }}
							animate={{ opacity: 1, y: 0 }}
							exit={{ opacity: 0, y: -20 }}
							transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
						>
							<motion.div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-300">
								{steps[step].name}
							</motion.div>
							<motion.h2 className="max-w-lg text-3xl font-semibold leading-tight !text-slate-50 sm:text-4xl">
								{steps[step].title}
							</motion.h2>
							<motion.p className="max-w-lg text-base leading-7 !text-slate-100/90 sm:text-lg">
								{steps[step].description}
							</motion.p>
						</motion.div>
					</AnimatePresence>
					{children}
				</div>
			</div>
		</motion.div>
	);
}

function StepsNav({
	steps,
	current,
	onChange,
}: {
	steps: readonly FeatureCarouselStep[];
	current: number;
	onChange: (index: number) => void;
}) {
	return (
		<nav aria-label="Recorrido del producto" className="flex justify-center px-2">
			<ol className="flex w-full flex-wrap items-center justify-center gap-2" role="list">
				{steps.map((step, stepIdx) => {
					const isCompleted = current > stepIdx;
					const isCurrent = current === stepIdx;

					return (
						<motion.li
							key={step.name}
							initial="inactive"
							animate={isCurrent ? "active" : "inactive"}
							variants={stepVariants}
							transition={{ duration: 0.3 }}
							className="relative"
						>
							<button
								type="button"
								className={cn(
									"group flex items-center gap-2.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300",
									isCurrent
										? "bg-sky-300 text-slate-950"
										: "bg-white/8 text-white/84 hover:bg-white/14"
								)}
								onClick={() => onChange(stepIdx)}
							>
								<span
									className={cn(
										"flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-all duration-300",
										isCompleted
											? "bg-sky-300 text-slate-950"
											: isCurrent
												? "bg-slate-950 text-sky-200"
												: "bg-white/12 text-white"
									)}
								>
									{isCompleted ? <Check className="h-3.5 w-3.5" /> : <span>{stepIdx + 1}</span>}
								</span>
								<span className="hidden sm:inline-block">{step.name}</span>
							</button>
						</motion.li>
					);
				})}
			</ol>
		</nav>
	);
}

const defaultClasses = {
	img: "rounded-2xl border border-white/12 shadow-[0_24px_80px_rgba(0,0,0,0.32)]",
	step1img1: "w-[57%] left-[44%] top-[12%]",
	step1img2: "w-[52%] left-[38%] top-[48%]",
	step2img1: "w-[58%] left-[40%] top-[10%]",
	step2img2: "w-[46%] left-[49%] top-[48%]",
	step3img: "w-[58%] left-[39%] top-[13%]",
	step4img: "w-[58%] left-[39%] top-[13%]",
} as const;

export function FeatureCarousel({
	image,
	steps = defaultSteps,
	step1img1Class = defaultClasses.step1img1,
	step1img2Class = defaultClasses.step1img2,
	step2img1Class = defaultClasses.step2img1,
	step2img2Class = defaultClasses.step2img2,
	step3imgClass = defaultClasses.step3img,
	step4imgClass = defaultClasses.step4img,
	...props
}: FeatureCarouselProps) {
	const totalSteps = Math.min(TOTAL_STEPS, steps.length);
	const { currentNumber: step, setStep } = useNumberCycler(totalSteps);

	function renderStepContent() {
		switch (step) {
			case 0:
				return (
					<div className="relative h-full w-full">
						<AnimatedStepImage alt={image.alt} className={cn(defaultClasses.img, step1img1Class)} src={image.step1img1} preset="slideInLeft" />
						<AnimatedStepImage alt={image.alt} className={cn(defaultClasses.img, step1img2Class)} src={image.step1img2} preset="slideInRight" delay={0.1} />
					</div>
				);
			case 1:
				return (
					<div className="relative h-full w-full">
						<AnimatedStepImage alt={image.alt} className={cn(defaultClasses.img, step2img1Class)} src={image.step2img1} preset="fadeInScale" />
						<AnimatedStepImage alt={image.alt} className={cn(defaultClasses.img, step2img2Class)} src={image.step2img2} preset="fadeInScale" delay={0.1} />
					</div>
				);
			case 2:
				return <AnimatedStepImage alt={image.alt} className={cn(defaultClasses.img, step3imgClass)} src={image.step3img} preset="fadeInScale" />;
			case 3:
				return <AnimatedStepImage alt={image.alt} className={cn(defaultClasses.img, step4imgClass)} src={image.step4img} preset="fadeInScale" />;
			default:
				return null;
		}
	}

	return (
		<div className="mx-auto flex w-full max-w-6xl flex-col gap-7">
			<FeatureCard {...props} step={step} steps={steps}>
				<AnimatePresence mode="wait">
					<motion.div key={step} {...ANIMATION_PRESETS.fadeInScale} className="absolute inset-0">
						{renderStepContent()}
					</motion.div>
				</AnimatePresence>
			</FeatureCard>
			<motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
				<StepsNav current={step} onChange={setStep} steps={steps.slice(0, totalSteps)} />
			</motion.div>
		</div>
	);
}

export type { FeatureCarouselProps };
