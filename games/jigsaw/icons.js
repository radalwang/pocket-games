// 拼图用到的图标，游戏界面和玩法介绍共用

const icon = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const SWAP = icon('<rect x="7.5" y="3.5" width="13" height="13" rx="2.5"/><path d="M16.5 20.5H6A2.5 2.5 0 0 1 3.5 18V7.5"/>');
export const PICTURE = icon('<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path d="m4 17 5-5 4 4 2.5-2.5L20 18"/><circle cx="15.5" cy="9" r="1.6"/>');
export const EYE = icon('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>');
export const EDGES = icon('<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/>');
export const GATHER = icon('<path d="M12 3.5v10.5M8 10l4 4 4-4"/><path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15"/>');
export const ADD_PHOTO = icon('<rect x="3.5" y="5.5" width="13" height="13" rx="2.5"/><path d="m4 16 3.5-3.5L11 16"/><path d="M19.5 3v6M16.5 6h6"/>');
export const CLOSE = icon('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>');
