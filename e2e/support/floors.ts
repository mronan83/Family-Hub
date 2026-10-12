/**
 * [BRD-03][D-82] The board's floors, run in the page: buttons under 56 px inside `buttons` and text
 * under 28 px inside `text` (06 §3). Inside the calendar's grids (WP-52) an event's block may be 30 px tall and its
 * text 20 px, read up close as on a phone (D-82); a sheet opened from them keeps the board's floors.
 * Also the page's width, for no sideways scroll.
 */
export function floors({ buttons, text }: { buttons: string; text: string }) {
  const within = (sel: string) => document.querySelector(sel) ?? document.body;
  const inGrid = (el: Element) =>
    !!el.closest('.fw-hgrid, .fw-tgrid') && !el.closest('[role="dialog"]');
  const small = [...within(buttons).querySelectorAll('button')]
    .filter((b) => b.getBoundingClientRect().height < (inGrid(b) ? 30 : 56))
    .map((b) => b.getAttribute('aria-label') ?? b.textContent);
  const tiny = [...within(text).querySelectorAll('*')]
    .filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim()))
    .filter((el) => parseFloat(getComputedStyle(el).fontSize) < (inGrid(el) ? 20 : 28))
    .map((el) => el.textContent?.trim());
  return { wide: document.documentElement.scrollWidth, small, tiny };
}
