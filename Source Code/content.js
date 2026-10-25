(() => {
  "use strict";
  const normalizeText = value => String(value || "").replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
  function candidateNames(element) {
    const candidates = [];
    for (const attr of ["data-filename", "data-name", "download", "data-tooltip", "title", "aria-label", "aria-description"]) {
      const value = normalizeText(element.getAttribute?.(attr));
      if (value) candidates.push(value);
    }
    const descendants = [...(element.querySelectorAll?.("[data-filename], [data-name], [data-tooltip], [title], [aria-label], span, div") || [])].slice(0, 80);
    for (const node of descendants) {
      for (const attr of ["data-filename", "data-name", "data-tooltip", "title", "aria-label"]) {
        const value = normalizeText(node.getAttribute?.(attr));
        if (value && value.length < 240) candidates.push(value);
      }
      if (!node.children?.length) {
        const value = normalizeText(node.innerText || node.textContent);
        if (value && value.length < 240) candidates.push(value);
      }
    }
    const lines = normalizeText(element.innerText || element.textContent).split(/\s{2,}|\n/).map(normalizeText).filter(Boolean);
    candidates.push(...lines);
    const parentLabel = element.closest?.("[data-tooltip], [aria-label]");
    if (parentLabel && parentLabel !== element) candidates.push(normalizeText(parentLabel.getAttribute("data-tooltip") || parentLabel.getAttribute("aria-label")));
    return [...new Set(candidates)].filter(value => value.length < 240);
  }
  function currentPageInfo() {
    const courseNode = document.querySelector("[data-course-name]");
    const heading = document.querySelector("h1, [role='heading']");
    return {
      title: normalizeText(heading?.textContent || document.title),
      course: normalizeText(courseNode?.getAttribute("data-course-name") || courseNode?.textContent || document.querySelector("nav h1, header h1")?.textContent),
      url: location.href
    };
  }
  function visible(element) {
    if (!element) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) !== 0 && (style.display === "contents" || Boolean(element.getClientRects?.().length));
  }
  function containsDriveAttachments(root) {
    return [...(root?.querySelectorAll?.("a[href], [data-url], [data-href]") || [])].some(element => {
      if (!visible(element)) return false;
      const url = element.href || element.getAttribute("data-url") || element.getAttribute("data-href") || "";
      return Core.attachmentKind(url)?.kind === "drive";
    });
  }
  function currentPostScope(heading) {
    const routeId = location.pathname.match(/\/(?:a|w|m)\/([^/]+)/i)?.[1] || "";
    const keyed = [...document.querySelectorAll("[data-material-id], [data-coursework-id], [data-stream-item-id]")]
      .filter(visible)
      .find(element => ["data-material-id", "data-coursework-id", "data-stream-item-id"].some(attr => element.getAttribute(attr) === routeId) && containsDriveAttachments(element));
    if (keyed) return keyed;
    const closest = heading?.closest?.("[data-material-id], [data-coursework-id], [data-stream-item-id], article, [role='article']");
    if (closest && visible(closest) && containsDriveAttachments(closest)) return closest;
    const main = [...document.querySelectorAll("main, [role='main']")].filter(visible);
    const relevantMain = main.filter(containsDriveAttachments);
    if (relevantMain.length) return relevantMain.sort((a, b) => a.querySelectorAll("a[href], [data-url], [data-href]").length - b.querySelectorAll("a[href], [data-url], [data-href]").length)[0];
    if (main.length && !containsDriveAttachments(document.body)) return main[0];
    if (closest && visible(closest)) return closest;
    const details = [...document.querySelectorAll("[data-material-id], [data-coursework-id], [data-stream-item-id], article, [role='article']")].filter(element => visible(element) && containsDriveAttachments(element));
    return details.length === 1 ? details[0] : document.body;
  }
  const STREAM_MENU = 'button[aria-label], [role="button"][aria-label]';
  function streamMarkers(root) {
    return [...(root?.querySelectorAll?.(STREAM_MENU) || [])].filter(node => /(?:announcement|post|material)\s+options/i.test(node.getAttribute("aria-label") || "") && visible(node));
  }
  function streamLinks(root) {
    return [...(root?.querySelectorAll?.("a[href], [data-url], [data-href]") || [])].filter(element => {
      if (!visible(element)) return false;
      return Core.attachmentKind(element.href || element.getAttribute("data-url") || element.getAttribute("data-href") || "")?.kind === "drive";
    });
  }
  function streamPostRoots() {
    const roots = [];
    for (const marker of streamMarkers(document)) {
      let node = marker, root = null;
      for (let depth = 0; node && depth < 14; depth++, node = node.parentElement) {
        if (!node.parentElement || node.matches?.("main, [role='main'], body, html")) break;
        if (streamLinks(node).length && streamMarkers(node).length === 1) { root = node; break; }
      }
      if (root && !roots.includes(root)) roots.push(root);
    }
    // Some Classroom variants expose a card marker instead of an accessible
    // menu label, so merge explicit card roots when they are not already covered.
    const cards = [...document.querySelectorAll("[data-stream-item-id], [data-material-id], [data-coursework-id], article, [role='article']")].filter(visible);
    for (const card of cards) {
      if (!streamLinks(card).length || cards.some(other => other !== card && card.contains?.(other) && streamLinks(other).length)) continue;
      if (!roots.some(root => root.contains?.(card) || card.contains?.(root))) roots.push(card);
    }
    return roots;
  }
  function streamTitle(root, marker, index) {
    const label = normalizeText(marker?.getAttribute("aria-label") || marker?.getAttribute("data-tooltip"));
    const fromMenu = label.replace(/^(?:announcement|post|material)\s+options\s+for\s*/i, "").trim();
    if (fromMenu) return fromMenu;
    const heading = [...(root.querySelectorAll?.("h1, h2, h3, [role='heading']") || [])].map(node => normalizeText(node.innerText || node.textContent)).find(text => text && !/^post by\b/i.test(text));
    if (heading) return heading;
    const firstLine = normalizeText(root.innerText || root.textContent).split(/\n+/).map(normalizeText).find(text => text && !/^post by\b|^add comment\b|^announcement options\b/i.test(text));
    return firstLine || `Announcement ${index + 1}`;
  }
  function descriptorsFor(elements, page, topic) {
    return elements.map(element => ({
      url: element.href || element.getAttribute("data-url") || element.getAttribute("data-href") || "",
      candidates: candidateNames(element),
      mime: element.getAttribute("data-mime-type") || element.getAttribute("data-mime") || element.getAttribute("type") || "",
      typeHint: [element.getAttribute("aria-label"), element.getAttribute("data-tooltip"), element.textContent].filter(Boolean).join(" "),
      sourceLabel: element.getAttribute("aria-label") || element.getAttribute("title") || element.textContent,
      course: page.course, topic
    }));
  }
  function discover() {
    const page = currentPageInfo();
    const supportedPage = Core.isClassroomPostRoute(location.href);
    const heading = document.querySelector("h1, [role='heading']");
    if (Core.isClassroomStreamRoute(location.href)) {
      const roots = streamPostRoots();
      const markers = streamMarkers(document);
      const posts = roots.map((root, index) => {
        const marker = markers.find(item => root.contains?.(item));
        const title = streamTitle(root, marker, index);
        const elements = streamLinks(root);
        const identity = root.getAttribute?.("data-stream-item-id") || root.getAttribute?.("data-material-id") || root.getAttribute?.("data-coursework-id") || Core.attachmentKind(elements[0]?.href || elements[0]?.getAttribute("data-url") || "")?.id || `${index}-${title}`;
        const postKey = `stream:${identity}`;
        const result = Core.discoverAttachments(descriptorsFor(elements, page, title), { supportedPage: true, postContainerFound: true, course: page.course, topic: title, postKey, url: location.href });
        return { key: postKey, title, files: result.files, count: result.files.length, diagnostics: result.diagnostics };
      }).filter(post => post.count);
      return { files: [], posts, streamPage: true, diagnostics: { supportedPage: true, postContainerFound: roots.length > 0, candidates: roots.length, extracted: posts.reduce((sum, post) => sum + post.count, 0), reason: roots.length ? posts.length ? "stream_posts_found" : "no_eligible_attachment_links" : "stream_posts_not_found" }, page };
    }
    const scanRoot = supportedPage ? currentPostScope(heading) : null;
    const postContainerFound = supportedPage && Boolean(scanRoot);
    if (!supportedPage || !postContainerFound) {
      const result = Core.discoverAttachments([], { supportedPage, postContainerFound, ...page });
      return { ...result, page };
    }
    const elements = [...scanRoot.querySelectorAll("a[href], [data-url], [data-href]")].filter(visible);
    const descriptors = descriptorsFor(elements, page, page.title);
    const result = Core.discoverAttachments(descriptors, {
      supportedPage,
      postContainerFound,
      course: page.course,
      topic: page.title,
      postKey: location.pathname
    });
    return { ...result, page };
  }
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type !== "EKCLICK_DISCOVER") return false;
    try {
      const result = discover();
      console.info("[EkClick][discovery]", result.diagnostics);
      respond(result);
    } catch (error) {
      console.warn("[EkClick][discovery] extraction_error", error?.name || "Error");
      respond({ error: "discovery_error", message: "Attachment discovery failed.", diagnostics: { reason: "discovery_error" }, page: currentPageInfo(), files: [] });
    }
    return false;
  });
  window.addEventListener("popstate", () => { /* Popup requests always scan the current SPA route on demand. */ });
  if (typeof module !== "undefined" && module.exports) module.exports = { discover, streamPostRoots, streamTitle };
})();
