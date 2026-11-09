export type ParsedCommand =
  | { t: 'wake' | 'listskills' | 'good' | 'bad' | 'stop' | 'enter' }
  | { t: 'teach'; phrase: string; action: string }
  | { t: 'alias'; from: string; to: string }
  | { t: 'forget' | 'find' | 'click'; q: string }
  | { t: 'fact'; text: string }
  | { t: 'tabs'; op: string; q?: string; url?: string }
  | { t: 'nav'; url: string }
  | { t: 'hist'; op: string }
  | { t: 'scroll'; d: string }
  | { t: 'media'; op: string; n?: number }
  | { t: 'page' | 'info'; op: string }
  | { t: 'region'; x: 'left' | 'center' | 'right'; y: 'top' | 'center' | 'bottom' }
  | { t: 'math'; e: string }
  | { t: 'agent'; goal: string }
  | { t: 'vr'; op: 'start' | 'stop' | 'pause' | 'resume' }
  | { t: 'nth'; n: number; kind: string }
  | { t: 'type'; text: string; q?: string; submit: boolean }
  | { t: 'reference'; op: 'click' | 'open' | 'newtab' };

const SITES: Record<string, string> = {
  youtube: 'youtube.com', google: 'google.com', gmail: 'mail.google.com', github: 'github.com',
  facebook: 'facebook.com', instagram: 'instagram.com', twitter: 'x.com', x: 'x.com',
  whatsapp: 'web.whatsapp.com', amazon: 'amazon.in', netflix: 'netflix.com', linkedin: 'linkedin.com',
  reddit: 'reddit.com', dribbble: 'dribbble.com', wikipedia: 'wikipedia.org', vercel: 'vercel.com',
  chatgpt: 'chatgpt.com', maps: 'maps.google.com',
};
const SEARCH: Record<string, string> = {
  youtube: 'https://www.youtube.com/results?search_query=',
  google: 'https://www.google.com/search?q=',
  amazon: 'https://www.amazon.in/s?k=',
  github: 'https://github.com/search?q=',
  wikipedia: 'https://en.wikipedia.org/w/index.php?search=',
};
const toUrl = (value: string): string => {
  const site = value.trim().replace(/\s+dot\s+/gi, '.').replace(/\s+/g, '');
  if (/^https?:\/\//i.test(site)) return site;
  const key = site.toLowerCase().replace(/\.com$/, '');
  if (SITES[key]) return 'https://' + SITES[key];
  return /\.[a-z]{2,}/i.test(site) ? 'https://' + site : 'https://www.' + site + '.com';
};
const siteKey = (value: string): string | null => {
  const key = value.toLowerCase().replace(/\s+/g, '').replace(/\.com$/, '');
  return SEARCH[key] ? key : null;
};
const ORD: Record<string, number> = {
  first: 1, '1st': 1, second: 2, '2nd': 2, third: 3, '3rd': 3, fourth: 4, '4th': 4,
  fifth: 5, '5th': 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, last: -1,
};

export function parseCmd(text: string): ParsedCommand | null {
  const s = text.replace(/^(hey |ok |okay )?jarvis[, ]*/i, '').replace(/^(please|can you|could you|kindly)\s+/i, '').replace(/[.!?]+$/, '').trim();
  let m: RegExpMatchArray | null;
  if (!s || /^(wake up|wake|activate|initialize|initialise|boot up|hello|hi|hey|are you there|you there)(\s+jarvis)?$/i.test(s)) return { t: 'wake' };
  if ((m = s.match(/^(?:remember |teach |learn )?(?:jarvis )?(?:that )?when i say\s+["“']?(.+?)["”']?[,:]?\s+(?:then\s+|you\s+)?(?:please\s+)?((?:open|go|click|search|play|scroll|type|run|do|switch|close|new|zoom|read|summari[sz]e|find)\b.+)$/i))) return { t: 'teach', phrase: m[1], action: m[2] };
  if ((m = s.match(/^(?:teach|learn)(?: jarvis)?(?: that)?[:,]?\s*["“']?(.+?)["”']?\s+(?:means|mean|equals|is)\s+(.+)$/i))) return { t: 'teach', phrase: m[1], action: m[2] };
  if ((m = s.match(/^when you hear\s+["“']?(.+?)["”']?\s+(?:i mean|it means|means|understand|write)\s+["“']?(.+?)["”']?$/i))) return { t: 'alias', from: m[1], to: m[2] };
  if (/^(?:forget everything|reset (?:your )?(?:memory|training)|clear (?:your )?(?:memory|training))$/i.test(s)) return { t: 'forget', q: '*' };
  if ((m = s.match(/^forget\s+(?:about\s+|that\s+|the shortcut\s+|shortcut\s+)?(.+)$/i))) return { t: 'forget', q: m[1] };
  if (/^(?:what have you learned|what do you know(?: about me)?|show (?:my )?(?:skills|shortcuts|training|memory)|list (?:my )?(?:skills|shortcuts))$/i.test(s)) return { t: 'listskills' };
  if ((m = s.match(/^remember\s+(?:that\s+)?(.+)$/i))) return { t: 'fact', text: m[1] };
  if (/^(?:good job|well done|great job|that(?:'?s| is| was)? (?:right|correct|perfect|good)|nice work|perfect)$/i.test(s)) return { t: 'good' };
  if (/^(?:that(?:'?s| is| was)? (?:wrong|not right|incorrect|bad)|wrong|bad job|no,? (?:not that|that'?s wrong)|you (?:got it|did it) wrong)$/i.test(s)) return { t: 'bad' };
  if (/^(stop|cancel|abort|never mind)$/i.test(s)) return { t: 'stop' };
  if (/^(?:pause|suspend|freeze)\s+(?:the\s+)?(?:virtual reality|vr)(?:\s+mode)?$/i.test(s)) return { t: 'vr', op: 'pause' };
  if (/^(?:resume|continue)\s+(?:the\s+)?(?:virtual reality|vr)(?:\s+mode)?$/i.test(s)) return { t: 'vr', op: 'resume' };
  if (/^(?:virtual reality|vr(?:\s+mode)?|(?:start|enable|activate|turn on)\s+(?:virtual reality|vr)(?:\s+mode)?)$/i.test(s)) return { t: 'vr', op: 'start' };
  if (/^(?:stop|disable|turn off|close)\s+(?:virtual reality|vr)(?:\s+mode)?$/i.test(s)) return { t: 'vr', op: 'stop' };
  if ((m = s.match(/^(click|tap|open|follow|go(?:\s+to)?)(?:\s+on)?\s+(?:that|this|there|it|the one|the link)(?:\s+(?:link|button|one))?(\s+in\s+(?:a\s+)?new\s+tab)?$/i))) {
    return { t: 'reference', op: m[2] ? 'newtab' : /^(?:click|tap)$/i.test(m[1]) ? 'click' : 'open' };
  }
  if ((m = s.match(/^(?:click|tap|press)(?:\s+(?:on|in|at))?\s+(?:the\s+)?(left|right|center|middle|top|bottom|upper|lower)(?:\s+(left|right|center|middle|top|bottom|upper|lower))?(?:\s+(?:side|half|area|edge|corner|of\s+(?:the\s+)?(?:screen|page)))?$/i))) {
    const directions = [m[1].toLowerCase(), m[2]?.toLowerCase()].filter(Boolean);
    const xDirection = directions.find((direction) => ['left', 'right'].includes(direction));
    const yDirection = directions.find((direction) => ['top', 'upper', 'bottom', 'lower'].includes(direction));
    return {
      t: 'region',
      x: xDirection === 'left' ? 'left' : xDirection === 'right' ? 'right' : 'center',
      y: yDirection === 'top' || yDirection === 'upper' ? 'top' : yDirection === 'bottom' || yDirection === 'lower' ? 'bottom' : 'center',
    };
  }
  if ((m = s.match(/^(?:open|go to|visit)\s+(.+?)\s+in\s+(?:a\s+)?new\s+tab$/i))) return { t: 'tabs', op: 'new', url: toUrl(m[1]) };
  if ((m = s.match(/^(youtube|google|amazon|github|wikipedia)\s+(?:search|find)\s+(?:for\s+)?(.+)$/i))) return { t: 'nav', url: SEARCH[m[1].toLowerCase()] + encodeURIComponent(m[2]) };
  if ((m = s.match(/^(?:switch to\s+)?tab\s+(?:number\s+)?(\d+)$/i))) return { t: 'tabs', op: 'switch', q: m[1] };
  if (/^(?:duplicate|clone)\s+(?:this\s+)?tab$/i.test(s)) return { t: 'tabs', op: 'dup' };
  if (/^(?:unpin|pin)\s+(?:this\s+)?tab$/i.test(s)) return { t: 'tabs', op: 'pin' };
  if (/^(?:mute|unmute)\s+(?:this\s+)?tab$/i.test(s)) return { t: 'tabs', op: 'mute' };
  if (/^close\s+(?:all\s+)?other\s+tabs$/i.test(s)) return { t: 'tabs', op: 'others' };
  if (/^(?:open\s+)?(?:a\s+)?new\s+window$/i.test(s)) return { t: 'tabs', op: 'window' };
  if (/^(?:reopen|restore|undo close)(?:\s+(?:the\s+)?(?:last|closed))?\s*tab$/i.test(s)) return { t: 'tabs', op: 'reopen' };
  if ((m = s.match(/^(?:find|search for|look for)\s+(.+?)\s+(?:on|in)\s+(?:this\s+)?page$/i))) return { t: 'find', q: m[1] };
  if ((m = s.match(/^scroll\s+to\s+(?!(?:the\s+)?(?:top|bottom)$)(.+)$/i))) return { t: 'find', q: m[1] };
  if (/^pause(?:\s+(?:the\s+)?(?:video|music|song|it))?$|^stop\s+(?:the\s+)?(?:video|music|song)$/i.test(s)) return { t: 'media', op: 'pause' };
  if (/^(?:play|resume)(?:\s+(?:the\s+)?(?:video|music|song|it))?$/i.test(s)) return { t: 'media', op: 'play' };
  if (/^(?:go\s+)?forward$/i.test(s)) return { t: 'hist', op: 'forward' };
  if (/^(?:mute|silence)(?:\s+(?:the\s+)?(?:video|sound|audio|volume|it))?$/i.test(s)) return { t: 'media', op: 'mute' };
  if (/^unmute(?:\s+(?:the\s+)?(?:video|sound|audio|volume|it))?$/i.test(s)) return { t: 'media', op: 'unmute' };
  if (/^(?:volume\s+up|louder|(?:increase|raise|turn up)\s+(?:the\s+)?volume)$/i.test(s)) return { t: 'media', op: 'volup' };
  if (/^(?:volume\s+down|quieter|(?:decrease|lower|turn down)\s+(?:the\s+)?volume)$/i.test(s)) return { t: 'media', op: 'voldown' };
  if ((m = s.match(/^(?:set\s+)?volume\s+(?:to\s+)?(\d{1,3})(?:\s*percent|%)?$/i))) return { t: 'media', op: 'volset', n: Math.min(100, +m[1]) };
  if (/^(?:go\s+)?fullscreen(?:\s+(?:the\s+)?video)?$|^exit\s+fullscreen$/i.test(s)) return { t: 'media', op: 'fs' };
  if ((m = s.match(/^(?:skip|forward|fast forward|go forward)(?:\s+ahead)?(?:\s+(\d+))?\s*(?:seconds?|secs?)?$/i))) return { t: 'media', op: 'skip', n: +(m[1] || 10) };
  if ((m = s.match(/^(?:rewind|go back|back|replay)\s+(\d+)\s*(?:seconds?|secs?)$/i))) return { t: 'media', op: 'skip', n: -m[1] };
  if (/^(?:speed up|faster|increase speed)$/i.test(s)) return { t: 'media', op: 'faster' };
  if (/^(?:slow down|slower|decrease speed)$/i.test(s)) return { t: 'media', op: 'slower' };
  if (/^normal speed$/i.test(s)) return { t: 'media', op: 'normal' };
  if (/^next\s+(?:video|song|track)$/i.test(s)) return { t: 'media', op: 'next' };
  if (/^zoom\s+in$/i.test(s)) return { t: 'page', op: 'zin' };
  if (/^zoom\s+out$/i.test(s)) return { t: 'page', op: 'zout' };
  if (/^(?:reset|normal|default)\s+zoom$/i.test(s)) return { t: 'page', op: 'zreset' };
  if (/^(?:dark mode|night mode|invert(?: colors?)?)(?:\s+(?:on|off))?$/i.test(s)) return { t: 'page', op: 'dark' };
  if (/^(?:read(?:\s+(?:this|the)\s+(?:page|article|text))?|read\s+(?:it\s+)?(?:aloud|out loud))$/i.test(s)) return { t: 'page', op: 'read' };
  if (/^copy\s+(?:the\s+|this\s+)?(?:link|url|address|page link)$/i.test(s)) return { t: 'page', op: 'copylink' };
  if (/^copy\s+(?:the\s+|this\s+)?(?:selection|selected text|text)$/i.test(s)) return { t: 'page', op: 'copysel' };
  if (/^select all$/i.test(s)) return { t: 'page', op: 'selall' };
  if (/^print(?:\s+(?:this\s+)?page)?$/i.test(s)) return { t: 'page', op: 'print' };
  if (/^(?:what(?:'s| is)?\s+(?:the\s+)?time(?:\s+now)?|what\s+time\s+is\s+it|time)$/i.test(s)) return { t: 'info', op: 'time' };
  if (/^what(?:'s| is)?\s+(?:the\s+)?(?:date|day)(?:\s+today)?$/i.test(s)) return { t: 'info', op: 'date' };
  if (/^(?:help|what can you do|commands|show commands)$/i.test(s)) return { t: 'info', op: 'help' };
  if (/^(?:summari[sz]e|tl;?dr)(?:\s+(?:this|the)(?:\s+(?:page|article))?)?$|^what(?:'s| is)\s+this\s+page(?:\s+about)?$/i.test(s)) return { t: 'agent', goal: 'Summarize this page in three short sentences, then use done with the summary in say.' };
  if ((m = s.match(/^(?:calculate|compute|what(?:'s| is)|how much is)\s+(.+)$/i))) {
    const e = m[1].replace(/\bplus\b/gi, '+').replace(/\bminus\b/gi, '-').replace(/\b(?:times|multiplied by|into|x)\b/gi, '*').replace(/\b(?:divided by|over)\b/gi, '/').replace(/\bpercent\b|%/gi, '/100').replace(/,/g, '');
    if (/^[\d\s.+\-*/()]+$/.test(e) && /\d/.test(e) && /[+\-*/]/.test(e)) return { t: 'math', e };
  }
  if (/^(press\s+)?(enter|return)$/i.test(s)) return { t: 'enter' };
  if ((m = s.match(/^(?:go to|open|visit|navigate to|take me to)\s+(.+?)\s+and\s+(?:search|find|look up)\s+(?:for\s+)?(.+)$/i))) {
    const key = siteKey(m[1]);
    return key
      ? { t: 'nav', url: SEARCH[key] + encodeURIComponent(m[2]) }
      : { t: 'nav', url: SEARCH.google + encodeURIComponent('site:' + toUrl(m[1]).replace(/^https?:\/\/(www\.)?/, '') + ' ' + m[2]) };
  }
  if ((m = s.match(/^(?:search|find|look up|google)\s+(?:for\s+)?(.+?)\s+(?:on|in)\s+(youtube|google|amazon|github|wikipedia)$/i))) return { t: 'nav', url: SEARCH[m[2].toLowerCase()] + encodeURIComponent(m[1]) };
  if ((m = s.match(/^(?:search|look up|google)\s+(?:for\s+)?(.+)$/i))) return { t: 'nav', url: SEARCH.google + encodeURIComponent(m[1]) };
  if (/^(?:open|new)\s+(?:a\s+)?new\s+tab$|^new tab$/i.test(s)) return { t: 'tabs', op: 'new' };
  if ((m = s.match(/^open\s+(?:a\s+)?new\s+tab\s+(?:with|and (?:go to|open))\s+(.+)$/i))) return { t: 'tabs', op: 'new', url: toUrl(m[1]) };
  if ((m = s.match(/^(?:go to|open|visit|navigate to|take me to)\s+(.+)$/i))) return { t: 'nav', url: toUrl(m[1]) };
  if (/^(?:next|right)\s+tab$|^(?:switch|go)\s+to\s+(?:the\s+)?next\s+tab$/i.test(s)) return { t: 'tabs', op: 'next' };
  if (/^(?:previous|prev|last|left)\s+tab$|^(?:switch|go)\s+to\s+(?:the\s+)?(?:previous|last)\s+tab$/i.test(s)) return { t: 'tabs', op: 'prev' };
  if ((m = s.match(/^(?:switch|go|jump|move)\s+to\s+(?:the\s+)?(?:tab\s+(?:number\s+)?)?(.+?)(?:\s+tab)?$/i))) return { t: 'tabs', op: 'switch', q: m[1] };
  if (/^close\s+(?:this\s+)?tab$/i.test(s)) return { t: 'tabs', op: 'close' };
  if (/^(?:list|show)\s+(?:my\s+)?tabs$/i.test(s)) return { t: 'tabs', op: 'list' };
  if (/^(?:go\s+)?back$/i.test(s)) return { t: 'hist', op: 'back' };
  if (/^(?:reload|refresh)(?:\s+(?:the\s+)?page)?$/i.test(s)) return { t: 'hist', op: 'reload' };
  if ((m = s.match(/^(?:scroll|go|move)\s*(down|up|to the top|to the bottom|to top|to bottom|top|bottom)?$/i)) && (m[1] || /^scroll/i.test(s))) {
    const d = (m[1] || 'down').toLowerCase();
    return { t: 'scroll', d: /top/.test(d) ? 'top' : /bottom/.test(d) ? 'bottom' : d };
  }
  if ((m = s.match(/^(?:click|tap|play|open|select|choose|press)(?:\s+on)?\s+(?:the\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|\d+(?:st|nd|rd|th))\s+(video|result|link|item|one|short|song|post)s?$/i))) {
    const key = m[1].toLowerCase();
    return { t: 'nth', n: ORD[key] || Number.parseInt(key, 10), kind: m[2].toLowerCase() };
  }
  if ((m = s.match(/^(?:click|tap|hit|select|choose|open|play|press)(?:\s+on)?\s+(.+)$/i))) return { t: 'click', q: m[1] };
  if (/^(?:type|write|enter|fill(?: in)?)\s+/i.test(s)) {
    const submit = /\s+and\s+(?:press\s+)?(?:enter|search|submit)$/i.test(s);
    const body = s.replace(/\s+and\s+(?:press\s+)?(?:enter|search|submit)$/i, '');
    if ((m = body.match(/^(?:type|write|enter|fill(?: in)?)\s+(.+?)(?:\s+(?:in|into|on)\s+(?:the\s+)?(.+?))?$/i))) return { t: 'type', text: m[1], q: m[2], submit };
  }
  return null;
}

const HEARD: Array<[RegExp, string]> = [
  [/\bclique\b|\bklick\b|\bclic\b/gi, 'click'],
  [/\bscroll (?:don|dawn)\b/gi, 'scroll down'],
  [/\b(next|new|this|previous|close) tap\b/gi, '$1 tab'],
  [/\bgo too\b|\bgo 2\b/gi, 'go to'],
  [/\byou tube\b/gi, 'youtube'],
  [/\bface book\b/gi, 'facebook'],
  [/\bwhat'?s ?app\b/gi, 'whatsapp'],
  [/\bg ?mail\b/gi, 'gmail'],
  [/\binsta gram\b/gi, 'instagram'],
  [/\bfull screen\b/gi, 'fullscreen'],
  [/\b(?:neeche|niche)\s+scroll(?:\s+kar(?:o|do))?\b|\bscroll\s+(?:neeche|niche)(?:\s+kar(?:o|do))?\b/gi, 'scroll down'],
  [/\b(?:upar|oopar)\s+scroll(?:\s+kar(?:o|do))?\b|\bscroll\s+(?:upar|oopar)(?:\s+kar(?:o|do))?\b/gi, 'scroll up'],
  [/^(.+?)\s+(?:pe|par|ko)\s+click\s+kar(?:o|do)$/i, 'click $1'],
  [/^click\s+kar(?:o|do)\s+(.+)$/i, 'click $1'],
  [/^(.+?)\s+click\s+kar(?:o|do)$/i, 'click $1'],
  [/^(.+?)\s+(?:kholo|khol do|khol|open karo)$/i, 'open $1'],
  [/^(.+?)\s+search\s+kar(?:o|do)$/i, 'search $1'],
  [/^search\s+kar(?:o|do)\s+(.+)$/i, 'search $1'],
  [/\b(?:wapas|peeche|pichhe)\s+jao\b/gi, 'back'],
  [/\bagla\s+tab\b/gi, 'next tab'],
  [/\bpichla\s+tab\b/gi, 'previous tab'],
  [/\bnaya\s+tab\b/gi, 'new tab'],
  [/\btab\s+band\s+kar(?:o|do)\b/gi, 'close this tab'],
  [/\b(?:video\s+)?(?:roko|rok do)\b|\bpause\s+kar(?:o|do)\b/gi, 'pause'],
  [/\bchalao|chala do|play\s+kar(?:o|do)\b/gi, 'play'],
  [/\bawaaz\s+(?:badhao|zyada)\b/gi, 'volume up'],
  [/\bawaaz\s+kam(?:\s+kar(?:o|do))?\b/gi, 'volume down'],
  [/\bpehla\b|\bpehle\b/gi, 'first'],
  [/\bdusra\b/gi, 'second'],
  [/\bteesra\b/gi, 'third'],
  [/\bchautha\b/gi, 'fourth'],
  [/\baakhri\b/gi, 'last'],
];

export function normalizeSpokenText(input: string, aliases: Record<string, string> = {}): string {
  let text = String(input).trim();
  for (const [pattern, replacement] of HEARD) text = text.replace(pattern, replacement);
  for (const [from, to] of Object.entries(aliases)) {
    const escapedFrom = [...from].map((character) => '.^$*+?()[]{}|\\'.includes(character) ? '\\' + character : character).join('');
    text = text.replace(new RegExp('\\b' + escapedFrom + '\\b', 'gi'), to);
  }
  return text;
}

export const toks = (value: string): string[] => String(value).toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);

export function near(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a))) return true;
  if (a.length >= 5 && b.length >= 5 && Math.abs(a.length - b.length) <= 1) {
    let i = 0, j = 0, distance = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++distance > 1) return false;
      if (a.length > b.length) i++;
      else if (a.length < b.length) j++;
      else { i++; j++; }
    }
    return distance + (a.length - i) + (b.length - j) <= 1;
  }
  return false;
}

export function scoreLabel(label: string, query: string): number {
  const labelTokens = toks(label), queryTokens = toks(query);
  if (!queryTokens.length || !labelTokens.length) return 0;
  let hit = 0;
  for (const token of queryTokens) if (labelTokens.some((word) => near(word, token))) hit++;
  let score = hit / queryTokens.length;
  if (String(label).toLowerCase().includes(String(query).toLowerCase())) score += 0.5;
  return score;
}

const VERBS = 'click|tap|press|play|pause|mute|unmute|scroll|type|write|open|go to|go back|search|select|choose|back|reload|refresh|next tab|previous tab|close tab|switch to|new tab|zoom|volume|fullscreen|skip|rewind|read|copy|find|print|summarize|duplicate|pin';

export function splitCmds(input: string): string[] {
  const s = String(input).trim().replace(/^(?:hey |ok |okay )?jarvis[, ]+/i, '');
  const routeSearchChain = s.match(new RegExp('^((?:go to|open|visit)\\s+.+?\\s+and\\s+(?:search|find|look up)\\s+.+?)\\s+(?:and then|then|and|after that)\\s+(?=(?:' + VERBS + ')\\b)(.+)$', 'i'));
  if (routeSearchChain) return [routeSearchChain[1], ...splitCmds(routeSearchChain[2])];
  if (/^(?:go to|open|visit)\s+.+?\s+and\s+(?:search|find|look up)\s/i.test(s)) return [s];
  if (/^(?:youtube|google|amazon|github|wikipedia)\s+(?:search|find)\s/i.test(s) || /^(?:(?:remember|teach|learn)\s+)?(?:jarvis\s+)?(?:that\s+)?when i say\b|^(?:teach|learn)\b|^when you hear\b/i.test(s)) return [s];
  const raw = s.split(new RegExp('(?<!\\b(?:the|a|an|in|to|on|of|my|this|into|at|for)\\b)\\s+(?:and\\s+then\\s+|then\\s+|and\\s+|after that\\s+|also\\s+)?(?=(?:' + VERBS + ')\\b)', 'i')).map((part) => part.trim()).filter(Boolean);
  const parts: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    let current = raw[i];
    while (i + 1 < raw.length && !parseCmd(current)) { current += ' ' + raw[i + 1]; i++; }
    parts.push(current);
  }
  return parts.length ? parts : [s];
}
