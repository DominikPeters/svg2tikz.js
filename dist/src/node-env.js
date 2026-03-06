import { JSDOM } from 'jsdom';
let installed = false;
export function installNodeSvgEnvironment() {
    if (installed && globalThis.DOMParser && globalThis.document)
        return;
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    globalThis.DOMParser = dom.window.DOMParser;
    globalThis.document = dom.window.document;
    installed = true;
}
//# sourceMappingURL=node-env.js.map