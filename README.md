# @skipstery/inline-measure

The package is currently private. See the [standalone quick start](../../docs/GETTING_STARTED.md) for local archive installation.

Browser text measurement without React or design-system dependencies.

```ts
import { measureInlineTextWidth } from "@skipstery/inline-measure";
const width = measureInlineTextWidth({ sourceElement: element, text: "Hello", accuracy: "exact" });
```

Measure after fonts are ready. `exact` uses a hidden DOM node, `fast` uses canvas, and `auto` handles tabular numeric text with calibration. DOM-based methods require a browser. The `/multiline` entrypoint exposes line measurement utilities.
