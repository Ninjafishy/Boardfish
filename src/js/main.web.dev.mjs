import { WEB_SCRIPTS } from './startup_manifest.mjs';
import { loadScripts } from './startup_loader.mjs';

await loadScripts(WEB_SCRIPTS);
