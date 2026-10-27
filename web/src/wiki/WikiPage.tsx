import { useEffect, useId, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { IconArrowLeft, IconChevronLeft, IconChevronRight, IconFileText, IconMenu2, IconMoon, IconSearch, IconSun, IconX } from '@tabler/icons-react';
import { HOME, articlePath, articles, order, search, sectionOf, sections, type SearchResult } from './content';
import './wiki.css';

type Theme = 'dark' | 'light';
const THEME_KEY = 'pfd-wiki-theme';

function readTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

/** Help wiki: the guide in docs/guide, with its own frame outside the app's. */
export function WikiPage() {
  const params = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const slug = (params['*'] ?? '').replace(/\/+$/, '') || HOME;
  const article = articles.get(slug);
  const section = sectionOf(slug);

  const [theme, setTheme] = useState<Theme>(readTheme);
  const [menuOpen, setMenuOpen] = useState(false);
  const articleRef = useRef<HTMLElement>(null);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* private mode: the choice lasts for this visit only */
    }
  };

  // The page behind the wiki (overscroll, scrollbars) follows the wiki's theme while it's open.
  useEffect(() => {
    const html = document.documentElement;
    const prev = { bg: document.body.style.background, scheme: html.style.colorScheme };
    document.body.style.background = theme === 'dark' ? '#000' : '#fff';
    html.style.colorScheme = theme;
    return () => {
      document.body.style.background = prev.bg;
      html.style.colorScheme = prev.scheme;
    };
  }, [theme]);

  useEffect(() => {
    const prev = document.title;
    document.title = article && slug !== HOME ? `${article.navTitle} · Ayuda · Finanzas` : 'Ayuda · Finanzas';
    return () => {
      document.title = prev;
    };
  }, [article, slug]);

  useEffect(() => setMenuOpen(false), [location.key]);

  // Go to the #anchor (or the top) on every navigation. Screenshots above the anchor load
  // lazily and push it down, so keep it in place until the reader scrolls by themselves.
  useEffect(() => {
    const id = decodeURIComponent(location.hash.slice(1));
    const target = id ? document.getElementById(id) : null;
    if (!target) {
      window.scrollTo(0, 0);
      return;
    }
    target.scrollIntoView();
    let follow = true;
    const stop = () => (follow = false);
    const again = () => follow && target.scrollIntoView();
    const imgs = [...(articleRef.current?.querySelectorAll('img') ?? [])].filter((img) => !img.complete);
    imgs.forEach((img) => img.addEventListener('load', again));
    window.addEventListener('wheel', stop, { passive: true });
    window.addEventListener('touchmove', stop, { passive: true });
    window.addEventListener('keydown', stop);
    const timer = window.setTimeout(stop, 4000);
    return () => {
      imgs.forEach((img) => img.removeEventListener('load', again));
      window.removeEventListener('wheel', stop);
      window.removeEventListener('touchmove', stop);
      window.removeEventListener('keydown', stop);
      window.clearTimeout(timer);
    };
  }, [location.key, location.hash, slug]);

  // Links between guide pages stay inside the app (no full reload).
  const onArticleClick = (e: ReactMouseEvent<HTMLElement>) => {
    const a = (e.target as HTMLElement).closest('a');
    const href = a?.getAttribute('href');
    if (!a || !href || a.target === '_blank') return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (href === '/ayuda' || href.startsWith('/ayuda/') || href.startsWith('/ayuda#')) {
      e.preventDefault();
      navigate(href);
    }
  };

  const index = order.indexOf(slug);
  const prev = index > 0 ? articles.get(order[index - 1]) : undefined;
  const next = index >= 0 && index < order.length - 1 ? articles.get(order[index + 1]) : undefined;

  return (
    <div className="wiki" data-theme={theme}>
      <header className="wiki-bar">
        <div className="wiki-bar-inner">
          <div className="wiki-bar-brand">
            <button
              type="button"
              className="wiki-icon-btn wiki-menu-btn"
              aria-label={menuOpen ? 'Cerrar índice' : 'Abrir índice'}
              aria-expanded={menuOpen}
              aria-controls="wiki-sidenav"
              onClick={() => setMenuOpen((o) => !o)}
            >
              {menuOpen ? <IconX size={20} stroke={1.75} /> : <IconMenu2 size={20} stroke={1.75} />}
            </button>
            <Link to="/ayuda" className="wiki-brand">
              <span className="wiki-brand-name">Finanzas</span> <span className="wiki-brand-help">Ayuda</span>
            </Link>
          </div>
          <div className="wiki-bar-main">
            <nav className="wiki-crumbs" aria-label="Ubicación">
              <Link to="/ayuda">Ayuda</Link>
              {slug !== HOME && (
                <>
                  {section && (
                    <>
                      <span className="wiki-crumbs-sep">/</span>
                      <span>{section.title}</span>
                    </>
                  )}
                  <span className="wiki-crumbs-sep">/</span>
                  <span aria-current="page">{article?.navTitle ?? 'Página no encontrada'}</span>
                </>
              )}
            </nav>
            <div className="wiki-bar-tools">
              <WikiSearch />
              <button type="button" className="wiki-icon-btn" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Usar modo claro' : 'Usar modo oscuro'} title={theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}>
                {theme === 'dark' ? <IconSun size={19} stroke={1.75} /> : <IconMoon size={19} stroke={1.75} />}
              </button>
              <Link to="/" className="wiki-back" title="Volver a la app">
                <IconArrowLeft size={16} stroke={2} />
                <span>Volver a la app</span>
              </Link>
            </div>
          </div>
        </div>
      </header>

      <div className="wiki-frame">
        <WikiSidenav current={slug} open={menuOpen} />
        {menuOpen && <div className="wiki-scrim" onClick={() => setMenuOpen(false)} aria-hidden />}

        <main className="wiki-main">
          <div className="wiki-col">
            {article ? (
              <>
                <span className="wiki-eyebrow">{slug === HOME ? 'Ayuda' : (section?.title ?? 'Ayuda')}</span>
                <h1 className="wiki-title">{article.title}</h1>
                {/* Our own guide files, rendered at build time; nothing here comes from users. */}
                <article ref={articleRef} className="wiki-article" onClick={onArticleClick} dangerouslySetInnerHTML={{ __html: article.html }} />
                {(prev || next) && (
                  <nav className="wiki-pager" aria-label="Páginas de la guía">
                    {prev ? (
                      <Link to={articlePath(prev.slug)} className="wiki-pager-link wiki-pager-prev">
                        <span className="wiki-pager-label">
                          <IconChevronLeft size={14} stroke={2} /> Anterior
                        </span>
                        <span className="wiki-pager-title">{prev.navTitle}</span>
                      </Link>
                    ) : (
                      <span />
                    )}
                    {next && (
                      <Link to={articlePath(next.slug)} className="wiki-pager-link wiki-pager-next">
                        <span className="wiki-pager-label">
                          Siguiente <IconChevronRight size={14} stroke={2} />
                        </span>
                        <span className="wiki-pager-title">{next.navTitle}</span>
                      </Link>
                    )}
                  </nav>
                )}
              </>
            ) : (
              <>
                <span className="wiki-eyebrow">Ayuda</span>
                <h1 className="wiki-title">Página no encontrada</h1>
                <div className="wiki-article">
                  <p>
                    No hay ninguna página de ayuda en esta dirección. <Link to="/ayuda">Ir al índice de la guía</Link>.
                  </p>
                </div>
              </>
            )}
          </div>
          <footer className="wiki-footer">
            <span>Finanzas v{__APP_VERSION__}</span>
            <Link to="/">Volver a la app</Link>
          </footer>
        </main>
      </div>
    </div>
  );
}

function WikiSidenav({ current, open }: { current: string; open: boolean }) {
  const currentSection = sectionOf(current)?.id;
  // On the home page every group is open; on an article, its own group is.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(currentSection ? [currentSection] : sections.map((s) => s.id)));
  useEffect(() => {
    if (currentSection) setExpanded((e) => (e.has(currentSection) ? e : new Set(e).add(currentSection)));
  }, [currentSection]);
  const toggle = (id: string) =>
    setExpanded((e) => {
      const n = new Set(e);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const home = articles.get(HOME);

  return (
    <nav id="wiki-sidenav" className="wiki-sidenav" data-open={open || undefined} aria-label="Índice de la guía">
      <ul className="wiki-nav-list">
        {home && (
          <li>
            <Link to="/ayuda" className="wiki-nav-link" aria-current={current === HOME ? 'page' : undefined}>
              <IconFileText size={17} stroke={1.5} className="wiki-nav-icon" />
              <span>{home.navTitle}</span>
            </Link>
          </li>
        )}
        {sections.map((s) => {
          const isOpen = expanded.has(s.id);
          return (
            <li key={s.id} className="wiki-nav-group">
              <button type="button" className="wiki-nav-group-btn" aria-expanded={isOpen} aria-controls={`wiki-nav-${s.id}`} onClick={() => toggle(s.id)}>
                <IconChevronRight size={14} stroke={2.25} className="wiki-nav-chevron" />
                <span>{s.title}</span>
              </button>
              <ul id={`wiki-nav-${s.id}`} className="wiki-nav-children" hidden={!isOpen}>
                {s.slugs.map((slug) => (
                  <li key={slug}>
                    <Link to={articlePath(slug)} className="wiki-nav-link" aria-current={slug === current ? 'page' : undefined}>
                      <IconFileText size={17} stroke={1.5} className="wiki-nav-icon" />
                      <span>{articles.get(slug)?.navTitle}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
      <Link to="/" className="wiki-nav-back">
        <IconArrowLeft size={16} stroke={2} /> Volver a la app
      </Link>
    </nav>
  );
}

function WikiSearch() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const results = useMemo(() => search(q), [q]);
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

  useEffect(() => setActive(0), [q]);

  // ⌘K / Ctrl+K or "/" jumps to the search field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.closest?.('input, textarea, [contenteditable="true"]');
      if (((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') || (e.key === '/' && !typing)) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const go = (r: SearchResult) => {
    navigate(articlePath(r.slug));
    setQ('');
    setOpen(false);
    inputRef.current?.blur();
  };

  const showPanel = open && q.trim().length > 0;

  return (
    <div className="wiki-search" ref={boxRef}>
      <IconSearch size={15} stroke={2} className="wiki-search-icon" aria-hidden />
      <input
        ref={inputRef}
        type="search"
        className="wiki-search-input"
        placeholder="Buscar"
        aria-label="Buscar en la ayuda"
        role="combobox"
        aria-expanded={showPanel}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showPanel && results[active] ? `${listId}-${active}` : undefined}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, results.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === 'Enter' && results[active]) {
            e.preventDefault();
            go(results[active]);
          } else if (e.key === 'Escape') {
            if (q) setQ('');
            else inputRef.current?.blur();
            setOpen(false);
          }
        }}
      />
      {!q && (
        <kbd className="wiki-search-kbd" aria-hidden>
          {isMac ? '⌘K' : 'Ctrl K'}
        </kbd>
      )}
      {showPanel && (
        <div className="wiki-search-panel">
          {results.length ? (
            <ul id={listId} role="listbox" className="wiki-search-results" aria-label="Resultados">
              {results.map((r, i) => (
                <li
                  key={r.slug}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className="wiki-search-result"
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => go(r)}
                >
                  <span className="wiki-search-result-head">
                    <IconFileText size={15} stroke={1.5} className="wiki-search-result-icon" />
                    <span className="wiki-search-result-title">{r.title}</span>
                    {r.section && <span className="wiki-search-result-section">{r.section}</span>}
                  </span>
                  <span className="wiki-search-snippet">
                    {r.snippet.map((p, j) => (p.hit ? <mark key={j}>{p.text}</mark> : <span key={j}>{p.text}</span>))}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p id={listId} className="wiki-search-empty">
              Sin resultados para «{q.trim()}».
            </p>
          )}
        </div>
      )}
    </div>
  );
}
