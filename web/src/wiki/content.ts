import { Marked, type Tokens } from 'marked';

// The guide lives in docs/guide at the repository root and is bundled at build time.
const sources = import.meta.glob<string>('../../../docs/guide/*.md', { query: '?raw', import: 'default', eager: true });
const images = import.meta.glob<string>('../../../docs/guide/img/*.png', { query: '?url', import: 'default', eager: true });

export const HOME = 'README';

export type Article = {
  slug: string;
  /** The page's own `# Title`. */
  title: string;
  /** Shorter label for the sidebar and the pager. */
  navTitle: string;
  html: string;
  /** Plain text of the body, for search. */
  text: string;
};

export type Section = { id: string; title: string; slugs: string[] };

const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const imageUrls = new Map(Object.entries(images).map(([path, url]) => [fileName(path), url]));

/** Wiki route for a guide page (README is the wiki home). */
export function articlePath(slug: string, hash = '') {
  return (slug === HOME ? '/ayuda' : `/ayuda/${slug}`) + hash;
}

/** GitHub's heading anchors: lower case, punctuation dropped, spaces to hyphens. */
export function slugify(text: string) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-');
}

const decodeEntities = (html: string) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

/** `movimientos.md#filtros` → `/ayuda/movimientos#filtros`; other links are left alone. */
function rewriteHref(href: string, slug: string) {
  if (href.startsWith('#')) return articlePath(slug, href);
  const m = /^(?:\.\/)?([\w-]+)\.md(#.*)?$/.exec(href);
  if (m) return articlePath(m[1], m[2] ?? '');
  return href;
}

function render(markdown: string, slug: string) {
  const used = new Map<string, number>();
  const marked = new Marked({
    gfm: true,
    walkTokens(token) {
      if (token.type === 'link') token.href = rewriteHref(token.href, slug);
      if (token.type === 'image') {
        const m = /^(?:\.\/)?img\/([^/]+)$/.exec(token.href);
        if (m && imageUrls.has(m[1])) token.href = imageUrls.get(m[1])!;
      }
    },
    renderer: {
      heading({ tokens, depth }: Tokens.Heading) {
        const inner = this.parser.parseInline(tokens);
        const base = slugify(decodeEntities(inner));
        const n = used.get(base) ?? 0;
        used.set(base, n + 1);
        const id = n ? `${base}-${n}` : base;
        return `<h${depth} id="${id}">${inner}</h${depth}>\n`;
      },
      link({ href, title, tokens }: Tokens.Link) {
        const inner = this.parser.parseInline(tokens);
        const external = /^https?:\/\//.test(href);
        const t = title ? ` title="${title.replace(/"/g, '&quot;')}"` : '';
        return `<a href="${href}"${t}${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${inner}</a>`;
      },
      image({ href, title, text }: Tokens.Image) {
        const t = title ? ` title="${title.replace(/"/g, '&quot;')}"` : '';
        return `<img src="${href}" alt="${text.replace(/"/g, '&quot;')}"${t} loading="lazy" decoding="async">`;
      },
    },
  });
  const html = marked.parse(markdown, { async: false }) as string;
  // Wide tables scroll inside their own box instead of widening the page.
  return html.replace(/<table>/g, '<div class="wiki-table"><table>').replace(/<\/table>/g, '</table></div>');
}

function plainText(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```\w*/g, ' '))
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*\|?\s*-{3,}.*$/gm, ' ')
    .replace(/^#+\s*/gm, '')
    .replace(/^\s*[-+]\s+/gm, '')
    .replace(/[*`]/g, '')
    .replace(/[|>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function load(): Map<string, Article> {
  const map = new Map<string, Article>();
  for (const [path, raw] of Object.entries(sources)) {
    const slug = fileName(path).replace(/\.md$/, '');
    const m = /^#\s+(.+)\s*$/m.exec(raw);
    const title = m ? m[1].trim() : slug;
    const body = m ? raw.replace(m[0], '') : raw;
    const navTitle = slug === HOME ? 'User guide' : title;
    map.set(slug, { slug, title, navTitle, html: render(body, slug), text: plainText(body) });
  }
  return map;
}

export const articles = load();

/**
 * Sidebar groups follow the index table in README.md: a bold-only row starts a group,
 * an empty row starts the untitled one. The top bar page opens the list and the
 * calculations page closes it.
 */
function buildSections(): Section[] {
  const FIRST = 'barra-superior';
  const LAST = 'como-se-calcula';
  const readmePath = Object.keys(sources).find((p) => p.endsWith(`/${HOME}.md`));
  const raw = readmePath ? sources[readmePath] : '';
  const groups: Section[] = [];
  let current: Section | null = null;
  for (const line of raw.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    const first = cells[0] ?? '';
    if (/^-+$/.test(first) || first === 'Section') continue;
    const bold = /^\*\*([^*]+)\*\*$/.exec(first);
    const link = /\]\(([\w-]+)\.md\)/.exec(first);
    if (bold && !cells.slice(1).some(Boolean)) {
      current = { id: slugify(bold[1]), title: bold[1], slugs: [] };
      groups.push(current);
    } else if (!first && !cells.slice(1).some(Boolean)) {
      current = { id: 'settings', title: 'Settings', slugs: [] };
      groups.push(current);
    } else if (link && articles.has(link[1]) && current && link[1] !== FIRST && link[1] !== LAST) {
      if (!current.slugs.includes(link[1])) current.slugs.push(link[1]);
    }
  }
  const sections = [{ id: 'getting-started', title: 'Getting started', slugs: articles.has(FIRST) ? [FIRST] : [] }, ...groups];
  const placed = new Set([HOME, LAST, ...sections.flatMap((s) => s.slugs)]);
  const rest = [...articles.keys()].filter((s) => !placed.has(s)).sort();
  if (rest.length) {
    let other = sections.find((s) => s.id === 'settings');
    if (!other) sections.push((other = { id: 'settings', title: 'Settings', slugs: [] }));
    other.slugs.push(...rest);
  }
  if (articles.has(LAST)) sections.push({ id: 'reference', title: 'Reference', slugs: [LAST] });
  return sections.filter((s) => s.slugs.length);
}

export const sections = buildSections();

/** Reading order for previous / next: the home page, then the sidebar from top to bottom. */
export const order = [HOME, ...sections.flatMap((s) => s.slugs)].filter((s) => articles.has(s));

export function sectionOf(slug: string) {
  return sections.find((s) => s.slugs.includes(slug));
}

/* ---------- search ---------- */

/** Lower case without accents, keeping one character per character so positions line up. */
function fold(text: string) {
  let out = '';
  for (const ch of text) {
    const f = ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    out += f.length === ch.length ? f : ch.toLowerCase().length === ch.length ? ch.toLowerCase() : ch;
  }
  return out;
}

const folded = new Map([...articles.values()].map((a) => [a.slug, { title: fold(a.navTitle + ' ' + a.title), text: fold(a.text) }]));

export type Piece = { text: string; hit: boolean };
export type SearchResult = { slug: string; title: string; section?: string; snippet: Piece[] };

function highlight(text: string, terms: string[]): Piece[] {
  const f = fold(text);
  const marks = new Array<boolean>(text.length).fill(false);
  for (const t of terms) {
    for (let i = f.indexOf(t); i !== -1; i = f.indexOf(t, i + t.length)) marks.fill(true, i, i + t.length);
  }
  const pieces: Piece[] = [];
  for (let i = 0; i < text.length; i++) {
    const last = pieces[pieces.length - 1];
    if (last && last.hit === marks[i]) last.text += text[i];
    else pieces.push({ text: text[i], hit: marks[i] });
  }
  return pieces;
}

function snippet(text: string, at: number, terms: string[]): Piece[] {
  if (at < 0) return highlight(text.slice(0, 150) + (text.length > 150 ? '…' : ''), terms);
  let start = Math.max(0, at - 60);
  if (start > 0) {
    const space = text.indexOf(' ', start);
    if (space !== -1 && space < at) start = space + 1;
  }
  let end = Math.min(text.length, start + 170);
  const space = text.lastIndexOf(' ', end);
  if (end < text.length && space > at) end = space;
  return highlight((start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : ''), terms);
}

export function search(query: string, limit = 8): SearchResult[] {
  const q = fold(query.trim());
  const terms = q.split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const scored: { a: Article; score: number; at: number }[] = [];
  for (const a of articles.values()) {
    const f = folded.get(a.slug)!;
    if (!terms.every((t) => f.title.includes(t) || f.text.includes(t))) continue;
    let score = 0;
    if (f.title.includes(q)) score += 100;
    for (const t of terms) {
      if (f.title.includes(t)) score += 20;
      let n = 0;
      for (let i = f.text.indexOf(t); i !== -1 && n < 20; i = f.text.indexOf(t, i + t.length)) n++;
      score += n;
    }
    const phrase = f.text.indexOf(q);
    const at = phrase !== -1 ? phrase : Math.min(...terms.map((t) => f.text.indexOf(t)).filter((i) => i !== -1));
    scored.push({ a, score, at: Number.isFinite(at) ? at : -1 });
  }
  return scored
    .sort((x, y) => y.score - x.score || order.indexOf(x.a.slug) - order.indexOf(y.a.slug))
    .slice(0, limit)
    .map(({ a, at }) => ({ slug: a.slug, title: a.navTitle, section: sectionOf(a.slug)?.title, snippet: snippet(a.text, at, terms) }));
}
