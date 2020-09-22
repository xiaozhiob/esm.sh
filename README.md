# ESM Delivery
A fast, global content delivery network for ES Modules. All modules are transformed to ESM by [esbuild](https://github.com/evanw/esbuild) from [npm](http://npmjs.org/).

# Usage
```javascript
import React from 'https://esm.sh/react'
```

### Specify version
```javascript
import React from 'https://esm.sh/react@16.13.1'
```

### Bundle mode
```javascript
// bundle multiple packages
import React from 'https://esm.sh/[react,react-dom]/react'
import ReactDom from 'https://esm.sh/[react,react-dom]/react-dom'
```
or your can define bundle list the `import-map.json` ([import maps proposal](https://github.com/WICG/import-maps))
```json
{
    imports: {
        "https://esm.sh/": "https://esm.sh/[react,react-dom]/",
        ...
    }
}
```

```javascript
import React from 'https://esm.sh/react' // actual import from 'https://esm.sh/[react,react-dom]/react'
```

### Specify ESM target
```javascript
import React from 'https://esm.sh/react?target=es2020'
```

### Development mode
```javascript
import React from 'https://esm.sh/react?dev'
```

### Submodule
```javascript
import { renderToString } from 'https://esm.sh/react-dom/server'
```

# Self-Hosting
You will need [Go](https://golang.org/dl) 1.5+ to compile the server application. On the host ensure the [supervisor](http://supervisord.org/) installed, then run `sh ./scripts/deploy.sh` to deploy the server application. The server application will check the nodejs installation (12+) or install the latest LTS version automatically.
