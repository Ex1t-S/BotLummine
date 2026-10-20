import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowRight, Check, CheckCheck, ChevronRight, Headphones, Inbox, LayoutDashboard, MessageCircle, Send, ShoppingBag, Sparkles, Users, Zap } from 'lucide-react';
import { customerBrands } from './customerBrands.js';
import logoMark from '../assets/app-logo-mark.png';
import './PublicHomeVisuals.css';
import inboxImage from '../assets/feature-carousel/showcase-inbox-auto.png';
import campaignsImage from '../assets/feature-carousel/showcase-campaigns.png';
import cartsImage from '../assets/feature-carousel/showcase-carts.png';
import operationsImage from '../assets/feature-carousel/showcase-operations.png';

const scenarios = [
  { name: 'Atención', icon: MessageCircle, question: '¡Hola! ¿Tienen las Urban en talle 38?', answer: '¡Sí! Las Urban están disponibles en talle 38. Te muestro el producto para que lo veas.', status: 'Consulta atendida', detail: 'IA + catálogo conectado', tag: 'Consulta de producto' },
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

function CustomerStrip() {
  const brands = customerBrands.filter(brand => brand.confirmed || import.meta.env.DEV);
  return <section className="customer-strip" aria-labelledby="customer-title">
    <div className="customer-heading"><span className="public-eyebrow">CONEXIONES QUE CRECEN</span><h2 id="customer-title">Tiendas que trabajan con BladeIA</h2><p>Lummine, Kaisy y Pampa Store ya son parte.</p></div>
    {import.meta.env.DEV && <p className="customer-preview-note">Vista de diseño · 3 tiendas confirmadas + 12 nombres ficticios marcados como ejemplo.</p>}
    <div className="customer-brand-grid">{brands.map((brand, index) => <div className={'customer-wordmark customer-wordmark--' + (index % 5)} key={brand.name}><span>{brand.name}</span>{!brand.confirmed && <small>Ejemplo ficticio</small>}</div>)}</div>
  </section>;
}

function ConversationScene() {
  const [active, setActive] = useState(0);
  const scene = scenarios[active];
  return <div className="blade-app-stage">
    <div className="blade-app-window">
      <div className="blade-app-topbar"><span className="window-dots" aria-hidden="true"><i /><i /><i /></span><span>BladeIA · Tu espacio de trabajo</span><span className="app-example">Vista ilustrativa con datos de ejemplo</span></div>
      <div className="blade-app-layout">
        <aside className="blade-app-sidebar" aria-label="Secciones ilustrativas del panel"><div className="app-mini-brand"><img src={logoMark} alt="" />BladeIA</div><div className="app-workspace"><small>ESPACIO ACTIVO</small><strong>Tu tienda</strong></div><small>OPERACIÓN</small><span><LayoutDashboard /> Operación</span><span className="active"><Inbox /> Bandeja</span><small>VENTAS</small><span><ShoppingBag /> Catálogo</span><span><ShoppingBag /> Carritos</span><span><Users /> Clientes</span><small>COMERCIAL</small><span><Send /> Campañas</span><div className="app-sidebar-bottom"><span>TM</span><div>Tu equipo<small>Todo conectado</small></div></div></aside>
        <div className="blade-inbox"><div className="app-inbox-heading"><h3>Bandeja</h3><span>Tu equipo + tu IA</span></div><div className="app-inbox-filters"><span>Automático</span><span>Atención humana</span><span>Comprobantes</span></div><div className="app-inbox-body">
          <div className="app-contact-list"><div className="app-search">Buscar conversación…</div>{[['MC','Martina','Consulta sobre un producto','Automático'],['SL','Sofía','¿Me ayudás con mi pedido?','Atención humana'],['NT','Nicolás','Quiero retomar mi compra','Seguimiento']].map(([initials,name,message,tag],index)=><div className={'app-contact' + (index===active?' selected':'')} key={name}><span>{initials}</span><div><strong>{name}<small>10:24</small></strong><p>{message}</p><em>{tag}</em></div></div>)}<p className="app-list-note"><Check aria-hidden="true" /> Historial en un mismo lugar</p></div>
          <div className="app-conversation"><div className="app-chat-heading"><span className="app-contact-avatar">{['MC','SL','NT'][active]}</span><div><strong>{['Martina','Sofía','Nicolás'][active]}</strong><small>WhatsApp · Cliente de ejemplo</small></div><span className="app-ai-pill"><Sparkles /> IA activa</span></div><div className="app-messages" key={active} aria-live="polite" aria-atomic="true"><span className="app-day">HOY</span><div className="app-bubble app-bubble--in">{scene.question}<small>10:24</small></div><div className="app-bubble app-bubble--out"><span><Sparkles /> BladeIA</span>{scene.answer}<small>10:24 <CheckCheck /></small></div>{active===0 && <div className="app-product-card"><img src="/images/home/ecommerce-products-thumb.webp" alt="Productos ilustrativos de una tienda: zapatillas, indumentaria y paquetes" /><div><small>CATÁLOGO CONECTADO</small><strong>Urban · Talle 38</strong><span>Consulta de disponibilidad</span></div></div>}<span className="app-conversation-event"><Check /> {scene.tag}</span></div><div className="app-compose" aria-hidden="true"><span>Escribí un mensaje…</span><Send /></div></div>
        </div></div>
      </div>
    </div>
    <div className="app-floating-note"><span><Sparkles /></span><div><strong>IA cuando suma.</strong><small>Tu equipo cuando importa.</small></div></div>
    <div className="app-floating-status" aria-live="polite"><Check /><div><strong>{scene.status}</strong><small>{scene.detail}</small></div></div>
    <div className="scene-controls" role="group" aria-label="Explorar ejemplos de conversación">{scenarios.map((item,index)=>{const Icon=item.icon;return <button key={item.name} type="button" aria-pressed={index===active} onClick={()=>setActive(index)}><Icon />{item.name}</button>;})}</div>
  </div>;
}

function CommerceStories() {
  return <section className="commerce-stories home-container" aria-labelledby="commerce-title"><Reveal><div className="home-section-heading"><span className="public-eyebrow">DETRÁS DE CADA CHAT, HAY UN NEGOCIO</span><h2 id="commerce-title">Tecnología para vender.<br /><span>Tiempo para crear.</span></h2><p>Desde una consulta de talle hasta una compra pendiente: acompañá a tus clientes sin perder de vista todo lo demás.</p></div></Reveal><div className="commerce-story-grid"><Reveal className="commerce-editorial"><img src="/images/home/commerce-team.webp" alt="Escena ilustrativa creada con IA: un equipo de tienda prepara pedidos y trabaja con una computadora" loading="lazy" width="1536" height="1024" /><div className="commerce-photo-label"><Users /><span>El negocio es tuyo.<br /><strong>El tiempo también.</strong></span></div><span className="ai-image-note">Imagen ilustrativa creada con IA</span></Reveal><Reveal className="commerce-product-story"><div><span className="public-eyebrow">DEL CATÁLOGO A LA CONVERSACIÓN</span><h3>Tus productos.<br />En el centro del chat.</h3><p>Conectá lo que vendés con lo que tus clientes necesitan. Consultas, historial y seguimiento, en el mismo espacio.</p><a className="text-link" href="#producto">Conocé las herramientas <ArrowRight /></a></div><img src="/images/home/ecommerce-products.webp" alt="Composición de productos creada con IA: indumentaria, zapatillas, cosmética y cajas de envío" loading="lazy" width="1536" height="1024" /></Reveal></div></section>;
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

      <CustomerStrip />

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

      <CommerceStories />

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
