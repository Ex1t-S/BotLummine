# Plan general de testeo IA para ecommerce

## Objetivo

Validar si la IA puede vender, orientar y escalar bien en distintos verticales ecommerce sin inventar datos y sin romper el flujo comercial.

## Alcance

Este plan no asume solo moda. Sirve para moda, belleza, hogar, tecnologia, mascotas, suplementos y otros catalogos.

## Preparacion

1. Crear un workspace de prueba por vertical.
2. Cargar branding, tono, contexto comercial, metodos de pago y politicas basicas.
3. Cargar catalogo realista:
   - 10 a 30 productos por vertical.
   - variantes reales de color, talle, capacidad, medida o presentacion.
   - links validos.
   - promos reales y productos sin promo.
4. Confirmar que la IA tenga acceso a catalogo, pagos, envios y, si aplica, estados de pedido.

## Suite minima por tienda

### 1. Descubrimiento

- Saludo simple: `hola`
- Consulta abierta: `que productos tienen`
- Consulta ambigua: `busco algo para regalar`
- Consulta con necesidad: `quiero algo para usar todos los dias`

### 2. Producto

- Búsqueda por nombre exacto.
- Búsqueda por problema o necesidad.
- Búsqueda por atributo: color, talle, capacidad, aroma, material, compatibilidad.
- Comparacion entre dos opciones.
- Pedido de precio.
- Pedido de promo.
- Pedido de link.

### 3. Compra

- Pregunta por medios de pago.
- Pregunta por transferencia.
- Pregunta por cuotas.
- Pregunta por envio.
- Pregunta por tiempos de entrega.
- Cierre: `lo quiero comprar`.

### 4. Postventa

- Estado de pedido con numero.
- Estado de pedido sin numero.
- Reclamo por demora.
- Pedido de hablar con persona.

### 5. Robustez

- Mensaje muy corto: `si`, `dale`, `ok`.
- Cambio brusco de tema.
- Mensaje con errores de escritura.
- Mensaje con audio, imagen o comprobante.
- Cliente enojado.
- Cliente indeciso.

## Criterios de evaluacion

Puntuar cada caso de 1 a 5 en:

1. Comprension: detecta bien la intencion.
2. Precision comercial: recomienda algo coherente.
3. No alucinacion: no inventa stock, precios, promos ni politicas.
4. Continuidad: mantiene contexto entre turnos.
5. Conversion: acerca a link, pago o cierre.
6. Escalamiento: deriva a humano cuando corresponde.
7. Tono: suena humana, clara y util.

## Alertas rojas

- Mezcla categorias sin permiso.
- Repite saludo como si la charla empezara de cero.
- Ofrece un link incorrecto.
- Repite precio o promo cuando ya respondio otra cosa.
- Dice que hay stock, envio o cuotas sin respaldo.
- Ante un vertical no entrenado responde demasiado generico o vuelve a familias de moda.

## Matriz por vertical

### Moda

- talle
- color
- promo
- link exacto
- cambio de talle

### Belleza

- tipo de piel
- rutina
- compatibilidad entre productos
- frecuencia de uso

### Tecnologia

- compatibilidad
- especificaciones
- uso principal
- rango de precio

### Hogar

- medidas
- material
- ambiente de uso
- mantenimiento

### Mascotas

- tamaño de mascota
- edad
- necesidad concreta
- frecuencia de uso

## Recomendacion operativa

1. Empezar por un vertical fuerte, por ejemplo moda.
2. Ejecutar el script demo del repo para validar tono y flujo base.
3. Repetir el mismo set en 2 o 3 verticales no moda.
4. Marcar en qué casos la IA cae en respuestas genericas.
5. Ajustar mapeos comerciales y prompts por vertical antes de abrir mas tiendas.
