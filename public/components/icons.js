import { h } from 'https://esm.sh/preact@10.19.3';
import htm from 'https://esm.sh/htm@3.1.1';

const html = htm.bind(h);

function Svg({ children }) {
  return html`<svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >${children}</svg>`;
}

export function PencilIcon() {
  return html`<${Svg}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </${Svg}>`;
}

export function CheckIcon() {
  return html`<${Svg}><path d="M20 6 9 17l-5-5" /></${Svg}>`;
}

export function TrashIcon() {
  return html`<${Svg}>
    <path d="M3 6h18" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
  </${Svg}>`;
}

export function ArrowUpIcon() {
  return html`<${Svg}>
    <path d="M12 19V5" />
    <path d="m5 12 7-7 7 7" />
  </${Svg}>`;
}

export function ArrowDownIcon() {
  return html`<${Svg}>
    <path d="M12 5v14" />
    <path d="m19 12-7 7-7-7" />
  </${Svg}>`;
}
