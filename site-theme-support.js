export const DEFAULT_SITE_THEME = Object.freeze({version:1,adapter:'wanhar-portfolio-v1',mode:'dark',accent:'gold'});
export const THEME_MODES = Object.freeze([{value:'dark',label:'Dark'},{value:'light',label:'Light'},{value:'system',label:'System'}]);
export const THEME_ACCENTS = Object.freeze([{value:'gold',label:'Gold'},{value:'emerald',label:'Emerald'},{value:'blue',label:'Blue'},{value:'rose',label:'Rose'}]);

export function parseSiteTheme(value) {
  let config=value;
  if (typeof value === 'string') {
    try { config=JSON.parse(value); } catch (_) { throw new TypeError('Invalid site theme JSON'); }
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new TypeError('Site theme must be an object');
  const keys=Object.keys(config).sort();
  if (keys.join(',') !== 'accent,adapter,mode,version' || config.version !== 1 || config.adapter !== 'wanhar-portfolio-v1' || !THEME_MODES.some(x=>x.value===config.mode) || !THEME_ACCENTS.some(x=>x.value===config.accent)) throw new TypeError('Unsupported site theme configuration');
  return {version:1,adapter:'wanhar-portfolio-v1',mode:config.mode,accent:config.accent};
}

export function injectPortfolioTheme(html) {
  if (typeof html !== 'string') throw new TypeError('HTML must be a string');
  if (!/<head(?:\s[^>]*)?>/i.test(html) || !/<\/head\s*>/i.test(html)) throw new TypeError('HTML must include a closing head tag');
  let out=html;
  const meta=/<meta\s+name\s*=\s*(["'])cue-site-theme\1\s+content\s*=\s*(["'])wanhar-portfolio-v1\2\s*\/?\s*>/i;
  if (!meta.test(out)) out=out.replace(/<head(?:\s[^>]*)?>/i, match=>match+'<meta name="cue-site-theme" content="wanhar-portfolio-v1">');
  const hasLink=Array.from(out.matchAll(/<link\b[^>]*>/gi)).some(([tag])=>/\brel\s*=\s*["']stylesheet["']/i.test(tag)&&/\bhref\s*=\s*["']\.\/site-theme\.css["']/i.test(tag));
  const hasScript=Array.from(out.matchAll(/<script\b[^>]*>\s*<\/script\s*>/gi)).some(([tag])=>/\bsrc\s*=\s*["']\.\/site-theme\.js["']/i.test(tag)&&/\bdefer(?:\s|=|>)/i.test(tag));
  let additions='';
  if (!hasLink) additions+='<link rel="stylesheet" href="./site-theme.css">';
  if (!hasScript) additions+='<script src="./site-theme.js" defer></script>';
  return out.replace(/<\/head\s*>/i, additions+'</head>');
}

export function isSupportedThemeHTML(html) {
  if (typeof html !== 'string') return false;
  const meta=/<meta\s+name\s*=\s*(["'])cue-site-theme\1\s+content\s*=\s*(["'])wanhar-portfolio-v1\2\s*\/?\s*>/i;
  const links=Array.from(html.matchAll(/<link\b[^>]*>/gi)).some(([tag])=>/\brel\s*=\s*["']stylesheet["']/i.test(tag)&&/\bhref\s*=\s*["']\.\/site-theme\.css["']/i.test(tag));
  const scripts=Array.from(html.matchAll(/<script\b[^>]*>\s*<\/script\s*>/gi)).some(([tag])=>/\bsrc\s*=\s*["']\.\/site-theme\.js["']/i.test(tag)&&/\bdefer(?:\s|=|>)/i.test(tag));
  return meta.test(html) && links && scripts;
}
