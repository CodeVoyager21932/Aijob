/** Runs in both the preview document and isolated Chromium after fonts/images load.
 * No network, timers, global registry or application state. Rebuilds only derived page nodes.
 */
export function paginateResumeStudio(input: { root?: HTMLElement; keepEntriesTogether?: boolean; autoColumns?: boolean } = {}) {
  const doc = input.root?.ownerDocument ?? document;
  const root = (input.root ?? doc.body).querySelector<HTMLElement>('.rs-document');
  if (!root) return { pageCount: 0, overflow: false };
  const source = root.querySelector<HTMLElement>('.rs-source');
  if (!source) throw new Error('STUDIO_PAGE_SOURCE_MISSING');
  root.querySelectorAll(':scope > .rs-page').forEach((node) => node.remove());
  const sourceHeader = source.querySelector<HTMLElement>('.rs-header');
  const sections = Array.from(source.querySelectorAll<HTMLElement>(':scope > .rs-section'));
  const two = root.dataset.two === 'true', sidebarHeader = root.dataset.sidebarHeader === 'true', mainHeader = root.dataset.mainHeader === 'true';
  const sourceAsideIntro=source.querySelector<HTMLElement>(':scope > .rs-aside-intro');
  const assigned = sections.some((s) => s.dataset.column === 'aside');
  source.hidden = true;
  type Page = { page: HTMLElement; main: HTMLElement; aside: HTMLElement; full: HTMLElement; columns:HTMLElement; available:number };
  const pages: Page[] = [];
  function create(tag: string, className: string) { const node = doc.createElement(tag); node.className = className; return node; }
  function pageAt(index: number): Page {
    if (index > 150) throw new Error('STUDIO_PAGE_LIMIT');
    while (pages.length <= index) {
      const n = pages.length, page = create('div', 'rs-page'), inner = create('div', 'rs-page-inner'), columns = create('div', 'rs-columns'), main = create('div', 'rs-col rs-col--main'), aside = create('div', 'rs-col rs-col--aside'), full=create('div','rs-full-region');
      page.dataset.page = String(n + 1); page.append(inner); root!.append(page);
      let headerHeight = 0;
      if (n === 0 && sourceHeader && !sidebarHeader && !mainHeader) { const header = sourceHeader.cloneNode(true) as HTMLElement; inner.append(header); headerHeight = header.getBoundingClientRect().height + parseFloat(doc.defaultView!.getComputedStyle(header).marginBottom); }
      inner.append(full,columns); columns.append(main); if (two) columns.append(aside);
      const available = Math.floor(inner.getBoundingClientRect().height - headerHeight - .5);
      columns.style.height = `${available}px`; main.style.height = `${available}px`; aside.style.height = `${available}px`;
      if (n === 0 && sourceHeader && sidebarHeader) aside.append(sourceHeader.cloneNode(true));
      if (n === 0 && sourceHeader && mainHeader) main.append(sourceHeader.cloneNode(true));
      if (n === 0 && sourceAsideIntro && two) aside.append(sourceAsideIntro.cloneNode(true));
      const number = create('span', 'rs-page-number'); number.textContent = String(n + 1); page.append(number);
      pages.push({ page, main, aside, full,columns,available });
    }
    return pages[index]!;
  }
  pageAt(0);
  const fits = (column: HTMLElement) => column.scrollHeight <= column.clientHeight + 1;
  function emptySection(original: HTMLElement, continued: boolean) {
    const section = original.cloneNode(false) as HTMLElement;
    const heading = original.querySelector<HTMLElement>('.rs-section-heading')!.cloneNode(true) as HTMLElement;
    if (continued) { const mark = create('span', 'rs-continuation'); mark.textContent = '续'; heading.append(mark); }
    section.append(heading, create('div', 'rs-section-body')); return section;
  }
  function entryShell(original: HTMLElement, continued: boolean) {
    const entry = original.cloneNode(false) as HTMLElement;
    entry.append(original.querySelector('.rs-entry-head')!.cloneNode(true));
    entry.append(create('div', 'rs-entry-content'));
    if (continued) { const mark = create('span', 'rs-continuation'); mark.textContent = '续'; (entry.querySelector('.rs-entry-title') ?? entry.querySelector('.rs-entry-head'))!.append(mark); }
    return entry;
  }
  function units(body: HTMLElement): HTMLElement[] {
    return Array.from(body.children).flatMap((node) => {
      if (node.tagName !== 'OL' && node.tagName !== 'UL') return [node.cloneNode(true) as HTMLElement];
      return Array.from(node.children).map((li, index) => {
        const list = node.cloneNode(false) as HTMLElement;
        if (node.tagName === 'OL') list.setAttribute('start', String(Number(node.getAttribute('start') ?? 1) + index));
        list.append(li.cloneNode(true)); return list;
      });
    });
  }
  function slice(node: HTMLElement, start: number, end: number) {
    const walker = doc.createTreeWalker(node, 4), texts: Text[] = [];
    while (walker.nextNode()) texts.push(walker.currentNode as Text);
    const boundary = (position: number): [Node, number] => { let seen = 0; for (const text of texts) { if (position <= seen + text.length) return [text, position - seen]; seen += text.length; } return [node, node.childNodes.length]; };
    const range = doc.createRange(), a = boundary(start), b = boundary(end);
    range.setStart(a[0], a[1]); range.setEnd(b[0], b[1]);
    const copy = node.cloneNode(false) as HTMLElement; copy.append(range.cloneContents()); return copy;
  }
  function fill(columnName: 'main' | 'aside' | 'full', list: HTMLElement[], startPage=0) {
    let pageIndex = startPage, target = pageAt(startPage)[columnName];
    if(columnName==='full')target.style.height=`${pageAt(startPage).available}px`;
    const advance = () => { pageIndex++; target = pageAt(pageIndex)[columnName]; if(columnName==='full')target.style.height=`${pageAt(pageIndex).available}px`; };
    for (const originalSection of list) {
      const entries = Array.from(originalSection.querySelectorAll<HTMLElement>('.rs-section-body > .rs-entry'));
      if (originalSection.dataset.break === 'true' && target.querySelector('.rs-entry')) advance();
      let section = emptySection(originalSection, false), first = true;
      target.append(section);
      const sectionBody = () => section.querySelector<HTMLElement>('.rs-section-body')!;
      function nextSection(continued: boolean) {
        if (!sectionBody().children.length) section.remove();
        advance(); section = emptySection(originalSection, continued); target.append(section);
      }
      for (const originalEntry of entries) {
        if (originalEntry.dataset.break === 'true' && target.querySelector('.rs-entry')) nextSection(!first);
        const full = originalEntry.cloneNode(true) as HTMLElement; sectionBody().append(full);
        if (fits(target)) { first = false; continue; }
        const fullHeight = full.getBoundingClientRect().height;
        full.remove();
        const titleHeight = section.querySelector<HTMLElement>('.rs-section-heading')!.getBoundingClientRect().height + 18;
        if (input.keepEntriesTogether !== false && fullHeight + titleHeight < target.clientHeight * .96 && target.querySelector('.rs-entry')) {
          nextSection(!first); sectionBody().append(full);
          if (fits(target)) { first = false; continue; }
          full.remove();
        }
        let fragment = entryShell(originalEntry, false); sectionBody().append(fragment);
        let body = fragment.querySelector<HTMLElement>('.rs-entry-content')!, hasContent = false, entryContinued = false;
        function nextFragment() {
          if (!body.children.length) fragment.remove();
          nextSection(!first || entryContinued || hasContent);
          entryContinued = entryContinued || hasContent;
          fragment = entryShell(originalEntry, entryContinued); sectionBody().append(fragment);
          body = fragment.querySelector<HTMLElement>('.rs-entry-content')!;
        }
        for (const originalUnit of units(originalEntry.querySelector<HTMLElement>('.rs-entry-content')!)) {
          let remaining = originalUnit;
          for (let guard = 0; guard < 200; guard++) {
            body.append(remaining);
            if (fits(target)) { hasContent = true; break; }
            const unitHeight = remaining.getBoundingClientRect().height;
            remaining.remove();
            const used = (body.lastElementChild ?? fragment.querySelector('.rs-entry-head'))!.getBoundingClientRect().bottom - target.getBoundingClientRect().top;
            const free = target.clientHeight - used - 12;
            if ((unitHeight < target.clientHeight * .5 || free < 45) && (hasContent || target.querySelectorAll('.rs-entry').length > 1 || pageIndex === 0)) { nextFragment(); continue; }
            const length = remaining.textContent?.length ?? 0;
            if (!length) { if (!fits(target)) throw new Error('STUDIO_UNSPLITTABLE_CONTENT'); break; }
            let low = 0, high = length;
            while (low < high) {
              const mid = Math.ceil((low + high) / 2), part = slice(remaining, 0, mid); body.append(part);
              const fit = fits(target); part.remove(); if (fit) low = mid; else high = mid - 1;
            }
            if (!low) { if (pageIndex > 0 && !hasContent && target.querySelectorAll('.rs-entry').length <= 1) throw new Error('STUDIO_ENTRY_HEADING_TOO_LARGE'); nextFragment(); continue; }
            // Do not split a UTF-16 surrogate pair.
            const text = remaining.textContent ?? ''; if (low < length && /[\uD800-\uDBFF]/.test(text.charAt(low - 1))) low--;
            const part = slice(remaining, 0, low); body.append(part); hasContent = true;
            remaining = slice(remaining, low, length); nextFragment();
            if (guard === 199) throw new Error('STUDIO_FRAGMENT_LIMIT');
          }
        }
        if (!fits(target)) throw new Error('STUDIO_PAGE_OVERFLOW');
        first = false;
      }
    }
  }
  const side = (section: HTMLElement) => two && (section.dataset.column === 'aside' || (!assigned && input.autoColumns !== false && ['skills', 'languages', 'certificates', 'awards'].includes(section.dataset.kind ?? '')));
  const fullSections=sections.filter(s=>s.dataset.region==='full');
  if(fullSections.length)fill('full',fullSections);
  const startPage=pages.length-1;
  for(const page of pages){page.full.style.height='auto';const height=page.full.getBoundingClientRect().height;const remaining=Math.max(0,page.available-height);page.columns.style.height=`${remaining}px`;page.main.style.height=`${remaining}px`;page.aside.style.height=`${remaining}px`;}
  const bodySections=sections.filter(s=>s.dataset.region!=='full');
  fill('main', bodySections.filter((s) => !side(s)),startPage); if (two) fill('aside', bodySections.filter(side),startPage);
  const overflow = pages.some((page) => !fits(page.main) || (two && !fits(page.aside)));
  if (overflow) throw new Error('STUDIO_PAGE_OVERFLOW');
  root.dataset.paginated = 'true'; root.dataset.pageCount = String(pages.length);
  return { pageCount: pages.length, overflow };
}

/** Self-contained browser execution boundary. tsx/esbuild may add the function-name helper;
 * keep it scoped to this evaluation instead of relying on renderer globals. No user code. */
export function resumePaginationScript(options: { keepEntriesTogether?: boolean; autoColumns?: boolean } = {}) {
  return `(() => { const __name = (target) => target; return (${paginateResumeStudio.toString()})(${JSON.stringify({ keepEntriesTogether: options.keepEntriesTogether !== false, autoColumns: options.autoColumns !== false })}); })()`;
}
