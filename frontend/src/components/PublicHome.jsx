import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowRight, Check, CheckCheck, ChevronRight, Headphones, Inbox, LayoutDashboard, MessageCircle, MoreHorizontal, Send, ShoppingBag, Sparkles, Users, Zap } from 'lucide-react';
import inboxImage from '../assets/feature-carousel/showcase-inbox-auto.png';
import campaignsImage from '../assets/feature-carousel/showcase-campaigns.png';
import cartsImage from '../assets/feature-carousel/showcase-carts.png';
import operationsImage from '../assets/feature-carousel/showcase-operations.png';

const scenarios = [
  { name: 'Atención', icon: MessageCircle, question: '¡Hola! ¿Me ayudás a elegir un producto?', answer: '¡Claro! Contame qué estás buscando y te muestro las opciones de nuestro catálogo.', status: 'Consulta atendida', detail: 'IA + catálogo conectado', tag: 'Consulta de producto' },
  { name: 'Ventas', icon: ShoppingBag, question: 'Me interesa este producto. ¿Cómo sigo?', answer: 'Te acompaño con la compra. Si necesitás ayuda con el pago, te derivo a una persona del equipo.', status: 'Equipo conectado', detail: 'Toda la conversación a mano', tag: 'Intención de compra' },
  { name: 'Seguimiento', icon: Zap, question: 'Dejé una compra pendiente. ¿La puedo retomar?', answer: '¡Sí! Podemos retomar tu carrito y ayudarte a completar lo que te falta.', status: 'Oportunidad retomada', detail: 'Seguimiento con contexto', tag: 'Carrito pendiente' },
];

const productViews = [
  { label: 'Bandeja compartida', icon: Inbox, title: 'Una conversación. Todo el contexto.', text: 'Tu equipo y la IA trabajan en la misma bandeja. Identificá qué necesita atención humana y retomá cada conversación con su historial.', image: inboxImage, alt: 'Bandeja de BladeIA con conversaciones de ejemplo y atención automática' },
  { label: 'Campañas', icon: Send, title: 'Volvé a conectar con tus clientes.', text: 'Elegí tu audiencia, prepará el mensaje y seguí los resultados. Organizá tus campañas desde un mismo lugar.', image: campaignsImage, alt: 'Panel de campañas de BladeIA con datos de ejemplo' },
  { label: 'Carritos', icon: ShoppingBag, title: 'Dale otra oportunidad a cada carrito.', text: 'Encontrá compras pendientes, revisá su contexto y organizá el seguimiento desde tu operación comercial.', image: cartsImage, alt: 'Panel de recuperación de carritos de BladeIA con datos de ejemplo' },
  { label: 'Operación', icon: LayoutDashboard, title: 'Empezá el día con las prioridades claras.', text: 'Reuní conversaciones, comprobantes y oportunidades pendientes para decidir dónde necesita intervenir tu equipo.', image: operationsImage, alt: 'Panel operativo de BladeIA con datos de ejemplo' },
];

function Reveal({ children, className = '' }) {
  const ref = useRef(null);
  useEffect(() => {
    const node = ref.current;
    if (!node || !('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    node.dataset.reveal = 'waiting';
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { node.dataset.reveal = 'visible'; observer.disconnect(); }
    }, { threshold: 0.08 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return <div ref={ref} className={`home-reveal ${className}`}>{children}</div>;
}

function ConversationScene() {
  const [active, setActive] = useState(0);
  const scene = scenarios[active];
  return (
    <div className="conversation-stage">
      <div className="stage-orbit stage-orbit--one" aria-hidden="true" />
      <div className="stage-orbit stage-orbit--two" aria-hidden="true" />
      <div className="scene-float scene-float--ai"><span className="mini-icon"><Sparkles /></span><div><strong>Tu IA, en equipo.</strong><span>Responde. Acompaña. Conecta.</span></div></div>
      <div className="conversation-window">
        <div className="window-top"><span className="window-dots" aria-hidden="true"><i /><i /><i /></span><span>Tu negocio, conectado</span><span className="scene-example">Ejemplo ilustrativo</span></div>
        <div className="scene-layout">
          <div className="scene-sidebar"><span className="scene-app-icon"><Sparkles /></span><Inbox /><Users /><ShoppingBag /><LayoutDashboard /><span className="scene-avatar">B</span></div>
          <div className="scene-chat">
            <div className="scene-chat-head"><span className="whatsapp-mark"><MessageCircle /></span><div><strong>Tu tienda</strong><span>Atención por WhatsApp</span></div><MoreHorizontal /></div>
            <div className="scene-messages" key={active} aria-live="polite" aria-atomic="true">
              <span className="scene-day">Así se ve una conversación más simple</span>
              <div className="chat-bubble chat-bubble--customer">{scene.question}<small>10:24</small></div>
              <div className="chat-bubble chat-bubble--brand"><span className="bubble-author"><Sparkles /> BladeIA</span>{scene.answer}<small>10:24 <CheckCheck /></small></div>
              <span className="scene-context"><Check /> {scene.tag}</span>
            </div>
            <div className="scene-composer" aria-hidden="true"><span>Tu próxima conversación empieza acá…</span><span><ArrowRight /></span></div>
          </div>
          <div className="scene-context-panel"><span className="context-label">MENOS TAREAS REPETIDAS</span><h3>Más tiempo<br />para conectar.</h3><div><Check /> IA con tu catálogo</div><div><Check /> Historial compartido</div><div><Check /> Control de tu equipo</div><span className="context-flower" aria-hidden="true">✳</span><span>La tecnología acompaña.<br />Tu equipo decide.</span></div>
        </div>
      </div>
      <div className="scene-float scene-float--status" aria-live="polite"><span className="mini-icon mini-icon--green"><Check /></span><div><strong>{scene.status}</strong><span>{scene.detail}</span></div></div>
      <div className="scene-controls" role="group" aria-label="Explorar ejemplos de conversación">{scenarios.map((item, index) => { const Icon = item.icon; return <button key={item.name} type="button" aria-pressed={index === active} onClick={() => setActive(index)}><Icon />{item.name}</button>; })}</div>
    </div>
  );
}

export default function PublicHome() {
  const [view, setView] = useState(0);
  const selected = productViews[view];
  return (
    <>
      <section className="home-hero" aria-labelledby="home-title">
        <div className="hero-wash" aria-hidden="true" />
        <div className="hero-copy"><span className="hero-eyebrow"><span /> INTELIGENCIA ARTIFICIAL. CONEXIONES REALES.</span>
          <h1 id="home-title">Menos tareas.<br />Más <span>conversaciones<br className="mobile-break" /> que venden.</span></h1>
          <p>Tu WhatsApp, tu equipo y tu IA. En un mismo lugar.<br className="desktop-break" /> Atendé mejor, acompañá cada venta y volvé a conectar con tus clientes.</p>
          <div className="hero-actions"><Link className="public-button" to="/precios">Encontrá tu plan <ArrowRight /></Link><a className="public-button public-button--quiet" href="#producto">Explorar BladeIA <ArrowDown /></a></div>
          <div className="hero-notes"><span><Check /> IA con control humano</span><span><Check /> Todo el contexto, siempre</span></div>
        </div>
        <ConversationScene />
      </section>

      <section className="home-capabilities" aria-label="Una plataforma para toda tu operación"><p>De la primera consulta a la próxima compra.</p><div><span><MessageCircle /> WhatsApp</span><i /><span><Sparkles /> Inteligencia artificial</span><i /><span><Users /> Tu equipo</span><i /><span><ShoppingBag /> Tu negocio</span></div></section>

      <section className="home-benefits home-container" aria-labelledby="benefits-title"><Reveal><div className="home-section-heading"><span className="public-eyebrow">MENOS IDAS Y VUELTAS</span><h2 id="benefits-title">Todo conectado.<br /><span>Mucho más simple.</span></h2><p>Las herramientas que necesitás, trabajando juntas para seguir cada oportunidad más allá del chat.</p></div></Reveal>
        <div className="benefit-grid">
          <Reveal className="benefit-card benefit-card--mint"><div className="benefit-symbol"><MessageCircle /></div><h3>Conversaciones<br /> con contexto.</h3><p>Una bandeja compartida para responder, consultar el historial y trabajar en equipo.</p><div className="mini-team" aria-hidden="true"><span>M</span><span>S</span><span>IA</span><div>Un mismo equipo.<br /><strong>Una misma conversación.</strong></div></div></Reveal>
          <Reveal className="benefit-card benefit-card--blue"><div className="benefit-symbol"><Sparkles /></div><h3>Una IA que acompaña.<br /> Vos tenés el control.</h3><p>Automatizá consultas repetidas y dejá que tu equipo intervenga cuando hace falta.</p><div className="mini-handoff"><span><Sparkles /> BladeIA</span><ArrowRight /><span><Headphones /> Tu equipo</span></div></Reveal>
          <Reveal className="benefit-card benefit-card--peach"><div className="benefit-symbol"><ShoppingBag /></div><h3>La venta no termina<br /> en el primer mensaje.</h3><p>Organizá campañas y recuperá conversaciones alrededor de compras pendientes.</p><div className="mini-journey"><span>Conversar</span><ChevronRight /><span>Acompañar</span><ChevronRight /><span>Reconectar</span></div></Reveal>
        </div>
      </section>

      <section id="producto" className="home-product" aria-labelledby="product-title"><div className="home-container"><Reveal><div className="home-section-heading home-section-heading--center"><span className="public-eyebrow">CONOCÉ BLADEIA POR DENTRO</span><h2 id="product-title">Una plataforma.<br /><span>Toda tu operación.</span></h2><p>Explorá las herramientas que acompañan a tu equipo cada día.</p></div></Reveal>
        <div className="product-tabs" role="tablist" aria-label="Vistas del producto">{productViews.map((item, index) => { const Icon = item.icon; return <button id={`product-tab-${index}`} key={item.label} type="button" role="tab" aria-selected={view === index} aria-controls="product-panel" tabIndex={view === index ? 0 : -1} onClick={() => setView(index)} onKeyDown={(event) => { let next; if (event.key === 'ArrowRight') next = (index + 1) % productViews.length; if (event.key === 'ArrowLeft') next = (index + productViews.length - 1) % productViews.length; if (event.key === 'Home') next = 0; if (event.key === 'End') next = productViews.length - 1; if (next !== undefined) { event.preventDefault(); setView(next); document.getElementById(`product-tab-${next}`)?.focus(); } }}><Icon />{item.label}</button>; })}</div>
        <div id="product-panel" className="product-panel" role="tabpanel" aria-labelledby={`product-tab-${view}`} tabIndex={0}><div className="product-panel-copy"><span className="product-count">0{view + 1} / 04</span><h3>{selected.title}</h3><p>{selected.text}</p><Link to="/precios">Ver los planes <ArrowRight /></Link></div><div className="product-screen"><div className="product-screen-bar"><span className="window-dots" aria-hidden="true"><i /><i /><i /></span><span>BladeIA / {selected.label}</span></div><img key={selected.image} src={selected.image} alt={selected.alt} width="1280" height="800" loading="lazy" /></div></div><p className="product-caption">Vistas del producto con datos de ejemplo.</p>
      </div></section>

      <section className="home-workflow home-container" aria-labelledby="workflow-title"><Reveal><div className="home-section-heading"><span className="public-eyebrow">A TU RITMO, CON TU EQUIPO</span><h2 id="workflow-title">Poné todo en marcha.<br /><span>En tres pasos.</span></h2></div></Reveal><ol>{[
        ['Conectá tu negocio', 'Reuní WhatsApp, clientes y catálogo en un solo espacio.'],
        ['Dale tu toque a la IA', 'Definí cómo responde y cuándo debe intervenir tu equipo.'],
        ['Acompañá cada oportunidad', 'Atendé, hacé seguimiento y revisá lo que pasa en tu operación.'],
      ].map(([title, copy], index) => <li key={title}><span>0{index + 1}</span><h3>{title}</h3><p>{copy}</p></li>)}</ol></section>

      <section className="home-faq home-container" aria-labelledby="faq-title"><div className="home-section-heading"><span className="public-eyebrow">HABLEMOS CLARO</span><h2 id="faq-title">Antes de empezar.</h2><p>Algunas preguntas que quizás ya te estás haciendo.</p><Link className="text-link" to="/contacto">Hablá con nosotros <ArrowRight /></Link></div><div className="faq-list">{[
        ['¿La IA reemplaza a mi equipo?', 'Tu equipo mantiene el control. BladeIA ayuda con las consultas repetidas y permite que una persona retome las conversaciones que necesitan atención humana.'],
        ['¿Qué puedo gestionar desde BladeIA?', 'Conversaciones de WhatsApp, clientes, catálogo, campañas y carritos pendientes. Las funciones disponibles dependen del plan que elijas.'],
        ['¿Cómo sé qué plan necesito?', 'Podés comparar los planes Básico y Avanzado en la página de precios. Si tenés dudas, contanos cómo trabaja tu equipo para evaluar qué alcance te conviene.'],
        ['¿Cómo empiezo a usar la plataforma?', 'Contactá al equipo para evaluar tu operación y coordinar la configuración. Si ya tenés una cuenta, podés entrar desde Ingresar.'],
      ].map(([question, answer]) => <details key={question}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div></section>

      <section className="home-final home-container"><div className="final-spark" aria-hidden="true">✳</div><span className="public-eyebrow">EL PRÓXIMO MENSAJE PUEDE SER EL COMIENZO</span><h2>Más cerca de tus clientes.<br />Más lejos del trabajo repetitivo.</h2><p>Hacé espacio para lo que mejor hace tu negocio: conectar.</p><div className="hero-actions"><Link className="public-button" to="/precios">Encontrá tu plan <ArrowRight /></Link><Link className="public-button public-button--quiet" to="/contacto">Hablemos</Link></div></section>
    </>
  );
}
