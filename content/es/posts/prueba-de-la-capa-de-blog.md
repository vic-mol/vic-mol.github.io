---
title: "Entrada de prueba para la capa del blog"
date: 2026-10-20T09:00:00-06:00
draft: true   # entrada de marcador para desarrollar las plantillas del blog; bórrala antes de la primera entrada real
translationKey: "blog-layer-test"
description: "Una entrada de marcador que ejercita las plantillas del blog: encabezados, índice, etiquetas, una figura, entradas relacionadas y el enlace a la traducción."
tags: ["marcador", "capa-de-blog", "agentes-de-ia"]
toc: true
---

Esta es una entrada de prueba para la capa del blog. Nada de este texto es contenido real: solo sirve para que la lista, la página de la entrada, las etiquetas y los feeds tengan algo que mostrar.

## Por qué una entrada de marcador

Un diseño se juzga mejor con una página real enfrente. Esta entrada tiene varios encabezados, una lista, un bloque de código, una imagen y tres etiquetas, lo suficiente para ver el índice, el tiempo de lectura y la tipografía trabajando juntos.

- La fecha sigue el idioma de la página.
- Las etiquetas enlazan a sus propias páginas.
- La traducción al inglés se enlaza al inicio de la entrada.

## Qué muestra la página

Debajo del título aparecen la fecha de publicación, el tiempo estimado de lectura y las etiquetas. Si la entrada tiene al menos tres encabezados, antes del texto aparece un índice.

{{< figure src="images/gallery/sf-marina-sunrise.jpg" >}}

## Un ejemplo de código

Los bloques de código usan el mismo resaltado que el resto del sitio, en modo claro y oscuro.

```python
def saludar(nombre: str) -> str:
    return f"Hola, {nombre}"
```

### Un encabezado menor

Los encabezados de tercer nivel también aparecen en el índice.

## A dónde seguir

Reemplaza esta entrada por una real: copia el arquetipo, escribe las versiones en inglés y en español con el mismo `translationKey` y cambia a `draft: false`.
