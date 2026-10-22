// 界面图标（仿 SF Symbols 的线条和比例），颜色跟随文字颜色

const filled = (body) => `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${body}</svg>`;
const stroked = (body, width = 2.2) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const icons = {
  home: filled('<path d="M11.3 2.9a1.1 1.1 0 0 1 1.4 0l8.4 7.1c.8.7.3 2-.7 2H19v7.5c0 .8-.7 1.5-1.5 1.5H14v-5.5h-4V21H6.5C5.7 21 5 20.3 5 19.5V12H3.6c-1 0-1.5-1.3-.7-2Z"/>'),
  library: filled('<rect x="6.5" y="2.5" width="11" height="2.2" rx="1.1"/><rect x="4.5" y="6.2" width="15" height="2.2" rx="1.1"/><rect x="2.5" y="10" width="19" height="11.5" rx="2.8"/>'),
  search: stroked('<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.6 15.6 4.9 4.9"/>', 2.4),
  play: filled('<path d="M7 4.9v14.2c0 .9 1 1.4 1.7 1l11.2-7.1c.7-.4.7-1.5 0-1.9L8.7 3.9C8 3.5 7 4 7 4.9Z"/>'),
  chevronDown: stroked('<path d="m6 9.5 6 6 6-6"/>', 2.6),
  chevronRight: stroked('<path d="m9.5 5.5 6.5 6.5-6.5 6.5"/>', 2.6),
  question: stroked('<path d="M8.7 8.8a3.4 3.4 0 0 1 6.6 1.1c0 2.4-3.3 2.9-3.3 5"/><circle cx="12" cy="18.9" r="1.3" fill="currentColor" stroke="none"/>', 2.4),
  person: filled('<circle cx="12" cy="8.2" r="4.2"/><path d="M4.4 20c.9-3.7 4-5.9 7.6-5.9s6.7 2.2 7.6 5.9c.2.8-.4 1.5-1.2 1.5H5.6c-.8 0-1.4-.7-1.2-1.5Z"/>'),
  xmark: filled('<circle cx="12" cy="12" r="10"/><path d="m8.6 8.6 6.8 6.8m0-6.8-6.8 6.8" stroke="#fff" stroke-width="2" stroke-linecap="round"/>'),
};

export const icon = (name) => icons[name] ?? '';
