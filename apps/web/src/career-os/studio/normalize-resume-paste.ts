/** Keep writing semantics, remove the source application's page typography. */
export function normalizeResumePaste(html: string) {
  const document = new DOMParser().parseFromString(html, 'text/html');
  for (const element of document.querySelectorAll('script,style,link,meta,iframe,object,embed,img')) element.remove();
  for (const element of document.body.querySelectorAll<HTMLElement>('*')) {
    const style = element.style;
    const marks = [
      /^(bold|bolder|[6-9]00)$/.test(style.fontWeight) ? 'strong' : '',
      style.fontStyle === 'italic' ? 'em' : '',
      style.textDecorationLine.includes('underline') || style.textDecoration.includes('underline') ? 'u' : '',
    ].filter(Boolean);
    for (const attribute of Array.from(element.attributes)) {
      if (!['href','start'].includes(attribute.name)) element.removeAttribute(attribute.name);
    }
    if(element.hasAttribute('href')&&!/^(https?:\/\/|mailto:|tel:)/i.test(element.getAttribute('href')??''))element.removeAttribute('href');
    for (const tag of marks) {
      if (element.tagName.toLowerCase() === tag) continue;
      const wrapper=document.createElement(tag);
      while(element.firstChild)wrapper.append(element.firstChild);
      element.append(wrapper);
    }
  }
  return document.body.innerHTML;
}
