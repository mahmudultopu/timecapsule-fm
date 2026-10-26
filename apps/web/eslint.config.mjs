import nextVitals from 'eslint-config-next/core-web-vitals';
import root from '../../eslint.config.mjs';

export default [...root, ...nextVitals, { ignores: ['.next/**', 'public/vendor/**', 'next-env.d.ts'] }];
